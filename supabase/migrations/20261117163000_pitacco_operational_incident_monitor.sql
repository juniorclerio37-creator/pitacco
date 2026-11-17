-- Monitoramento persistente, sem executar aceite, impressão, pagamento ou reenvio.
create table public.pitacco_operational_incidents (
 id uuid primary key default gen_random_uuid(),
 store_id uuid not null references public.stores(id) on delete cascade,
 code text not null check (code in (
  'acceptance_late','preparation_late','delivery_late','print_error',
  'marketplace_acceptance_failed','delivery_partner_failed','payment_failed'
 )),
 entity_id uuid not null,
 status text not null default 'open' check (status in ('open','resolved')),
 first_seen_at timestamptz not null default now(),
 last_seen_at timestamptz not null default now(),
 resolved_at timestamptz,
 detections integer not null default 1 check (detections>=1),
 acknowledged_at timestamptz,
 acknowledged_by uuid references auth.users(id),
 unique(store_id,code,entity_id)
);
create index pitacco_incidents_open_recent on public.pitacco_operational_incidents(store_id,status,last_seen_at desc);
alter table public.pitacco_operational_incidents enable row level security;
revoke all on public.pitacco_operational_incidents from public,anon,authenticated;

create table pitacco_private.pitacco_incident_actions (
 id bigint generated always as identity primary key,
 incident_id uuid not null references public.pitacco_operational_incidents(id) on delete cascade,
 actor uuid not null references auth.users(id),
 action text not null check(action in ('acknowledge')),
 reason text not null check(length(reason) between 5 and 500),
 created_at timestamptz not null default now()
);
revoke all on pitacco_private.pitacco_incident_actions from public,anon,authenticated;

create function pitacco_private.collect_operational_incidents()
returns integer language plpgsql security definer set search_path='' as $$
declare scan_at timestamptz:=clock_timestamp(); found_count integer;
begin
 -- Never process concurrent scans; this job only reads source records and saves incident states.
 if not pg_try_advisory_xact_lock(17428,82511) then return 0;end if;
 with observed as (
  select o.store_id,'acceptance_late'::text as code,o.id as entity_id
   from public.orders o where o.status='pending'
     and coalesce(o.scheduled_release_at,o.created_at)<now()-interval '10 minutes'
     and o.created_at>now()-interval '2 days'
  union all
  select o.store_id,'preparation_late',o.id
   from public.orders o left join public.public_menu_settings m on m.store_id=o.store_id
   where o.status='accepted' and o.preparation_status='preparing'
     and coalesce(o.accepted_at,o.created_at)+make_interval(mins=>coalesce(m.preparation_minutes,30))<now()
     and o.created_at>now()-interval '2 days'
  union all
  select d.store_id,'delivery_late',d.id
   from public.deliveries d where d.status not in ('entregue','cancelada')
     and d.deliver_by<now() and d.created_at>now()-interval '2 days'
  union all
  select p.store_id,'print_error',p.id
   from public.print_jobs p where p.state='error'
     and p.updated_at>now()-interval '2 days'
  union all
  select r.store_id,'marketplace_acceptance_failed',r.id
   from public.marketplace_acceptance_requests r where r.state='rejected'
     and r.created_at>now()-interval '2 days'
  union all
  select r.store_id,'delivery_partner_failed',r.id
   from public.external_delivery_requests r where r.status='falhou'
     and r.created_at>now()-interval '2 days'
  union all
  select o.store_id,'payment_failed',o.id
   from public.orders o where o.receipt->>'payment_status' in ('failed','falhou')
     and o.created_at>now()-interval '2 days'
 ), updated as (
  insert into public.pitacco_operational_incidents(store_id,code,entity_id,last_seen_at)
  select store_id,code,entity_id,scan_at from observed
  on conflict(store_id,code,entity_id) do update set
    last_seen_at=excluded.last_seen_at,
    detections=public.pitacco_operational_incidents.detections+1,
    status='open',
    resolved_at=null,
    acknowledged_at=case when public.pitacco_operational_incidents.status='resolved'
      then null else public.pitacco_operational_incidents.acknowledged_at end,
    acknowledged_by=case when public.pitacco_operational_incidents.status='resolved'
      then null else public.pitacco_operational_incidents.acknowledged_by end
  returning id
 )
 select count(*) into found_count from updated;
 update public.pitacco_operational_incidents set status='resolved',resolved_at=scan_at
  where status='open' and last_seen_at<scan_at;
 return found_count;
