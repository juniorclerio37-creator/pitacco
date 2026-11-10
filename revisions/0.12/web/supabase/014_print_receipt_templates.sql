-- Pitacco 0.13: store-isolated receipt templates. Apply only after 010_acceptance_printing.sql.
-- Non-destructive: existing print sectors, jobs and orders remain unchanged.
begin;
create table if not exists public.print_receipt_templates (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  sector text not null default 'geral' check (length(trim(sector)) between 1 and 80),
  name text not null check (length(trim(name)) between 1 and 120),
  html text not null check (length(html) between 1 and 32768),
  paper_width integer not null default 80 check (paper_width in (58,80)),
  is_default boolean not null default false,
  updated_at timestamptz not null default now(),
  unique (store_id,sector,name)
);
create unique index if not exists print_receipt_templates_one_default
 on public.print_receipt_templates(store_id,sector) where is_default;
create index if not exists print_receipt_templates_store_sector
 on public.print_receipt_templates(store_id,sector);
alter table public.print_receipt_templates enable row level security;
drop policy if exists print_receipt_templates_manager on public.print_receipt_templates;
create policy print_receipt_templates_manager on public.print_receipt_templates
 for all to authenticated
 using (public.is_store_manager(store_id))
 with check (public.is_store_manager(store_id));
revoke all on public.print_receipt_templates from anon;
grant select,insert,update,delete on public.print_receipt_templates to authenticated;
comment on table public.print_receipt_templates is
 'Store-scoped receipt markup. Render only through sanitized, script-disabled thermal template engine.';
commit;
