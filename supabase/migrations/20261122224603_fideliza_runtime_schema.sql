-- Evolução das tabelas existentes; nenhum saldo histórico é atribuído por telefone.
-- Algumas instalações receberam os cupons sem a tabela de movimentos prevista no módulo.
create table if not exists public.loyalty_ledger (
 id uuid primary key default gen_random_uuid(),
 store_id uuid not null references public.stores(id) on delete cascade,
 customer_key text not null check(length(customer_key) between 1 and 160),
 order_id uuid references public.orders(id) on delete set null,
 event_type text not null check(event_type in ('earn','redeem','reverse','adjust')),
 points_delta integer not null,
 request_key uuid not null,
 created_at timestamptz not null default now(),
 unique(store_id,request_key)
);
create index if not exists loyalty_ledger_customer on public.loyalty_ledger(store_id,customer_key,created_at);
alter table public.loyalty_programs
 add column if not exists coupons_enabled boolean not null default true,
 add column if not exists campaigns_enabled boolean not null default false,
 add column if not exists cashback_enabled boolean not null default false,
 add column if not exists cashback_percent numeric(5,2) not null default 0 check(cashback_percent between 0 and 50),
 add column if not exists cashback_max_redeem_percent numeric(5,2) not null default 50 check(cashback_max_redeem_percent between 1 and 100),
 add column if not exists referrals_enabled boolean not null default false,
 add column if not exists referral_reward_cents integer not null default 0 check(referral_reward_cents between 0 and 100000),
 add column if not exists referral_welcome_cents integer not null default 0 check(referral_welcome_cents between 0 and 100000),
 add column if not exists minimum_order_cents integer not null default 0 check(minimum_order_cents between 0 and 1000000);

create table pitacco_private.loyalty_customers (
 id uuid primary key default gen_random_uuid(),
 store_id uuid not null references public.stores(id),
 name text not null check(length(trim(name)) between 2 and 120),
 phone text not null check(phone ~ '^[0-9]{10,13}$'),
 key_hash text not null check(length(key_hash)=64),
 referral_code text not null default upper(replace(gen_random_uuid()::text,'-','')),
 referred_by uuid references pitacco_private.loyalty_customers(id),
 referral_awarded_order_id uuid references public.orders(id),
 active boolean not null default true,
 created_at timestamptz not null default now(),
 unique(store_id,phone),unique(store_id,key_hash),unique(referral_code),unique(store_id,id)
);
create index loyalty_customers_created on pitacco_private.loyalty_customers(store_id,created_at);
alter table pitacco_private.loyalty_customers enable row level security;
revoke all on pitacco_private.loyalty_customers from public,anon,authenticated;

alter table public.loyalty_coupons
 add column if not exists starts_at timestamptz,
 add column if not exists kind text not null default 'coupon' check(kind in ('coupon','campaign','reward')),
 add column if not exists title text not null default '' check(length(title)<=120),
 add column if not exists target_customer_id uuid references pitacco_private.loyalty_customers(id),
 add column if not exists per_customer_limit integer check(per_customer_limit between 1 and 10000),
 add column if not exists reward_request_id uuid;
alter table public.loyalty_coupons add constraint loyalty_coupon_same_store_customer
 foreign key(store_id,target_customer_id) references pitacco_private.loyalty_customers(store_id,id);
alter table public.loyalty_ledger
 add column if not exists asset text not null default 'points' check(asset in ('points','orders','cashback')),
 add column if not exists metadata jsonb not null default '{}';
alter table public.loyalty_coupon_redemptions
 add column if not exists customer_id uuid references pitacco_private.loyalty_customers(id),
 add column if not exists state text not null default 'reserved' check(state in ('reserved','completed','cancelled'));
