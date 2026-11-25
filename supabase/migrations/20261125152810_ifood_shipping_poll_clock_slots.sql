create or replace function public.pitacco_ifood_shipping_test_finish_poll(p_merchant uuid,p_lease uuid,p_http integer,p_events integer,p_acked integer,p_ok boolean)
returns boolean language plpgsql security definer set search_path='' as $$
begin
 -- The cron is the 30-second clock. The lease prevents overlapping calls.
 -- Schedule the next clock slot rather than adding a second delay from the
 -- actual claim timestamp, which drifts beyond the next cron invocation.
 update pitacco_private.ifood_merchants set
 poll_after=case when p_ok then greatest(now(),date_bin(interval '30 seconds',poll_after-interval '90 seconds','2000-01-01 00:00:00+00'::timestamptz)+interval '30 seconds') else now()+interval '2 minutes' end,
 poll_lease=null,last_poll_ok=case when p_ok then now() else last_poll_ok end
 where merchant_id=p_merchant and poll_lease=p_lease and test_only and credential is null;
 if not found then return false;end if;
 insert into pitacco_private.ifood_shipping_test_poll_log(merchant_id,http,events,acknowledged,ok) values(p_merchant,p_http,greatest(p_events,0),greatest(p_acked,0),p_ok);
 delete from pitacco_private.ifood_shipping_test_poll_log where checked_at<now()-interval '7 days';
 return true;
end $$;
revoke all on function public.pitacco_ifood_shipping_test_finish_poll(uuid,uuid,integer,integer,integer,boolean) from public,anon,authenticated;
grant execute on function public.pitacco_ifood_shipping_test_finish_poll(uuid,uuid,integer,integer,integer,boolean) to service_role;;
