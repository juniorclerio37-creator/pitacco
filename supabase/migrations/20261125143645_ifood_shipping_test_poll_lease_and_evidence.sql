create or replace function public.pitacco_ifood_shipping_test_claim_poll()
returns table(merchant_id uuid,lease uuid) language sql security definer set search_path='' as $$
 with due as (
  select m.merchant_id from pitacco_private.ifood_merchants m where m.test_only and m.enabled and m.credential is null and m.poll_after<=now()
  order by m.poll_after,m.merchant_id limit 8 for update skip locked
 )
 update pitacco_private.ifood_merchants m set poll_after=now()+interval '90 seconds',poll_lease=gen_random_uuid()
 from due where m.merchant_id=due.merchant_id returning m.merchant_id,m.poll_lease
$$;
revoke all on function public.pitacco_ifood_shipping_test_claim_poll() from public,anon,authenticated;
grant execute on function public.pitacco_ifood_shipping_test_claim_poll() to service_role;
create table if not exists pitacco_private.ifood_shipping_test_poll_log(
 id bigint generated always as identity primary key,merchant_id uuid not null,checked_at timestamptz not null default now(),http integer not null,events integer not null default 0,acknowledged integer not null default 0,ok boolean not null
);
alter table pitacco_private.ifood_shipping_test_poll_log enable row level security;
revoke all on pitacco_private.ifood_shipping_test_poll_log from public,anon,authenticated;
create or replace function public.pitacco_ifood_shipping_test_finish_poll(p_merchant uuid,p_lease uuid,p_http integer,p_events integer,p_acked integer,p_ok boolean)
returns boolean language plpgsql security definer set search_path='' as $$
begin
 update pitacco_private.ifood_merchants set poll_after=case when p_ok then greatest(now(),poll_after-interval '60 seconds') else now()+interval '2 minutes' end,poll_lease=null,last_poll_ok=case when p_ok then now() else last_poll_ok end
 where merchant_id=p_merchant and poll_lease=p_lease and test_only and credential is null;
 if not found then return false;end if;
 insert into pitacco_private.ifood_shipping_test_poll_log(merchant_id,http,events,acknowledged,ok) values(p_merchant,p_http,greatest(p_events,0),greatest(p_acked,0),p_ok);
 delete from pitacco_private.ifood_shipping_test_poll_log where checked_at<now()-interval '7 days';
 return true;
end $$;
revoke all on function public.pitacco_ifood_shipping_test_finish_poll(uuid,uuid,integer,integer,integer,boolean) from public,anon,authenticated;
grant execute on function public.pitacco_ifood_shipping_test_finish_poll(uuid,uuid,integer,integer,integer,boolean) to service_role;;