create index loyalty_redemptions_customer on public.loyalty_coupon_redemptions(store_id,coupon_id,customer_id,state);
-- Não depender dos privilégios padrão usados na criação das tabelas legadas.
revoke all on public.loyalty_ledger,public.loyalty_coupon_redemptions from public,anon,authenticated;
grant select on public.loyalty_ledger,public.loyalty_coupon_redemptions to authenticated;
alter table public.loyalty_ledger enable row level security;
alter table public.loyalty_coupon_redemptions enable row level security;
drop policy if exists loyalty_redemptions_read on public.loyalty_coupon_redemptions;
drop policy if exists loyalty_redemptions_manager on public.loyalty_coupon_redemptions;
create policy loyalty_redemptions_manager on public.loyalty_coupon_redemptions for select to authenticated
 using(public.is_store_manager(store_id));
drop policy if exists loyalty_ledger_manager on public.loyalty_ledger;
create policy loyalty_ledger_manager on public.loyalty_ledger for select to authenticated
 using(public.is_store_manager(store_id));

create table pitacco_private.loyalty_order_links (
 order_id uuid primary key references public.orders(id),
 store_id uuid not null references public.stores(id),
 customer_id uuid,
 request_id uuid not null,
 payload jsonb not null,
 response jsonb not null,
 rules jsonb not null,
 earned_at timestamptz,
 reversed_at timestamptz,
 created_at timestamptz not null default now(),
 unique(store_id,request_id),
 foreign key(store_id,customer_id) references pitacco_private.loyalty_customers(store_id,id)
);
alter table pitacco_private.loyalty_order_links enable row level security;
revoke all on pitacco_private.loyalty_order_links from public,anon,authenticated;
create index loyalty_links_customer on pitacco_private.loyalty_order_links(store_id,customer_id);

