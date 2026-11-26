-- Queue only new local kitchen-ready transitions. Never backfill older orders.
create table if not exists pitacco_private.ifood_ready_queue (
 order_id uuid primary key references public.orders(id) on delete cascade,
 requested_at timestamptz not null default now(),
 state text not null default 'pending' check(state in ('pending','sending','retry','submitted','uncertain','rejected')),
 attempts integer not null default 0,
 next_at timestamptz not null default now(),
 lease uuid,
 http_status integer
);
revoke all on pitacco_private.ifood_ready_queue from public,anon,authenticated;
create or replace function pitacco_private.enqueue_ifood_ready()
returns trigger language plpgsql security definer set search_path='' as $$
begin
 if old.preparation_status is distinct from 'ready'
 and new.preparation_status='ready' and new.source='ifood' and new.status='accepted'
 and new.receipt->>'ifood_status'='CONFIRMED'
 and exists(select 1 from pitacco_private.ifood_order_links l where l.order_id=new.id and l.state_rank=2)
 then insert into pitacco_private.ifood_ready_queue(order_id) values(new.id) on conflict do nothing;
 end if;
 return new;
end $$;
revoke all on function pitacco_private.enqueue_ifood_ready() from public,anon,authenticated;
drop trigger if exists pitacco_enqueue_ifood_ready on public.orders;
create trigger pitacco_enqueue_ifood_ready after update of preparation_status on public.orders
for each row execute function pitacco_private.enqueue_ifood_ready();

create or replace function pitacco_private.ifood_ready_candidates()
returns table(order_id uuid,external_order_id uuid,merchant_id uuid,uses_store_token boolean)
language sql stable set search_path='' as $$
 select q.order_id,l.external_id,l.merchant_id,m.credential is not null
 from pitacco_private.ifood_ready_queue q
 join public.orders o on o.id=q.order_id
 join pitacco_private.ifood_order_links l on l.order_id=o.id
 join pitacco_private.ifood_merchants m on m.merchant_id=l.merchant_id and m.store_id=o.store_id
 where q.state in ('pending','retry') and q.attempts<4 and q.next_at<=now()
 and q.requested_at>=now()-interval '30 minutes'
 and o.source='ifood' and o.status='accepted' and o.preparation_status='ready'
 and o.receipt->>'ifood_status'='CONFIRMED' and l.state_rank=2
 and o.receipt->>'ifood_manual_cancel' is distinct from 'requested'
 and m.enabled and (o.receipt->>'ifood_test')::boolean=m.test_only
 and (m.credential is null or m.test_only or exists(select 1 from pitacco_private.ifood_control c where c.merchant_linking))
 and not exists(select 1 from public.deliveries d where d.order_id=o.id and d.store_id=o.store_id and d.status in ('retirada','entregue','cancelada'));
$$;
revoke all on function pitacco_private.ifood_ready_candidates() from public,anon,authenticated;

create or replace function public.pitacco_ifood_claim_ready()
returns table(order_id uuid,external_order_id uuid,merchant_id uuid,lease uuid,uses_store_token boolean)
language sql security definer set search_path='' as $$
 with picked as materialized (
 select c.* from pitacco_private.ifood_ready_candidates() c
 join pitacco_private.ifood_ready_queue q on q.order_id=c.order_id
 where q.state in ('pending','retry') and q.next_at<=now()
 order by q.requested_at,q.order_id limit 4 for update of q skip locked
 )
 update pitacco_private.ifood_ready_queue q set state='sending',attempts=q.attempts+1,lease=gen_random_uuid()
 from picked p where q.order_id=p.order_id
 returning q.order_id,p.external_order_id,p.merchant_id,q.lease,p.uses_store_token;
$$;
create or replace function public.pitacco_ifood_finish_ready(p_order uuid,p_lease uuid,p_state text,p_http_status integer)
returns void language sql security definer set search_path='' as $$
 with done as (
 update pitacco_private.ifood_ready_queue q set state=case when p_state='retry' and q.attempts>=4 then 'rejected' else p_state end,
 lease=null,http_status=p_http_status,next_at=now()+interval '30 seconds'
 where q.order_id=p_order and q.lease=p_lease and q.state='sending'
 and p_state in ('retry','submitted','uncertain','rejected')
 returning q.order_id,q.state,q.http_status
 )
 insert into public.operation_audit(store_id,order_id,action,details)
 select o.store_id,o.id,'ifood_ready_'||d.state,jsonb_build_object('http_status',d.http_status)
 from done d join public.orders o on o.id=d.order_id;
$$;
revoke all on function public.pitacco_ifood_claim_ready(),public.pitacco_ifood_finish_ready(uuid,uuid,text,integer) from public,anon,authenticated;
grant execute on function public.pitacco_ifood_claim_ready(),public.pitacco_ifood_finish_ready(uuid,uuid,text,integer) to service_role;
