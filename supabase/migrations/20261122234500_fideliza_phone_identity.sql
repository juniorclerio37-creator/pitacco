-- Fideliza+ por telefone. Nenhuma chave pessoal é exibida ou criada para o cliente.
-- A credencial técnica de sessão é temporária, vinculada ao usuário com telefone
-- confirmado pelo Supabase Auth e não permite consulta anônima por telefone.
create or replace function public.pitacco_can_manage_store(p_store_id uuid)
returns boolean language sql stable security definer set search_path='' as $$
 select (select auth.uid()) is not null and (
  public.is_admin() or exists (
   select 1 from public.store_members m
   where m.store_id=p_store_id and m.user_id=(select auth.uid())
     and m.role in ('lojista','gestor')
  )
 )
$$;

alter table pitacco_private.loyalty_customers alter column key_hash drop not null;

create table if not exists pitacco_private.loyalty_sessions (
 token_hash text primary key check (token_hash ~ '^[a-f0-9]{64}$'),
 store_id uuid not null references public.stores(id) on delete cascade,
 customer_id uuid not null,
 auth_user_id uuid not null references auth.users(id) on delete cascade,
 created_at timestamptz not null default now(),
 expires_at timestamptz not null,
 foreign key (store_id, customer_id)
  references pitacco_private.loyalty_customers(store_id,id) on delete cascade
);
create index if not exists loyalty_sessions_owner
on pitacco_private.loyalty_sessions (store_id,customer_id,auth_user_id,expires_at);
alter table pitacco_private.loyalty_sessions enable row level security;
revoke all on pitacco_private.loyalty_sessions from public,anon,authenticated;

create or replace function pitacco_private.loyalty_normal_phone(raw text)
returns text language sql immutable set search_path='' as $$
 select case
  when length(regexp_replace(coalesce(raw,''),'[^0-9]','','g')) in (12,13)
   and left(regexp_replace(coalesce(raw,''),'[^0-9]','','g'),2)='55'
  then substr(regexp_replace(coalesce(raw,''),'[^0-9]','','g'),3)
  else regexp_replace(coalesce(raw,''),'[^0-9]','','g')
 end
$$;
create or replace function pitacco_private.loyalty_verified_phone()
returns text language sql stable security definer set search_path='' as $$
 select pitacco_private.loyalty_normal_phone(u.phone)
 from auth.users u
 where u.id=(select auth.uid()) and u.phone is not null
   and u.phone_confirmed_at is not null
 limit 1
$$;
revoke all on function pitacco_private.loyalty_normal_phone(text),
 pitacco_private.loyalty_verified_phone() from public,anon,authenticated;

-- Substitui a verificação por chave permanente por sessões curtas,
-- emitidas apenas após prova de posse do telefone via Auth.
create or replace function pitacco_private.loyalty_customer(s uuid,k text)
returns uuid language sql stable security definer set search_path='' as $$
 select ls.customer_id
 from pitacco_private.loyalty_sessions ls
 join pitacco_private.loyalty_customers c
   on c.id=ls.customer_id and c.store_id=ls.store_id
 where ls.store_id=s and ls.auth_user_id=(select auth.uid())
   and ls.expires_at>now()
   and c.active and k ~ '^[a-f0-9]{64}$'
   and ls.token_hash=encode(sha256(convert_to(k,'UTF8')),'hex')
 limit 1
$$;
revoke all on function pitacco_private.loyalty_customer(uuid,text)
 from public,anon,authenticated;

create or replace function public.pitacco_loyalty_phone_access(
 p_slug text,p_name text,p_phone text,p_referral text default ''
) returns jsonb language plpgsql security definer set search_path='' as $$
declare s uuid;c uuid;inviter uuid;token text;
 v_phone text:=pitacco_private.loyalty_normal_phone(p_phone);
 v_verified text:=pitacco_private.loyalty_verified_phone();
