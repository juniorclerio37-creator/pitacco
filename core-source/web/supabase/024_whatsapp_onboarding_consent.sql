-- Privacy and delivery prerequisites for per-store WhatsApp onboarding.
-- Apply after migration 023.
begin;
create table if not exists public.store_whatsapp_onboarding_sessions(
 id uuid primary key default gen_random_uuid(),
 store_id uuid not null references public.stores(id) on delete cascade,
 requested_by uuid not null references auth.users(id),
 state_hash text not null unique,
 expires_at timestamptz not null,
 consumed_at timestamptz,
 created_at timestamptz not null default now()
);
create index if not exists whatsapp_onboarding_sessions_store on public.store_whatsapp_onboarding_sessions(store_id,expires_at);
alter table public.store_whatsapp_onboarding_sessions enable row level security;
revoke all on public.store_whatsapp_onboarding_sessions from public,anon,authenticated;
-- Server-side functions with service credentials own session creation and completion.
create table if not exists public.store_whatsapp_opt_ins(
 store_id uuid not null references public.stores(id) on delete cascade,
 phone_e164 text not null,
 consented_at timestamptz not null,
 consent_source text not null,
 revoked_at timestamptz,
 primary key(store_id,phone_e164),
 constraint whatsapp_optin_phone check(phone_e164 ~ '^\\+[1-9][0-9]{7,14}$')
);
alter table public.store_whatsapp_opt_ins enable row level security;
revoke all on public.store_whatsapp_opt_ins from public,anon,authenticated;
-- Consent must be written by validated server-side checkout or opt-out webhook.
-- Never trust a client-submitted consent flag without linking to its order.
commit;
