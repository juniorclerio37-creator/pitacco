-- WhatsApp notifications: store-scoped settings and durable event outbox.
-- Actual sending requires an authenticated backend worker and official WhatsApp Business API.
begin;
create table if not exists public.store_whatsapp_settings (
 store_id uuid primary key references public.stores(id) on delete cascade,
 enabled boolean not null default false,
 business_phone_display text,
 provider_account_id text,
 provider_phone_number_id text,
 message_templates jsonb not null default '{}'::jsonb,
 event_enabled jsonb not null default '{"accepted":true,"preparing":true,"ready":true,"out_for_delivery":true,"ready_for_pickup":true,"delivered":true}'::jsonb,
 updated_at timestamptz not null default now()
);
create table if not exists public.store_whatsapp_outbox (
 id uuid primary key default gen_random_uuid(),
 store_id uuid not null references public.stores(id) on delete cascade,
 order_id uuid not null,
 event_type text not null check(event_type in ('accepted','preparing','ready','out_for_delivery','ready_for_pickup','delivered')),
 status text not null default 'pending' check(status in ('pending','processing','sent','failed','skipped')),
 attempt_count integer not null default 0,
 next_attempt_at timestamptz,
 provider_message_id text,
 last_error_code text,
 created_at timestamptz not null default now(),
 sent_at timestamptz,
 unique(store_id,order_id,event_type)
);
create index if not exists whatsapp_outbox_pending on public.store_whatsapp_outbox(status,next_attempt_at) where status in ('pending','failed');
alter table public.store_whatsapp_settings enable row level security;
alter table public.store_whatsapp_outbox enable row level security;
drop policy if exists whatsapp_settings_store_read on public.store_whatsapp_settings;
create policy whatsapp_settings_store_read on public.store_whatsapp_settings for select to authenticated using(public.is_store_manager(store_id));
drop policy if exists whatsapp_outbox_store_read on public.store_whatsapp_outbox;
create policy whatsapp_outbox_store_read on public.store_whatsapp_outbox for select to authenticated using(public.is_store_manager(store_id));
revoke all on public.store_whatsapp_settings,public.store_whatsapp_outbox from anon,authenticated;
grant select on public.store_whatsapp_settings,public.store_whatsapp_outbox to authenticated;
-- Write via validated store-scoped RPCs only. Credentials remain in server secrets,
-- never in these tables or frontend code.
-- Worker must verify order belongs to store, opted-in recipient, event source is own
-- digital menu, authorized templates, deduplication and valid signed tracking URL.
commit;
