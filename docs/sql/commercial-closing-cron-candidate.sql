-- Deployment candidate, only after schema and UI are validated in staging.
-- Supabase pg_cron must already be enabled. The routine refreshes statements and issues immutable invoices. Activate only after the payment channel and contract rollout are ready.
select cron.schedule('pitacco-commercial-closings','5 * * * *','select pitacco_private.run_commercial_billing();');
