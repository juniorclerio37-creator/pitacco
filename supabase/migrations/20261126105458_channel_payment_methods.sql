-- Separate merchant counter payments from public checkout; keep legacy configurations valid.
alter table public.public_menu_settings add column if not exists pdv_payment_methods text[];
alter table public.public_menu_settings drop constraint if exists public_menu_settings_payment_methods_check;
alter table public.public_menu_settings add constraint public_menu_settings_payment_methods_check check (
 cardinality(payment_methods) between 1 and 10 and array_position(payment_methods,null) is null and
 payment_methods <@ array['dinheiro','cartao_entrega','cartao_credito','cartao_debito','pix_manual','pix_maquininha','voucher_alelo','voucher_pluxee','voucher_vr','voucher_ticket']::text[]);
alter table public.public_menu_settings add constraint public_menu_settings_pdv_payment_methods_check check (
 pdv_payment_methods is null or (cardinality(pdv_payment_methods) between 1 and 10 and array_position(pdv_payment_methods,null) is null and
 pdv_payment_methods <@ array['dinheiro','cartao_entrega','cartao_credito','cartao_debito','pix_manual','pix_maquininha','voucher_alelo','voucher_pluxee','voucher_vr','voucher_ticket']::text[]));

-- The merchant checkout is already authorized by store. Scope its private
-- selection to the store and request, never to a public pickup or delivery.
create or replace function pitacco_private.checkout_channel_payment_allowed(p_store uuid,p_request uuid,p_payment text,p_public text[],p_pdv text[])
returns boolean language sql stable set search_path='' as $$
 select coalesce(p_payment=any(methods) or
 (p_payment in ('cartao_credito','cartao_debito') and 'cartao_entrega'=any(methods)),false)
 from (select case when auth.uid() is not null and public.is_store_manager(p_store)
 and current_setting('pitacco.pdv_checkout_scope',true)=p_store::text||':'||p_request::text
 then coalesce(p_pdv,p_public) else p_public end methods) s;
$$;
revoke all on function pitacco_private.checkout_channel_payment_allowed(uuid,uuid,text,text[],text[]) from public,anon,authenticated;

-- Update existing pricing/checkout implementations without replacing unrelated
-- stock, coupons, delivery quotes or idempotency logic. Fail on changed anchors.
do $migration$
declare f record; d text; next_def text; n integer:=0;
begin
 for f in select p.oid from pg_proc p join pg_namespace ns on ns.oid=p.pronamespace
 where ns.nspname='public' and p.proname in ('checkout_public_order','checkout_public_order_coupon','pitacco_checkout_scheduled_order','pitacco_checkout_scheduled_order_coupon') loop
  d:=pg_get_functiondef(f.oid);
  next_def:=replace(d,'p_payment=any(cfg.payment_methods)','pitacco_private.checkout_channel_payment_allowed(cfg.store_id,p_request,p_payment,cfg.payment_methods,cfg.pdv_payment_methods)');
  if next_def=d then raise exception 'Checkout payment validation anchor missing';end if;
  execute next_def;n:=n+1;
 end loop;
 if n<>4 then raise exception 'Expected four checkout implementations';end if;
 d:=pg_get_functiondef('public.save_public_menu_settings(uuid,text,boolean,boolean,boolean,numeric,text[],text)'::regprocedure);
 next_def:=replace(replace(d,'cardinality(p_payment_methods) not between 1 and 3','cardinality(p_payment_methods) not between 1 and 10'),
 'array[''dinheiro'',''cartao_entrega'',''pix_manual'']::text[]','array[''dinheiro'',''cartao_entrega'',''cartao_credito'',''cartao_debito'',''pix_manual'',''pix_maquininha'',''voucher_alelo'',''voucher_pluxee'',''voucher_vr'',''voucher_ticket'']::text[]');
 if next_def=d then raise exception 'Menu settings anchor missing';end if;execute next_def;
 -- Legacy onboarding is absent from clean installations; update it only when present.
 if to_regprocedure('public.pitacco_configure_store(uuid,text,text,text,integer,text,numeric,text[],boolean,boolean)') is not null then
 d:=pg_get_functiondef('public.pitacco_configure_store(uuid,text,text,text,integer,text,numeric,text[],boolean,boolean)'::regprocedure);
 next_def:=replace(d,'array[''dinheiro'',''cartao_entrega'',''pix_manual'']::text[]','array[''dinheiro'',''cartao_entrega'',''cartao_credito'',''cartao_debito'',''pix_manual'',''pix_maquininha'',''voucher_alelo'',''voucher_pluxee'',''voucher_vr'',''voucher_ticket'']::text[]');
 if next_def=d then raise exception 'Onboarding payment anchor missing';end if;execute next_def;
 end if;
 d:=pg_get_functiondef('public.confirm_manual_payment(uuid,uuid,numeric,text)'::regprocedure);
 next_def:=replace(d,'''dinheiro'',''cartao_entrega'',''pix_manual'',''pix'',''cartao''','''dinheiro'',''cartao_entrega'',''pix_manual'',''pix'',''cartao'',''cartao_credito'',''cartao_debito'',''pix_maquininha'',''voucher_alelo'',''voucher_pluxee'',''voucher_vr'',''voucher_ticket''');
 if next_def=d then raise exception 'Manual payment anchor missing';end if;execute next_def;
 d:=pg_get_functiondef('pitacco_private.courier_payment_details(jsonb,numeric)'::regprocedure);
 next_def:=replace(replace(d,
 'm in (''cartao_entrega'',''cartao_na_entrega'',''card_on_delivery'')'||chr(10),
 'm in (''cartao_entrega'',''cartao_na_entrega'',''card_on_delivery'',''cartao_credito'',''cartao_debito'',''pix_maquininha'',''voucher_alelo'',''voucher_pluxee'',''voucher_vr'',''voucher_ticket'')'||chr(10)),
 'when m=''online'' then ''Online''',
 'when m=''pix_maquininha'' then ''Pix na maquininha'' when m=''voucher_alelo'' then ''Vale-refeição — Alelo'' when m=''voucher_pluxee'' then ''Vale-refeição — Pluxee'' when m=''voucher_vr'' then ''Vale-refeição — VR'' when m=''voucher_ticket'' then ''Vale-refeição — Ticket'' when m=''online'' then ''Online''');
 if next_def=d then raise exception 'Courier payment anchor missing';end if;execute next_def;
