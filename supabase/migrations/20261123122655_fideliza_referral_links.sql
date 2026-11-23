-- Generate the existing referral capability on explicit customer request only.
-- No points, credit, orders or financial history are created here.
create or replace function public.pitacco_loyalty_referral_link(p_slug text,p_phone text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare s uuid;c pitacco_private.loyalty_customers%rowtype;
 v_phone text:=pitacco_private.loyalty_normal_phone(p_phone);
begin
 if v_phone !~ '^[0-9]{10,11}$' then raise exception 'Informe seu celular com DDD';end if;
 select store_id into s from public.public_menu_settings where slug=p_slug and enabled for update;
 if s is null or not pitacco_private.loyalty_available(s) or
  not (pitacco_private.loyalty_rules(s)->>'referrals_enabled')::boolean then
  raise exception 'Indicações não estão ativas nesta loja';end if;
 select * into c from pitacco_private.loyalty_customers where store_id=s and phone=v_phone for update;
 if found and not c.active then raise exception 'Indicação indisponível para este cadastro';end if;
 if c.id is null then
  if (select count(*) from pitacco_private.loyalty_customers where store_id=s and created_at>now()-interval '1 hour')>=1000 then
   raise exception 'Limite temporário de cadastros. Tente novamente mais tarde';end if;
  insert into pitacco_private.loyalty_customers(store_id,name,phone,key_hash)
   values(s,'Cliente Fideliza+',v_phone,null) returning * into c;
  insert into public.operation_audit(store_id,action,details)
   values(s,'loyalty_referral_link_created',jsonb_build_object('customer',c.id));
 end if;
 return jsonb_build_object('referral_code',c.referral_code);
end $$;
revoke all on function public.pitacco_loyalty_referral_link(text,text) from public,anon,authenticated;
grant execute on function public.pitacco_loyalty_referral_link(text,text) to anon,authenticated;

-- Merely generating one's own link does not prevent receiving an indication
-- on the first purchase. Prior purchases cannot be retrospectively referred.
create or replace function pitacco_private.loyalty_customer_for_order(
 s uuid,customer_name text,raw_phone text,p_referral_code text default ''
) returns uuid language plpgsql security definer set search_path='' as $$
declare c uuid;referrer uuid;existing_referrer uuid;v_phone text:=pitacco_private.loyalty_normal_phone(raw_phone);
 prior_purchase boolean;
begin
 if v_phone !~ '^[0-9]{10,11}$' then raise exception 'Informe um celular com DDD válido';end if;
 if length(trim(coalesce(customer_name,''))) not between 2 and 120 then raise exception 'Informe o nome do cliente';end if;
 select lc.id,lc.referred_by into c,existing_referrer from pitacco_private.loyalty_customers lc
  where lc.store_id=s and lc.phone=v_phone and lc.active for update;
 prior_purchase:=exists(select 1 from public.public_checkouts pc where pc.store_id=s
  and pc.phone in (v_phone,'55'||v_phone));
 update pitacco_private.loyalty_customers set name=public.dg_clean_text(trim(customer_name))
  where id=c and store_id=s and name='Cliente Fideliza+';
 if c is not null and (existing_referrer is not null or prior_purchase or coalesce(trim(p_referral_code),'')='') then return c;end if;
 if not prior_purchase and coalesce(trim(p_referral_code),'')<>'' then
  if not (pitacco_private.loyalty_rules(s)->>'referrals_enabled')::boolean then
   -- Turning off indications must not block a purchase arriving via an old link.
   referrer:=null;
  else
   select lc.id into referrer from pitacco_private.loyalty_customers lc
    where lc.store_id=s and lc.referral_code=upper(trim(p_referral_code)) and lc.phone<>v_phone and lc.active;
   -- Invalid, inactive, self or other-store links grant nothing and never block checkout.
  end if;
 end if;
 if c is not null then
  update pitacco_private.loyalty_customers set referred_by=referrer,
   name=case when name='Cliente Fideliza+' then public.dg_clean_text(trim(customer_name)) else name end where id=c and store_id=s;
  return c;
 end if;
 insert into pitacco_private.loyalty_customers(store_id,name,phone,key_hash,referred_by)
 values(s,public.dg_clean_text(trim(customer_name)),v_phone,null,referrer)
 on conflict(store_id,phone) do nothing returning id into c;
 if c is null then select id into c from pitacco_private.loyalty_customers where store_id=s and phone=v_phone and active for update;end if;
 if c is null then raise exception 'Não foi possível vincular o telefone do cliente';end if;
 return c;
end $$;
revoke all on function pitacco_private.loyalty_customer_for_order(uuid,text,text,text) from public,anon,authenticated;
