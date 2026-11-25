-- Run only in the intended Pitacco production project.
select cron.schedule('pitacco-ifood-central-check','* * * * *',$cron$
 with ticket as (
  insert into pitacco_private.ifood_central_check_ticket(singleton,ticket,expires_at)
  select true,gen_random_uuid(),now()+interval '45 seconds'
  where exists(select 1 from pitacco_private.ifood_central_requests where state='awaiting' and (last_checked_at is null or last_checked_at<now()-interval '55 seconds'))
    and coalesce((select merchant_linking from pitacco_private.ifood_control),false)
  on conflict(singleton) do update set ticket=excluded.ticket,expires_at=excluded.expires_at
  returning ticket
 )
 select net.http_post(url:='https://mdevzehqcpcgxspwbiyz.supabase.co/functions/v1/ifood-central-check',headers:=jsonb_build_object('Content-Type','application/json','x-pitacco-central-ticket',ticket.ticket),body:='{}'::jsonb,timeout_milliseconds:=25000) from ticket;
$cron$);
