-- Teste físico exclusivo do aplicativo Windows: operador declara se viu o papel.
-- Não altera trabalhos, pagamentos, aceite ou o status de impressão dos pedidos.
create table public.pitacco_windows_print_checks (
 id uuid primary key default gen_random_uuid(),
 store_id uuid not null references public.stores(id) on delete cascade,
 device_id uuid not null,
 printer_name text not null check(length(printer_name) between 1 and 150),
 paper_width smallint not null check(paper_width in (58,80)),
 submitted_by uuid not null references auth.users(id),
 submitted_at timestamptz not null default now(),
 outcome text not null default 'awaiting_confirmation'
  check(outcome in ('awaiting_confirmation','printed','failed','uncertain')),
 confirmed_by uuid references auth.users(id),
 confirmed_at timestamptz,
 constraint windows_print_check_confirmation check(
  (outcome='awaiting_confirmation' and confirmed_by is null and confirmed_at is null) or
  (outcome<>'awaiting_confirmation' and confirmed_by is not null and confirmed_at is not null)
 )
);
create index pitacco_windows_print_checks_recent
 on public.pitacco_windows_print_checks(store_id,submitted_at desc);
alter table public.pitacco_windows_print_checks enable row level security;
revoke all on public.pitacco_windows_print_checks from public,anon,authenticated;

create function public.pitacco_windows_print_check_started(
 p_store uuid,p_device uuid,p_printer text,p_width integer
) returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); count_recent integer; check_id uuid;
begin
 if actor is null or p_device is null or p_store is null or not public.is_store_manager(p_store) then
  raise exception 'Somente gestores da loja podem registrar testes de impressão' using errcode='42501';
 end if;
 if p_width not in (58,80) or length(trim(coalesce(p_printer,''))) not between 1 and 150 then
  raise exception 'Impressora ou papel inválido';
 end if;
 if not exists (
  select 1 from public.pitacco_windows_presence
  where store_id=p_store and device_id=p_device and signed_in_user=actor
   and last_seen_at>now()-interval '90 seconds'
 ) then raise exception 'O aplicativo Windows precisa estar conectado para registrar o teste';end if;
 perform 1 from public.stores where id=p_store for update;
 select count(*) into count_recent from public.pitacco_windows_print_checks
 where store_id=p_store and submitted_at>now()-interval '60 minutes';
 if count_recent>=30 then raise exception 'Limite de testes atingido. Tente novamente mais tarde';end if;
 insert into public.pitacco_windows_print_checks(store_id,device_id,printer_name,paper_width,submitted_by)
 values(p_store,p_device,trim(p_printer),p_width::smallint,actor)
 returning id into check_id;
 return jsonb_build_object('test_id',check_id,'state','awaiting_confirmation',
   'note','Envio ao spooler registrado; confirme manualmente se a comanda saiu no papel.');
end $$;
revoke all on function public.pitacco_windows_print_check_started(uuid,uuid,text,integer) from public,anon,authenticated;
grant execute on function public.pitacco_windows_print_check_started(uuid,uuid,text,integer) to authenticated;

create function public.pitacco_windows_print_check_confirm(
 p_store uuid,p_test uuid,p_outcome text
) returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); item public.pitacco_windows_print_checks%rowtype;
begin
 if actor is null or p_store is null or p_test is null or not public.is_store_manager(p_store) then
  raise exception 'Sem autorização para confirmar este teste' using errcode='42501';
 end if;
 if p_outcome not in ('printed','failed','uncertain') then
  raise exception 'Resultado do teste inválido';
 end if;
 select * into item from public.pitacco_windows_print_checks
 where id=p_test and store_id=p_store for update;
 if not found or item.submitted_by<>actor then
  raise exception 'Teste não encontrado para este operador' using errcode='42501';end if;
 if item.outcome<>'awaiting_confirmation' then
  raise exception 'Este teste já foi confirmado';end if;
 if item.submitted_at<now()-interval '30 minutes' then
  raise exception 'O teste expirou. Execute um novo teste no Windows';end if;
 update public.pitacco_windows_print_checks
 set outcome=p_outcome,confirmed_at=now(),confirmed_by=actor
 where id=p_test;
 return jsonb_build_object('confirmed',true,'outcome',p_outcome,'test_id',p_test);
end $$;
revoke all on function public.pitacco_windows_print_check_confirm(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.pitacco_windows_print_check_confirm(uuid,uuid,text) to authenticated;

create or replace function public.pitacco_windows_connection(p_store uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare latest timestamptz; bound_id uuid; connected_count integer; bound_live boolean;
 test_summary jsonb;
begin
 if auth.uid() is null or p_store is null or not public.is_store_manager(p_store) then
  raise exception 'Acesso não autorizado ao status do Windows' using errcode='42501';
 end if;
 select max(last_seen_at),
   count(*) filter(where last_seen_at>=now()-interval '90 seconds')
 into latest,connected_count
 from public.pitacco_windows_presence where store_id=p_store;
 select device_id into bound_id from public.print_devices where store_id=p_store;
 bound_live:=bound_id is not null and exists(select 1 from public.pitacco_windows_presence
  where store_id=p_store and device_id=bound_id and last_seen_at>=now()-interval '90 seconds');
 select jsonb_build_object('outcome',t.outcome,'paper_width',t.paper_width,
  'printer_name',t.printer_name,'submitted_at',t.submitted_at,'confirmed_at',t.confirmed_at,
  'verified_by_operator',t.outcome='printed') into test_summary
 from public.pitacco_windows_print_checks t
 where t.store_id=p_store
 order by t.submitted_at desc limit 1;
 return jsonb_build_object(
  'status',case when connected_count>0 then 'connected'
   when latest is not null or bound_id is not null then 'offline' else 'not_detected' end,
  'app_logged_in_now',connected_count>0,
  'last_seen_at',latest,
  'printer_computer_bound',bound_id is not null,
  'bound_computer_connected',bound_live,
  'last_printer_test',test_summary,
  'automatic_print_tested',false,
  'installation_confirmed',false,
  'details','A atividade recente não comprova instalação permanente. A confirmação de papel é declarada pelo operador e não valida impressão automática de pedidos.'
 );
end $$;
revoke all on function public.pitacco_windows_connection(uuid) from public,anon,authenticated;
grant execute on function public.pitacco_windows_connection(uuid) to authenticated;
