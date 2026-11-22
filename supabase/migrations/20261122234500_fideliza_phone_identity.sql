-- Fideliza+ vinculado ao telefone do pedido, sem cadastro e sem chave pessoal.
-- Apenas totais e benefícios são expostos pelo telefone: nenhum nome,
-- endereço, telefone de retorno ou histórico detalhado é fornecido na consulta.
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

create or replace function pitacco_private.loyalty_normal_phone(raw text)
returns text language sql immutable set search_path='' as $$
 select case
  when length(regexp_replace(coalesce(raw,''),'[^0-9]','','g')) in (12,13)
   and left(regexp_replace(coalesce(raw,''),'[^0-9]','','g'),2)='55'
  then substr(regexp_replace(coalesce(raw,''),'[^0-9]','','g'),3)
  else regexp_replace(coalesce(raw,''),'[^0-9]','','g')
 end
$$;
revoke all on function pitacco_private.loyalty_normal_phone(text) from public,anon,authenticated;

-- Identifica o cliente apenas dentro da loja informada. Cria o vínculo na
-- PRIMEIRA COMPRA, no mesmo commit de checkout, nunca em mera consulta.
-- A função interna será criada com variável explícita para evitar ambiguidades.
create or replace function pitacco_private.loyalty_customer_for_order(
 s uuid, customer_name text, raw_phone text, p_referral_code text default ''
) returns uuid language plpgsql security definer set search_path='' as $$
declare c uuid;referrer uuid;v_phone text:=pitacco_private.loyalty_normal_phone(raw_phone);
begin
 if v_phone !~ '^[0-9]{10,11}$' then raise exception 'Informe um celular com DDD válido';end if;
 select lc.id into c from pitacco_private.loyalty_customers lc
  where lc.store_id=s and lc.phone=v_phone and lc.active for update;
 if c is not null then return c;end if;
 if length(trim(coalesce(customer_name,''))) not between 2 and 120 then
  raise exception 'Informe o nome do cliente';end if;
 if coalesce(trim(p_referral_code),'')<>'' then
  if not (pitacco_private.loyalty_rules(s)->>'referrals_enabled')::boolean then
   raise exception 'Indicações não estão ativas nesta loja';end if;
  select lc.id into referrer from pitacco_private.loyalty_customers lc
   where lc.store_id=s and lc.referral_code=upper(trim(p_referral_code))
     and phone<>v_phone and active;
  if referrer is null then raise exception 'Indicação inválida para esta loja';end if;
 end if;
 insert into pitacco_private.loyalty_customers
  (store_id,name,phone,key_hash,referred_by)
 values (s,public.dg_clean_text(trim(customer_name)),v_phone,null,referrer)
 on conflict(store_id,phone) do nothing returning id into c;
 if c is null then
  select id into c from pitacco_private.loyalty_customers
   where store_id=s and phone=v_phone and active for update;
 end if;
 if c is null then raise exception 'Não foi possível vincular o telefone do cliente';end if;
 return c;
end $$;
revoke all on function pitacco_private.loyalty_customer_for_order(uuid,text,text,text)
 from public,anon,authenticated;

