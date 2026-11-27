-- Disposable CI ONLY. No public enrollment endpoint or production verification.
-- Model the output of a future trusted phone-ownership verifier using synthetic data.
create schema core_wallet_test;
revoke all on schema core_wallet_test from public;
create table core_wallet_test.verified_devices(
 store_id uuid not null,
 device_hash text not null,
 phone text not null,
 verified_until timestamptz not null,
 revoked_at timestamptz,
 primary key(store_id,device_hash),
 foreign key(store_id,device_hash) references pitacco_private.customer_device_sessions(store_id,device_hash)
);
alter table core_wallet_test.verified_devices enable row level security;
revoke all on core_wallet_test.verified_devices from public,anon,authenticated;
create function core_wallet_test.read_wallet(p_slug text,p_device uuid)
returns jsonb language sql stable security definer set search_path='' as $$
 select public.pitacco_loyalty_phone_wallet(p_slug,s.phone)
 from public.public_menu_settings m
 join pitacco_private.customer_device_sessions s on s.store_id=m.store_id
 join core_wallet_test.verified_devices v on v.store_id=s.store_id and v.device_hash=s.device_hash and v.phone=s.phone
 where m.slug=p_slug and m.enabled
 and s.device_hash=encode(sha256(convert_to(p_device::text,'UTF8')),'hex')
 and s.revoked_at is null and s.expires_at>now()
 and v.revoked_at is null and v.verified_until>now()
 limit 1
$$;
revoke all on function core_wallet_test.read_wallet(text,uuid) from public,anon,authenticated;
create role pitacco_core_wallet login password 'ci-wallet-only' nosuperuser nocreatedb nocreaterole nobypassrls;
grant usage on schema core_wallet_test to pitacco_core_wallet;
grant execute on function core_wallet_test.read_wallet(text,uuid) to pitacco_core_wallet;