end $$;
revoke all on function pitacco_private.collect_operational_incidents() from public,anon,authenticated;

create function public.pitacco_incidents(
 p_store uuid default null,p_status text default 'open',p_page integer default 0
) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare actor uuid:=auth.uid(); owner boolean; result jsonb;
begin
 if actor is null then raise exception 'Entre na sua conta' using errcode='42501';end if;
 owner:=public.pitacco_is_platform_owner();
 if p_store is null and not owner then raise exception 'Escolha uma loja autorizada' using errcode='42501';end if;
 if p_store is not null and not(owner or public.is_store_manager(p_store)) then
  raise exception 'Sem acesso ao diagnóstico desta loja' using errcode='42501';end if;
 if p_status not in ('open','resolved','all') or p_page is null or p_page not between 0 and 10000 then
  raise exception 'Consulta inválida';
 end if;
 select coalesce(jsonb_agg(to_jsonb(x) order by x.last_seen_at desc,x.id desc),'[]'::jsonb)
 into result from (
  select i.id,i.store_id,s.name as store_name,i.code,i.entity_id,i.status,
    i.first_seen_at,i.last_seen_at,i.resolved_at,i.detections,i.acknowledged_at
  from public.pitacco_operational_incidents i join public.stores s on s.id=i.store_id
  where (p_store is null or i.store_id=p_store)
    and (p_status='all' or i.status=p_status)
  order by i.last_seen_at desc,i.id desc offset p_page*25 limit 26
 ) x;
 return jsonb_build_object('rows',case when jsonb_array_length(result)>25 then result-25 else result end,
 'has_more',jsonb_array_length(result)>25);
end $$;
revoke all on function public.pitacco_incidents(uuid,text,integer) from public,anon,authenticated;
grant execute on function public.pitacco_incidents(uuid,text,integer) to authenticated;

create function public.pitacco_owner_acknowledge_incident(p_incident uuid,p_reason text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); target public.pitacco_operational_incidents%rowtype;
begin
 if actor is null or not public.pitacco_is_platform_owner() then
  raise exception 'Acesso exclusivo do proprietário' using errcode='42501';end if;
 if length(trim(coalesce(p_reason,''))) not between 5 and 500 then
  raise exception 'Informe o motivo do reconhecimento';
 end if;
 select * into target from public.pitacco_operational_incidents where id=p_incident for update;
 if not found then raise exception 'Incidente indisponível';end if;
 if target.status='resolved' then raise exception 'Este incidente já foi resolvido';end if;
 if target.acknowledged_at is not null then raise exception 'Incidente já reconhecido';end if;
 update public.pitacco_operational_incidents set acknowledged_at=now(),acknowledged_by=actor
  where id=p_incident;
 insert into pitacco_private.pitacco_incident_actions(incident_id,actor,action,reason)
 values(p_incident,actor,'acknowledge',trim(p_reason));
 return jsonb_build_object('acknowledged',true,'status','open');
end $$;
revoke all on function public.pitacco_owner_acknowledge_incident(uuid,text) from public,anon,authenticated;
grant execute on function public.pitacco_owner_acknowledge_incident(uuid,text) to authenticated;

-- Agendar somente quando pg_cron já estiver instalado. A CI isolada não precisa do plugin.
do $$
begin
 if to_regprocedure('cron.schedule(text,text,text)') is not null then
   execute $cron$select cron.schedule(
    'pitacco-operational-incidents-every-2min','*/2 * * * *',
    'select pitacco_private.collect_operational_incidents()'
   )$cron$;
 end if;
end $$;