create function pitacco_private.loyalty_available(s uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select coalesce((select enabled from pitacco_private.store_feature_rules where store_id=s and feature='fideliza'),
 (select enabled from pitacco_private.store_feature_rules where store_id is null and feature='fideliza'),true)
$$;
create function pitacco_private.loyalty_rules(s uuid) returns jsonb
language sql stable security definer set search_path='' as $$
 select '{"points_enabled":false,"points_per_real":1,"min_points_to_redeem":100,"points_reward_cents":1000,"orders_enabled":false,"orders_required":10,"orders_reward_cents":1000,"coupons_enabled":true,"campaigns_enabled":false,"cashback_enabled":false,"cashback_percent":0,"cashback_max_redeem_percent":50,"referrals_enabled":false,"referral_reward_cents":0,"referral_welcome_cents":0,"minimum_order_cents":0}'::jsonb
 ||coalesce((select to_jsonb(p)-'store_id'-'updated_at' from public.loyalty_programs p where store_id=s),'{}'::jsonb)
$$;
create function pitacco_private.loyalty_customer(s uuid,k text) returns uuid
language sql stable security definer set search_path='' as $$
 select id from pitacco_private.loyalty_customers where store_id=s and active
 and k ~ '^[a-f0-9]{64}$' and key_hash=encode(sha256(convert_to(k,'UTF8')),'hex')
$$;
create function pitacco_private.loyalty_balance(s uuid,c uuid,a text) returns bigint
language sql stable security definer set search_path='' as $$
 select coalesce(sum(points_delta),0)::bigint from public.loyalty_ledger
 where store_id=s and customer_key=c::text and asset=a
$$;
revoke all on function pitacco_private.loyalty_available(uuid),pitacco_private.loyalty_rules(uuid),
 pitacco_private.loyalty_customer(uuid,text),pitacco_private.loyalty_balance(uuid,uuid,text) from public,anon,authenticated;

create function public.pitacco_loyalty_program(p_slug text) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare s uuid; rules jsonb;
begin
 select store_id into s from public.public_menu_settings where slug=p_slug and enabled;
 if s is null or not pitacco_private.loyalty_available(s) then return null;end if;
 rules:=pitacco_private.loyalty_rules(s);
 return jsonb_build_object('rules',rules,'campaigns',coalesce((select jsonb_agg(jsonb_build_object(
  'id',id,'title',title,'code',code,'discount_type',discount_type,'discount_value',discount_value,
  'minimum_order_cents',minimum_order_cents,'expires_at',expires_at))
  from public.loyalty_coupons where store_id=s and kind='campaign' and active
   and (rules->>'campaigns_enabled')::boolean and target_customer_id is null
   and (starts_at is null or starts_at<=now()) and (expires_at is null or expires_at>now())
   and (max_uses is null or uses<max_uses)),'[]'::jsonb));
end $$;
create function public.pitacco_loyalty_join(p_slug text,p_name text,p_phone text,p_referral text default '') returns jsonb
language plpgsql security definer set search_path='' as $$
declare s uuid; c uuid; inviter uuid; k text; v_phone text:=regexp_replace(coalesce(p_phone,''),'[^0-9]','','g');rules jsonb;
begin
 select store_id into s from public.public_menu_settings where slug=p_slug and enabled for update;
 if s is null or not pitacco_private.loyalty_available(s) then return jsonb_build_object('error','Fideliza+ indisponível');end if;
 rules:=pitacco_private.loyalty_rules(s);
 if not ((rules->>'points_enabled')::boolean or (rules->>'orders_enabled')::boolean or
  (rules->>'cashback_enabled')::boolean or (rules->>'referrals_enabled')::boolean or
  (rules->>'coupons_enabled')::boolean or (rules->>'campaigns_enabled')::boolean) then
  return jsonb_build_object('error','A loja ainda não ativou seus benefícios');end if;
 if length(trim(coalesce(p_name,''))) not between 2 and 120 or v_phone !~ '^[0-9]{10,13}$' then
  return jsonb_build_object('error','Informe nome e telefone com DDD');end if;
 if exists(select 1 from pitacco_private.loyalty_customers lc where lc.store_id=s and lc.phone=v_phone) then
  return jsonb_build_object('error','Use sua chave pessoal. Caso tenha perdido, solicite recuperação à loja.');
 end if;
 if (select count(*) from pitacco_private.loyalty_customers where store_id=s and created_at>now()-interval '1 minute')>=50 then
  return jsonb_build_object('error','Limite temporário de cadastros. Tente mais tarde.');end if;
 if coalesce(p_referral,'')<>'' then
  if not (rules->>'referrals_enabled')::boolean then return jsonb_build_object('error','Indicações não estão ativas nesta loja');end if;
  select id into inviter from pitacco_private.loyalty_customers lc
   where lc.store_id=s and lc.referral_code=upper(trim(p_referral)) and lc.phone<>v_phone and lc.active;
  if inviter is null then return jsonb_build_object('error','Indicação inválida para esta loja');end if;
 end if;
 k:=replace(gen_random_uuid()::text||gen_random_uuid()::text,'-','');
 insert into pitacco_private.loyalty_customers(store_id,name,phone,key_hash,referred_by)
 values(s,public.dg_clean_text(trim(p_name)),v_phone,encode(sha256(convert_to(k,'UTF8')),'hex'),inviter) returning id into c;
 return jsonb_build_object('key',k,'customer_id',c);
end $$;

create function public.pitacco_loyalty_wallet(p_slug text,p_key text) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare s uuid;c uuid;result jsonb;rules jsonb;
begin
 select store_id into s from public.public_menu_settings where slug=p_slug and enabled;
 c:=pitacco_private.loyalty_customer(s,p_key);
 if c is null or not pitacco_private.loyalty_available(s) then return jsonb_build_object('error','Chave pessoal inválida para esta loja');end if;
 rules:=pitacco_private.loyalty_rules(s);
 select jsonb_build_object('customer_id',lc.id,'name',lc.name,'phone',lc.phone,'referral_code',lc.referral_code,
  'points',greatest(0,pitacco_private.loyalty_balance(s,c,'points')),
  'orders',greatest(0,pitacco_private.loyalty_balance(s,c,'orders')),
  'cashback_cents',greatest(0,pitacco_private.loyalty_balance(s,c,'cashback')),
  'rules',rules,
  'offers',coalesce((select jsonb_agg(jsonb_build_object('id',cp.id,'title',cp.title,'code',cp.code,
   'discount_type',cp.discount_type,'discount_value',cp.discount_value,'minimum_order_cents',cp.minimum_order_cents,
   'expires_at',cp.expires_at,'personal',true)) from public.loyalty_coupons cp
   where cp.store_id=s and cp.target_customer_id=c and cp.kind in ('coupon','campaign') and cp.active
    and ((cp.kind='coupon' and (rules->>'coupons_enabled')::boolean) or (cp.kind='campaign' and (rules->>'campaigns_enabled')::boolean))
    and (cp.starts_at is null or cp.starts_at<=now()) and (cp.expires_at is null or cp.expires_at>now())
    and (cp.max_uses is null or cp.uses<cp.max_uses)
    and (cp.per_customer_limit is null or (select count(*) from public.loyalty_coupon_redemptions r
      where r.coupon_id=cp.id and r.store_id=s and r.customer_id=c and r.state<>'cancelled')<cp.per_customer_limit)),'[]'::jsonb),
  'history',coalesce((select jsonb_agg(to_jsonb(h)) from (select asset,points_delta,event_type,created_at
   from public.loyalty_ledger where store_id=s and customer_key=c::text order by created_at desc,id desc limit 30) h),'[]'::jsonb))
 into result from pitacco_private.loyalty_customers lc where id=c;
 return result;
end $$;

create function public.pitacco_loyalty_customers(p_store uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
 if auth.uid() is null or not public.is_store_manager(p_store) then raise exception 'Somente gestor consulta o Fideliza+' using errcode='42501';end if;
 return coalesce((select jsonb_agg(jsonb_build_object('id',c.id,'name',c.name,'phone',c.phone,
  'points',pitacco_private.loyalty_balance(p_store,c.id,'points'),
  'orders',pitacco_private.loyalty_balance(p_store,c.id,'orders'),
  'cashback_cents',pitacco_private.loyalty_balance(p_store,c.id,'cashback')) order by c.name)
  from pitacco_private.loyalty_customers c where store_id=p_store),'[]'::jsonb);
end $$;
create function public.pitacco_loyalty_reset_key(p_store uuid,p_customer uuid) returns text
language plpgsql security definer set search_path='' as $$
declare k text:=replace(gen_random_uuid()::text||gen_random_uuid()::text,'-','');
begin
 if auth.uid() is null or not public.is_store_manager(p_store) then raise exception 'Somente gestor recupera acesso' using errcode='42501';end if;
 update pitacco_private.loyalty_customers set key_hash=encode(sha256(convert_to(k,'UTF8')),'hex') where id=p_customer and store_id=p_store and active;
 if not found then raise exception 'Cliente não encontrado nesta loja';end if;
 insert into public.operation_audit(store_id,actor,action,details) values(p_store,auth.uid(),'loyalty_key_rotated',jsonb_build_object('customer',p_customer));
 return k;
end $$;
revoke all on function public.pitacco_loyalty_program(text),public.pitacco_loyalty_join(text,text,text,text),public.pitacco_loyalty_wallet(text,text),
 public.pitacco_loyalty_customers(uuid),public.pitacco_loyalty_reset_key(uuid,uuid) from public,anon,authenticated;
grant execute on function public.pitacco_loyalty_program(text),public.pitacco_loyalty_join(text,text,text,text),public.pitacco_loyalty_wallet(text,text) to anon,authenticated;
grant execute on function public.pitacco_loyalty_customers(uuid),public.pitacco_loyalty_reset_key(uuid,uuid) to authenticated;
