create table public.pitacco_store_payment_providers (
  store_id uuid not null references public.stores(id) on delete cascade,
  provider text not null check (provider in ('mercado_pago','pagbank','infinitepay')),
  requested_enabled boolean not null default false,
  primary key (store_id,provider)
);
alter table public.pitacco_store_payment_providers enable row level security;
revoke all on public.pitacco_store_payment_providers from public,anon,authenticated;
grant select,insert,update on public.pitacco_store_payment_providers to authenticated;
create policy pitacco_store_manager_payment_providers on public.pitacco_store_payment_providers
  for all to authenticated using (public.is_store_manager(store_id))
  with check (public.is_store_manager(store_id));

alter table pitacco_private.homologation_results drop constraint homologation_results_scope_check;
alter table pitacco_private.homologation_results add constraint homologation_results_scope_check
  check (scope in ('asaas','marketplaces','repasse','pedidos','entregas','whatsapp','windows','publicacao','mercado_pago','pagbank','infinitepay'));

do $$
declare
  definition text := pg_get_functiondef('public.pitacco_admin_record_homologation(uuid,text,text,text,uuid)'::regprocedure);
  scopes constant text := $code$'asaas','marketplaces','repasse','pedidos','entregas','whatsapp','windows','publicacao'$code$;
begin
  if strpos(definition,scopes)=0 then raise exception 'Escopos de homologação diferentes da versão de referência'; end if;
  execute replace(definition,scopes,scopes||$code$,'mercado_pago','pagbank','infinitepay'$code$);
end $$;
