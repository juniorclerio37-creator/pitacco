-- Reconcile the internal accept marker only when official iFood confirmation exists.
create or replace function pitacco_private.ifood_normalize_confirmed_accept()
returns trigger language plpgsql set search_path='' as $$
begin
 if new.source='ifood' and new.status='accepted'
    and new.receipt->>'ifood_status' in ('CONFIRMED','READY_TO_PICKUP','DISPATCHED','CONCLUDED')
    and new.receipt->>'ifood_manual_accept'='requested'
    and (old.status='pending' or old.receipt->>'ifood_status' in ('CONFIRMED','READY_TO_PICKUP','DISPATCHED','CONCLUDED')) then
   new.receipt:=new.receipt||'{"ifood_manual_accept":"confirmed"}'::jsonb;
 end if;
 return new;
end $$;
revoke all on function pitacco_private.ifood_normalize_confirmed_accept() from public,anon,authenticated;
drop trigger if exists pitacco_ifood_normalize_confirmed_accept on public.orders;
create trigger pitacco_ifood_normalize_confirmed_accept before update of status,receipt on public.orders
for each row execute function pitacco_private.ifood_normalize_confirmed_accept();
update public.orders o set receipt=o.receipt||'{"ifood_manual_accept":"confirmed"}'::jsonb
where o.source='ifood' and o.status='accepted'
 and o.receipt->>'ifood_status' in ('CONFIRMED','READY_TO_PICKUP','DISPATCHED','CONCLUDED')
 and o.receipt->>'ifood_manual_accept'='requested'
 and exists(select 1 from pitacco_private.ifood_order_links l where l.order_id=o.id and l.state_rank>=2)
 and exists(select 1 from public.marketplace_acceptance_requests r where r.order_id=o.id and r.source='ifood' and r.state='confirmed');
