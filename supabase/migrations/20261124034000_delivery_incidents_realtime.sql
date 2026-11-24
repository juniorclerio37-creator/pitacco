-- Realtime subscriptions still apply the incident table RLS to every subscriber.
do $$begin
 if exists(select 1 from pg_publication where pubname='supabase_realtime')
 and not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='pitacco_delivery_incidents') then
 alter publication supabase_realtime add table public.pitacco_delivery_incidents;
 end if;
end $$;
