-- Run in the target Supabase project's SQL Editor or connector.
-- Replace PITACCO_PROJECT_URL with that project's HTTPS origin before applying.
select cron.schedule('pitacco-ifood-orders', '30 seconds', $cron$
  with ticket as (
    update pitacco_private.ifood_control control
    set queue_key=gen_random_uuid(),queue_expires_at=now()+interval '25 seconds'
    where exists (
    select 1 from pitacco_private.ifood_merchants m where m.enabled and
      ((m.credential is not null and (m.test_only or control.merchant_linking) and m.poll_after<=now())
        or exists (select 1 from pitacco_private.ifood_events e
          where e.merchant_id=m.merchant_id and e.done_at is null and e.attempts<10 and e.run_at<=now()))
    )
    returning queue_key
  )
  select net.http_post(
    url := 'PITACCO_PROJECT_URL/functions/v1/ifood-orders/retry',
    headers := jsonb_build_object('Content-Type','application/json','x-pitacco-queue-secret',ticket.queue_key),
    body := '{}'::jsonb,
    timeout_milliseconds := 28000
  )
  from ticket;
$cron$);
