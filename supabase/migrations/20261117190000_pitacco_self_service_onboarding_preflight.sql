-- Onboarding assistido: verificação sem gerar pedidos/cobranças/entregas.
create table if not exists public.pitacco_store_preflight_runs (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  requested_by uuid not null references auth.users(id),
  snapshot jsonb not null,
  created_at timestamptz not null default now()
);
create index if not exists pitacco_store_preflight_runs_recent
  on public.pitacco_store_preflight_runs(store_id,created_at desc);
alter table public.pitacco_store_preflight_runs enable row level security;
revoke all on public.pitacco_store_preflight_runs from public,anon,authenticated;

create or replace function public.pitacco_store_launch_diagnostic(p_store uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare 
 basic jsonb; s public.stores%rowtype; m public.public_menu_settings%rowtype;
 n_products int:=0; n_printers int:=0; active_methods int:=0;
 slug_valid bool:=false; public_reachable bool:=false;
 checkout_rules bool:=false; delivery_rules bool:=false; check_results jsonb;
begin
 if auth.uid() is null or not public.is_store_manager(p_store) then
  raise exception 'Sem autorização para verificar esta loja' using errcode='42501';
 end if;
 basic:=public.pitacco_store_readiness(p_store);
 select * into s from public.stores where id=p_store;
 if not found then raise exception 'Loja inexistente';end if;
 select * into m from public.public_menu_settings where store_id=p_store;
 select count(*) into n_products from public.products
  where store_id=p_store and menu_active and price>=0 and length(trim(coalesce(name,'')))>=2;
 select count(*) into n_printers from public.print_devices where store_id=p_store;
 slug_valid:=coalesce(m.slug ~ '^[a-z0-9][a-z0-9-]{2,59}$',false);
 active_methods:=coalesce(cardinality(m.payment_methods),0);
 checkout_rules:=n_products>0 and active_methods>0
  and (coalesce(m.delivery_enabled,false) or coalesce(m.pickup_enabled,false))
  and (not ('pix_manual'=any(coalesce(m.payment_methods,array[]::text[])))
   or length(trim(coalesce(m.pix_instructions,'')))>=3);
 delivery_rules:=(not coalesce(m.delivery_enabled,false))
  or (coalesce(m.delivery_fee,0)>=0 and length(trim(coalesce(s.address,'')))>=3
  and length(trim(coalesce(s.city,'')))>=2 and length(trim(coalesce(s.state,'')))>=2);
 if coalesce(m.enabled,false) and slug_valid then
  begin
   public_reachable:=(public.get_public_menu(m.slug)->'store'->>'name') is not null;
  exception when others then
   public_reachable:=false;
  end;
 end if;
 check_results:=jsonb_build_object(
  'identity',case when (basic->'checks'->>'identity')::boolean then 'ok' else 'action' end,
  'address',case when (basic->'checks'->>'address')::boolean then 'ok' else 'action' end,
  'products',case when n_products>0 then 'ok' else 'action' end,
  'payments',case when active_methods>0 and
    (not ('pix_manual'=any(coalesce(m.payment_methods,array[]::text[])))
     or length(trim(coalesce(m.pix_instructions,'')))>=3)
     then 'ok' else 'action' end,
  'fulfillment',case when coalesce(m.pickup_enabled,false) or coalesce(m.delivery_enabled,false)
    then 'ok' else 'action' end,
  'delivery_rules',case when delivery_rules then 'ok' else 'action' end,
  'catalog_link',case when slug_valid then 'ok' else 'action' end,
  'catalog_live',case when public_reachable then 'ok' else 'action' end,
  'checkout_configuration',case when checkout_rules then 'ok' else 'action' end,
  'printer_configuration',case when n_printers>0 then 'manual' else 'optional' end,
  'print_on_paper','manual',
  'notifications_on_device','manual',
  'order_to_delivery','manual',
  'marketplace_integrations','optional'
 );
 return jsonb_build_object(
  'store_id',p_store,'run_type','read_only_diagnostic','checked_at',now(),
  'checks',check_results,
  'basic_ready',coalesce((basic->>'ready')::boolean,false),
  'configured',checkout_rules and delivery_rules and slug_valid and public_reachable,
  'fully_homologated',false,
  'limits','Checagens de configuração e acesso ao cardápio; não executa pedidos, cobranças, impressão física, push nem APIs de parceiros.',
  'counts',jsonb_build_object('products',n_products,'printers_bound',n_printers),
  'catalog_url',case when slug_valid then 'https://pitacco.com.br/'||m.slug else null end
 );
end $$;
revoke all on function public.pitacco_store_launch_diagnostic(uuid) from public,anon,authenticated;
grant execute on function public.pitacco_store_launch_diagnostic(uuid) to authenticated;

create or replace function public.pitacco_store_run_preflight(p_store uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb; n int; run_id uuid;
begin
 if auth.uid() is null or not public.is_store_manager(p_store) then
  raise exception 'Sem autorização para verificar esta loja' using errcode='42501';
 end if;
 select count(*) into n from public.pitacco_store_preflight_runs
  where store_id=p_store and requested_by=auth.uid()
    and created_at>now()-interval '15 minutes';
 if n>=8 then raise exception 'Aguarde alguns minutos antes de repetir a verificação';end if;
 result:=public.pitacco_store_launch_diagnostic(p_store);
 insert into public.pitacco_store_preflight_runs(store_id,requested_by,snapshot)
 values(p_store,auth.uid(),result) returning id into run_id;
 return result||jsonb_build_object('run_id',run_id);
end $$;
revoke all on function public.pitacco_store_run_preflight(uuid) from public,anon,authenticated;
grant execute on function public.pitacco_store_run_preflight(uuid) to authenticated;

create function public.pitacco_store_preflight_history(p_store uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
 if auth.uid() is null or not public.is_store_manager(p_store) then
  raise exception 'Sem acesso ao histórico de verificação' using errcode='42501';end if;
 select coalesce(jsonb_agg(to_jsonb(r) order by r.created_at desc),'[]'::jsonb) into result
 from (
  select id,created_at,snapshot->>'configured' as configured,
   snapshot->>'basic_ready' as basic_ready
  from public.pitacco_store_preflight_runs where store_id=p_store
  order by created_at desc limit 10
 ) r;
 return result;
end $$;
revoke all on function public.pitacco_store_preflight_history(uuid) from public,anon,authenticated;
grant execute on function public.pitacco_store_preflight_history(uuid) to authenticated;
