-- Deployment candidate, only after schema and UI are validated in staging.
-- Supabase pg_cron must already be enabled. The routine only updates drafts.
select cron.schedule('pitacco-commercial-closings','5 * * * *','select pitacco_private.refresh_commercial_closings();');
