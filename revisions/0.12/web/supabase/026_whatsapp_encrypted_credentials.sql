-- Applied to Pitacco Supabase as pitacco_whatsapp_encrypted_store_credentials.
create table if not exists public.store_whatsapp_credentials (
  store_id uuid primary key references public.stores(id) on delete cascade,
  token_ciphertext text not null,
  token_iv text not null,
  token_key_version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.store_whatsapp_credentials enable row level security;
revoke all on public.store_whatsapp_credentials from public, anon, authenticated;
create index if not exists whatsapp_onboarding_session_lookup on public.store_whatsapp_onboarding_sessions(store_id,requested_by,expires_at) where consumed_at is null;
