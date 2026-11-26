-- A durable admission boundary for previously unseen provider orders.
-- Any order already linked to Pitacco continues its existing lifecycle.
create table if not exists pitacco_private.marketplace_admission_cutoffs(
 store_id uuid primary key references public.stores(id) on delete cascade,
 cutoff_at timestamptz not null
);
alter table pitacco_private.marketplace_admission_cutoffs enable row level security;
revoke all on pitacco_private.marketplace_admission_cutoffs from public,anon,authenticated;
create or replace function pitacco_private.record_marketplace_admission_cutoff()
returns trigger language plpgsql security definer set search_path='' as $fn$
declare row_data jsonb; s uuid; c uuid; i uuid;
begin
 row_data:=case when tg_op='INSERT' then to_jsonb(new) else to_jsonb(old) end;
 if tg_table_name in ('subscription_admin_controls','commercial_closings','commercial_contracts') then s:=(row_data->>'store_id')::uuid;
 elsif tg_table_name in ('commercial_invoices','fixo_prepaid_state') then c:=(row_data->>'contract_id')::uuid;
 else i:=(row_data->>'invoice_id')::uuid;
 end if;
 if i is not null then select contract_id into c from pitacco_private.commercial_invoices where id=i;end if;
 if s is null and c is not null then select store_id into s from pitacco_private.commercial_contracts where id=c;end if;
 -- Capture the old gate before a payment, release, courtesy or reconciliation can change it.
 if s is not null and coalesce((pitacco_private.control_store_order_gate(s)->>'orders_blocked')::boolean,false) then
  insert into pitacco_private.marketplace_admission_cutoffs(store_id,cutoff_at) values(s,clock_timestamp())
  on conflict(store_id) do update set cutoff_at=greatest(marketplace_admission_cutoffs.cutoff_at,excluded.cutoff_at);
 end if;
 if tg_op='DELETE' then return old;end if;return new;
end $fn$;
revoke all on function pitacco_private.record_marketplace_admission_cutoff() from public,anon,authenticated;
do $triggers$
declare t text;
begin
 foreach t in array array['subscription_admin_controls','commercial_manual_payments','commercial_closings','commercial_invoices','fixo_prepaid_state','commercial_contracts','asaas_commercial_resolutions','asaas_commercial_incidents'] loop
  execute format('drop trigger if exists pitacco_marketplace_admission_cutoff on pitacco_private.%I',t);
  execute format('create trigger pitacco_marketplace_admission_cutoff before insert or update or delete on pitacco_private.%I for each row execute function pitacco_private.record_marketplace_admission_cutoff()',t);
 end loop;
end $triggers$;
do $patch$
declare d text; a text; b text;
begin
 select pg_get_functiondef('public.pitacco_ifood_complete(uuid,uuid,jsonb,boolean)'::regprocedure) into d;
 a:='if link.external_id is null then'||chr(10)||'    insert into public.orders';
 b:=$new$if link.external_id is null then
    -- Provider order creation time, not delivery time of the lifecycle event.
    if exists(select 1 from pitacco_private.marketplace_admission_cutoffs c
       where c.store_id=m.store_id and (p_order->>'created_at')::timestamptz<=c.cutoff_at) then
      insert into pitacco_private.ifood_suppressed_orders(merchant_id,external_order_id)
       values(e.merchant_id,e.order_id) on conflict do nothing;
      update pitacco_private.ifood_events set done_at=now(),lease=null where id=e.id;
      return;
    end if;
    insert into public.orders$new$;
 if strpos(d,a)>0 then execute replace(d,a,b);elsif strpos(d,b)=0 then raise exception 'iFood late order admission anchor missing';end if;
end $patch$;
do $verify$ begin
 assert not has_table_privilege('anon','pitacco_private.marketplace_admission_cutoffs','SELECT');
 assert not has_table_privilege('authenticated','pitacco_private.marketplace_admission_cutoffs','SELECT');
 assert not has_function_privilege('authenticated','pitacco_private.record_marketplace_admission_cutoff()','EXECUTE');
end $verify$;
