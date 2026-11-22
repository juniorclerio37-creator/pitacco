-- Compatibilidade do banco real e dos ambientes isolados:
-- tabela de códigos próprios e tamanho configurável (4 a 8 dígitos).
create table if not exists public.pitacco_own_delivery_codes(
 delivery_id uuid primary key references public.deliveries(id) on delete cascade,
 store_id uuid not null references public.stores(id) on delete cascade,
 code text not null,
 attempts integer not null default 0,
 created_at timestamptz not null default now()
);
alter table public.pitacco_own_delivery_codes enable row level security;
revoke all on table public.pitacco_own_delivery_codes from public,anon,authenticated;

alter table public.pitacco_own_delivery_codes
 drop constraint if exists pitacco_own_delivery_codes_code_check;
alter table public.pitacco_own_delivery_codes
 add constraint pitacco_own_delivery_codes_code_check check(code ~ '^[0-9]{4,8}$');
