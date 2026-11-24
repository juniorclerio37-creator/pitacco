create table if not exists public.pitacco_pizza_drafts (
 store_id uuid not null,
 id uuid primary key default gen_random_uuid(),
 name text not null check (length(trim(name)) between 1 and 180),
 config jsonb not null check (jsonb_typeof(config)='object' and octet_length(config::text)<=262144),
 updated_at timestamptz not null default now()
);
alter table public.pitacco_pizza_drafts enable row level security;
revoke all on public.pitacco_pizza_drafts from public,anon,authenticated;
grant select,insert,update,delete on public.pitacco_pizza_drafts to authenticated;
create policy pizza_draft_manager on public.pitacco_pizza_drafts for all to authenticated using (public.is_store_manager(store_id)) with check (public.is_store_manager(store_id));
notify pgrst,'reload schema';