begin
 if (select auth.uid()) is null or v_verified is null
   or v_phone not between '0000000000' and '99999999999'
   or length(v_phone) not in (10,11) or v_phone<>v_verified then
  raise exception 'Confirme o telefone por SMS para acessar o Fideliza+'
   using errcode='42501';
 end if;
 select store_id into s from public.public_menu_settings
  where slug=p_slug and enabled for share;
 if s is null or not pitacco_private.loyalty_available(s) then
  raise exception 'Fideliza+ indisponível para esta loja';
 end if;
 select id into c from pitacco_private.loyalty_customers
  where store_id=s and phone=v_phone and active for update;
 if c is null then
  if length(trim(coalesce(p_name,''))) not between 2 and 120 then
   raise exception 'Informe seu nome para participar do Fideliza+';
  end if;
  if (select count(*) from pitacco_private.loyalty_customers
    where store_id=s and created_at>now()-interval '1 minute')>=50 then
   raise exception 'Muitos cadastros nesta loja. Tente mais tarde.';
  end if;
  if trim(coalesce(p_referral,''))<>'' then
   if not (pitacco_private.loyalty_rules(s)->>'referrals_enabled')::boolean then
    raise exception 'Indicações não estão ativas nesta loja';
   end if;
   select id into inviter from pitacco_private.loyalty_customers
   where store_id=s and referral_code=upper(trim(p_referral))
     and phone<>v_phone and active;
   if inviter is null then raise exception 'Indicação inválida para esta loja';end if;
  end if;
  insert into pitacco_private.loyalty_customers
   (store_id,name,phone,key_hash,referred_by)
  values(s,public.dg_clean_text(trim(p_name)),v_phone,null,inviter)
  on conflict(store_id,phone) do nothing returning id into c;
  if c is null then
   select id into c from pitacco_private.loyalty_customers
    where store_id=s and phone=v_phone and active for update;
  end if;
 end if;
 if c is null then raise exception 'Carteira indisponível';end if;
 token:=replace(gen_random_uuid()::text,'-','')||
        replace(gen_random_uuid()::text,'-','');
 insert into pitacco_private.loyalty_sessions
  (store_id,customer_id,auth_user_id,token_hash,expires_at)
 values (s,c,(select auth.uid()),
  encode(sha256(convert_to(token,'UTF8')),'hex'),now()+interval '30 days');
 return jsonb_build_object('session_token',token,'customer_id',c);
end $$;
revoke all on function public.pitacco_loyalty_phone_access(text,text,text,text)
 from public,anon,authenticated;
grant execute on function public.pitacco_loyalty_phone_access(text,text,text,text)
 to authenticated;

-- O endpoint legado deixa de fornecer chave a quem apenas informa o telefone.
create or replace function public.pitacco_loyalty_join(
 p_slug text,p_name text,p_phone text,p_referral text default ''
) returns jsonb language plpgsql security invoker set search_path='' as $$
begin
 return public.pitacco_loyalty_phone_access(p_slug,p_name,p_phone,p_referral);
end $$;
revoke all on function public.pitacco_loyalty_join(text,text,text,text)
 from public,anon,authenticated;
grant execute on function public.pitacco_loyalty_join(text,text,text,text)
 to authenticated;
revoke execute on function public.pitacco_loyalty_reset_key(uuid,uuid) from authenticated;

-- Todo pedido próprio vinculado pelo checkout Fideliza+ acumula pelo telefone,
-- sem exigir login. A consulta e os resgates continuam exigindo SMS verificado.
do $migration$
declare fn regprocedure:=
 'public.pitacco_loyalty_checkout(text,uuid,text,text,text,jsonb,text,text,text,text,text,text,uuid,timestamptz,text)'::regprocedure;
 definition text;needle text;replacement text;
begin
 definition:=pg_get_functiondef(fn);
 needle:=' insert into pitacco_private.loyalty_order_links(order_id,store_id,customer_id,request_id,payload,response,rules)';
 if strpos(definition,needle)=0 then
  raise exception 'Checkout Fideliza+ mudou; revisão manual obrigatória';
 end if;
 replacement:=$patch$
 -- O número identifica a carteira para o ACÚMULO, nunca autoriza resgate.
 -- O cliente só gasta saldo quando p_key é uma sessão autenticada válida.
 if c is null and pitacco_private.loyalty_normal_phone(v_phone) ~ '^[0-9]{10,11}$' then
  select lc.id into c from pitacco_private.loyalty_customers lc
   where lc.store_id=s and lc.phone=pitacco_private.loyalty_normal_phone(v_phone)
     and lc.active for update;
  if c is null then
   insert into pitacco_private.loyalty_customers(store_id,name,phone,key_hash)
   values(s,public.dg_clean_text(trim(p_customer)),
    pitacco_private.loyalty_normal_phone(v_phone),null)
   on conflict(store_id,phone) do nothing returning id into c;
   if c is null then
    select lc.id into c from pitacco_private.loyalty_customers lc
     where lc.store_id=s and lc.phone=pitacco_private.loyalty_normal_phone(v_phone)
       and lc.active for update;
   end if;
  end if;
 end if;
 insert into pitacco_private.loyalty_order_links(order_id,store_id,customer_id,request_id,payload,response,rules)$patch$;
 execute replace(definition,needle,replacement);
end $migration$;
