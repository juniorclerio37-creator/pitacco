-- SYNTHETIC CI ONLY. Do not apply to any production database.
create role pitacco_core_auth login password 'ci-auth-only' nosuperuser nocreatedb nocreaterole nobypassrls;
create schema core_auth;
revoke all on schema core_auth from public;
create table core_auth.users(id uuid primary key,email text not null unique,password_hash text not null,active boolean not null default true);
create table core_auth.stores(id uuid primary key,name text not null,active boolean not null default true);
create table core_auth.memberships(user_id uuid references core_auth.users,store_id uuid references core_auth.stores,role text not null check(role in ('owner','manager','operator','courier')),active boolean not null default true,primary key(user_id,store_id));
create table core_auth.sessions(id uuid primary key default gen_random_uuid(),user_id uuid not null references core_auth.users,token_hash text not null unique,expires_at timestamptz not null,revoked_at timestamptz);
insert into core_auth.users values
('10000000-0000-4000-8000-000000000001','alice@example.test',:'password_hash',true),
('10000000-0000-4000-8000-000000000002','bob@example.test',:'password_hash',true),
('10000000-0000-4000-8000-000000000003','disabled@example.test',:'password_hash',false);
insert into core_auth.stores values
('20000000-0000-4000-8000-000000000001','Loja A',true),
('20000000-0000-4000-8000-000000000002','Loja B',true);
insert into core_auth.memberships values
('10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','owner',true),
('10000000-0000-4000-8000-000000000002','20000000-0000-4000-8000-000000000002','operator',true);
grant usage on schema core_auth to pitacco_core_auth;
grant select on core_auth.users,core_auth.stores,core_auth.memberships,core_auth.sessions to pitacco_core_auth;
grant insert(user_id,token_hash,expires_at),update(revoked_at) on core_auth.sessions to pitacco_core_auth;