end $migration$;

create or replace function public.pitacco_save_channel_payments(p_store uuid,p_slug text,p_enabled boolean,p_delivery_enabled boolean,p_pickup_enabled boolean,p_public text[],p_pdv text[],p_pix_instructions text)
returns void language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null or not public.is_store_manager(p_store) then raise exception 'Sem permissão';end if;
 if p_pdv is null or cardinality(p_pdv) not between 1 and 10 or array_position(p_pdv,null) is not null or
 (select count(distinct x) from unnest(p_pdv)x)<>cardinality(p_pdv) then raise exception 'Formas de pagamento do balcão inválidas';end if;
 if 'pix_manual'=any(p_pdv) and length(trim(coalesce(p_pix_instructions,'')))<3 then raise exception 'Informe a chave Pix manual';end if;
 perform public.save_public_menu_settings(p_store,p_slug,p_enabled,p_delivery_enabled,p_pickup_enabled,0,p_public,p_pix_instructions);
 update public.public_menu_settings set pdv_payment_methods=p_pdv where store_id=p_store;
end $$;
revoke all on function public.pitacco_save_channel_payments(uuid,text,boolean,boolean,boolean,text[],text[],text) from public,anon,authenticated;
grant execute on function public.pitacco_save_channel_payments(uuid,text,boolean,boolean,boolean,text[],text[],text) to authenticated;

-- A separate authenticated entry point enables the counter's payment list,
-- and optionally records an actual external receipt at the exact server total.
create or replace function public.pitacco_merchant_channel_checkout(p_store uuid,p_request uuid,p_sale_mode text,p_customer text,p_phone text,p_address text,p_items jsonb,p_payment text,p_notes text,p_coupon text,p_quote uuid,p_fiado_customer uuid,p_received_amount numeric default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb; oid uuid; total numeric; prior_scope text;
begin
 if auth.uid() is null or not public.is_store_manager(p_store) then raise exception 'Sem permissão';end if;
 if p_received_amount is not null and (p_sale_mode not in ('balcao','retirada') or p_payment not in ('dinheiro','cartao_credito','cartao_debito','cartao_entrega','pix_maquininha','pix_manual','voucher_alelo','voucher_pluxee','voucher_vr','voucher_ticket') or p_received_amount<=0) then raise exception 'Confirmação de pagamento inválida';end if;
 prior_scope:=current_setting('pitacco.pdv_checkout_scope',true);
 perform set_config('pitacco.pdv_checkout_scope',case when p_sale_mode in ('balcao','retirada') then p_store::text||':'||p_request::text else '' end,true);
 result:=public.pitacco_merchant_create_checkout(p_store,p_request,p_sale_mode,p_customer,p_phone,p_address,p_items,p_payment,p_notes,p_coupon,p_quote,p_fiado_customer);
 perform set_config('pitacco.pdv_checkout_scope',coalesce(prior_scope,''),true);
 if result?'error' or p_received_amount is null then return result;end if;
 oid:=(result->>'order_id')::uuid;total:=(result->>'total')::numeric;
 if total is distinct from p_received_amount then raise exception 'Valor final diferente do valor recebido; confira o pagamento';end if;
 perform public.confirm_manual_payment(oid,p_request,total,'Pagamento presencial confirmado pelo lojista');
 update public.orders set receipt=receipt||jsonb_build_object('payment_status','paid','payment_confirmed',true,'payment_channel','presencial') where id=oid and store_id=p_store;
 return result||jsonb_build_object('payment_status','paid_manual');
end $$;
revoke all on function public.pitacco_merchant_channel_checkout(uuid,uuid,text,text,text,text,jsonb,text,text,text,uuid,uuid,numeric) from public,anon,authenticated;
grant execute on function public.pitacco_merchant_channel_checkout(uuid,uuid,text,text,text,text,jsonb,text,text,text,uuid,uuid,numeric) to authenticated;
notify pgrst,'reload schema';