-- Interface pública por telefone: mostra apenas a pontuação, quantidade
-- de pedidos, créditos e benefícios disponíveis nesta loja.
create function public.pitacco_loyalty_phone_wallet(p_slug text,p_phone text)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare s uuid;c uuid;rules jsonb;v_phone text:=pitacco_private.loyalty_normal_phone(p_phone);
begin
 if v_phone !~ '^[0-9]{10,11}$' then
  return jsonb_build_object('error','Informe o telefone com DDD');
 end if;
 select store_id into s from public.public_menu_settings where slug=p_slug and enabled;
 if s is null or not pitacco_private.loyalty_available(s) then
  return jsonb_build_object('error','Fideliza+ indisponível');
 end if;
 rules:=pitacco_private.loyalty_rules(s);
 select id into c from pitacco_private.loyalty_customers
  where store_id=s and phone=v_phone and active;
 return jsonb_build_object(
  'linked',c is not null,
  'points',case when c is null then 0 else greatest(0,pitacco_private.loyalty_balance(s,c,'points')) end,
  'orders',case when c is null then 0 else greatest(0,pitacco_private.loyalty_balance(s,c,'orders')) end,
  'cashback_cents',case when c is null then 0 else greatest(0,pitacco_private.loyalty_balance(s,c,'cashback')) end,
  'rules',rules,
  'referral_code',case when (rules->>'referrals_enabled')::boolean and c is not null then
   (select referral_code from pitacco_private.loyalty_customers where id=c and store_id=s) end,
  'offers',coalesce((select jsonb_agg(jsonb_build_object(
     'id',cp.id,'title',cp.title,'code',cp.code,
     'discount_type',cp.discount_type,'discount_value',cp.discount_value,
     'minimum_order_cents',cp.minimum_order_cents,'expires_at',cp.expires_at,'personal',true
   )) from public.loyalty_coupons cp
   where cp.store_id=s and cp.target_customer_id=c and cp.kind in ('coupon','campaign')
    and cp.active and ((cp.kind='coupon' and (rules->>'coupons_enabled')::boolean)
      or (cp.kind='campaign' and (rules->>'campaigns_enabled')::boolean))
    and (cp.starts_at is null or cp.starts_at<=now()) and (cp.expires_at is null or cp.expires_at>now())
    and (cp.max_uses is null or cp.uses<cp.max_uses)
    and (cp.per_customer_limit is null or (select count(*) from public.loyalty_coupon_redemptions r
      where r.coupon_id=cp.id and r.store_id=s and r.customer_id=c and r.state<>'cancelled')<cp.per_customer_limit))
   ,'[]'::jsonb),
  'history','[]'::jsonb
 );
end $$;
revoke all on function public.pitacco_loyalty_phone_wallet(text,text) from public,anon,authenticated;
grant execute on function public.pitacco_loyalty_phone_wallet(text,text) to anon,authenticated;

-- Nenhuma API pública deve gerar ou recuperar uma chave permanente.
revoke execute on function public.pitacco_loyalty_join(text,text,text,text),
 public.pitacco_loyalty_wallet(text,text) from anon,authenticated;
revoke execute on function public.pitacco_loyalty_reset_key(uuid,uuid) from authenticated;

-- Preserva a assinatura RPC do checkout usada nas outras modalidades.
-- p_key não é credencial: neste fluxo serve só ao código de indicação opcional.
-- O resgate e o cálculo são atômicos e permanecem limitados ao telefone do pedido.
do $migration$
declare fn regprocedure:=
 'public.pitacco_loyalty_checkout(text,uuid,text,text,text,jsonb,text,text,text,text,text,text,uuid,timestamptz,text)'::regprocedure;
 definition text;needle text;replacement text;
begin
 definition:=pg_get_functiondef(fn);
 needle:=$old$
 if coalesce(p_key,'')<>'' then
  c:=pitacco_private.loyalty_customer(s,p_key);
  if c is null then raise exception 'Chave pessoal inválida';end if;
  perform 1 from pitacco_private.loyalty_customers where id=c and store_id=s and phone=v_phone for update;
  if not found then raise exception 'Use o telefone da sua carteira no pedido';end if;
 end if;$old$;
 replacement:=$new$
 -- Identificação automática pelo telefone informado no checkout.
 c:=pitacco_private.loyalty_customer_for_order(s,p_customer,v_phone,p_key);$new$;
 if strpos(definition,needle)=0 then
  raise exception 'Checkout Fideliza+ mudou, interrompendo migração para não alterar regras desconhecidas';
 end if;
 execute replace(definition,needle,replacement);
end $migration$;

-- Prévia de resgate identifica a mesma carteira pelo telefone informado,
-- sem chave de acesso, preservando a validação de saldo e de desconto.
do $migration$
declare fn regprocedure:='public.pitacco_loyalty_preview(text,jsonb,text,text,text)'::regprocedure;
 definition text;needle text;replacement text;
begin
 definition:=pg_get_functiondef(fn);
 needle:='c:=pitacco_private.loyalty_customer(s,p_key);subtotal:=';
 replacement:=$new$
 select id into c from pitacco_private.loyalty_customers
 where store_id=s and phone=pitacco_private.loyalty_normal_phone(p_key) and active;
 subtotal:=$new$;
 if strpos(definition,needle)=0 then
  raise exception 'Prévia Fideliza+ mudou: revisão necessária';
 end if;
 execute replace(definition,needle,replacement);
end $migration$;
