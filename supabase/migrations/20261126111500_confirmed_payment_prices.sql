-- Prepare authoritative price application, isolated from saved drafts.
-- No rule is activated by this migration. A checkout without an active rule
-- is unchanged, including old clients, scheduled orders and existing orders.
alter table pitacco_private.payment_pricing_drafts add column active_adjustment_bps integer
 check(active_adjustment_bps between -9999 and 10000 and (method not like 'voucher_%' or active_adjustment_bps=0));
alter table pitacco_private.payment_pricing_drafts add column active_revision bigint check(active_revision>0);
alter table pitacco_private.payment_pricing_drafts add constraint payment_pricing_active_pair
 check((active_adjustment_bps is null)=(active_revision is null));

create or replace function pitacco_private.checkout_payment_price(p_store uuid,p_request uuid,p_method text,p_subtotal numeric,p_discount numeric,p_fee numeric)
returns jsonb language plpgsql stable set search_path='' as $price$
declare channel_name text; rate integer; rev bigint; breakdown jsonb; expected text;
begin
 if p_method='fiado' or p_method like 'voucher_%' then return null;end if;
 channel_name:=case when auth.uid() is not null and public.is_store_manager(p_store)
 and current_setting('pitacco.pdv_checkout_scope',true)=p_store::text||':'||p_request::text then 'balcao' else 'cardapio' end;
 select d.active_adjustment_bps,d.active_revision into rate,rev from pitacco_private.payment_pricing_drafts d
 where d.store_id=p_store and d.channel=channel_name and d.method=p_method;
 if coalesce(rate,0)=0 then return null;end if;
 breakdown:=pitacco_private.payment_price_breakdown(round(p_subtotal*100)::bigint,round(p_discount*100)::bigint,round(p_fee*100)::bigint,p_method,rate,0);
 expected:=p_store::text||':'||p_request::text||':'||p_method||':'||rev::text||':'||(breakdown->>'total_cents');
 if current_setting('pitacco.confirmed_payment_price',true) is distinct from expected then
  raise exception 'Preço por pagamento atualizado. Confira o total antes de confirmar o pedido.';
 end if;
 return breakdown||jsonb_build_object('revision',rev,'channel',channel_name,'method',p_method);
end $price$;
revoke all on function pitacco_private.checkout_payment_price(uuid,uuid,text,numeric,numeric,numeric) from public,anon,authenticated;

-- Apply the exact server-calculated amount at the point where the four
-- existing checkout implementations already know coupon and freight totals.
do $migration$
declare f record; d text; v text; amount_anchor text; discount_expr text; n integer:=0;
begin
 for f in select p.oid,p.proname from pg_proc p join pg_namespace ns on ns.oid=p.pronamespace
 where ns.nspname='public' and p.proname in ('checkout_public_order','checkout_public_order_coupon','pitacco_checkout_scheduled_order','pitacco_checkout_scheduled_order_coupon') loop
  d:=pg_get_functiondef(f.oid);
  discount_expr:=case when f.proname like '%coupon' then 'v_discount' else '0' end;
  amount_anchor:=case when f.proname like '%coupon' then 'total:=subtotal+fee-v_discount;' else 'total:=subtotal+fee;' end;
  if strpos(d,amount_anchor)=0 or strpos(d,'subtotal numeric:=0;')=0 or strpos(d,'''delivery_fee_original'',fee,''total'',total,''discount'',')=0 then raise exception 'Checkout price integration anchor missing: %',f.proname;end if;
  v:=replace(d,'subtotal numeric:=0;','subtotal numeric:=0; v_payment_price jsonb;');
  v:=replace(v,amount_anchor,amount_anchor||'v_payment_price:=pitacco_private.checkout_payment_price(cfg.store_id,p_request,p_payment,subtotal,'||discount_expr||',fee); if v_payment_price is not null then total:=(v_payment_price->>''total_cents'')::numeric/100; end if;');
  v:=replace(v,'''delivery_fee_original'',fee,''total'',total,''discount'',','''delivery_fee_original'',fee,''total'',total,''payment_price'',v_payment_price,''discount'',');
  execute v;n:=n+1;
 end loop;
 if n<>4 then raise exception 'Expected four checkout price integrations';end if;
 d:=pg_get_functiondef('pitacco_private.loyalty_refresh_order(uuid)'::regprocedure);
 if strpos(d,'eligible:=greatest(0,round((o.gross-coalesce((o.receipt->>''delivery_fee'')::numeric,0))*100))::integer;')=0 then raise exception 'Loyalty price anchor missing';end if;
 execute replace(d,'eligible:=greatest(0,round((o.gross-coalesce((o.receipt->>''delivery_fee'')::numeric,0))*100))::integer;',
 'eligible:=coalesce((o.receipt->''payment_price''->>''loyalty_eligible_cents'')::integer,greatest(0,round((o.gross-coalesce((o.receipt->>''delivery_fee'')::numeric,0))*100))::integer);');
end $migration$;

-- Publish only the active rates, never a merchant's drafts or internal costs.
create or replace function public.pitacco_public_payment_price_rules(p_slug text)
returns jsonb language sql stable security definer set search_path='' as $rules$
 select coalesce((select jsonb_object_agg(d.method,jsonb_build_object('adjustment_bps',d.active_adjustment_bps,'revision',d.active_revision))
 from pitacco_private.payment_pricing_drafts d join public.public_menu_settings m on m.store_id=d.store_id
 where m.slug=p_slug and m.enabled and d.channel='cardapio' and d.active_adjustment_bps<>0),'{}'::jsonb);
$rules$;
revoke all on function public.pitacco_public_payment_price_rules(text) from public,anon,authenticated;
grant execute on function public.pitacco_public_payment_price_rules(text) to anon,authenticated;

-- Deliver the active rule snapshot with the catalog; no additional browser RPC.
do $menu$
declare d text:=pg_get_functiondef('public.get_public_menu(text)'::regprocedure);
begin
 if strpos(d,'''payment_methods'',cfg.payment_methods')=0 then raise exception 'Menu price rule anchor missing';end if;
 execute replace(d,'''payment_methods'',cfg.payment_methods','''payment_methods'',cfg.payment_methods,''payment_price_rules'',public.pitacco_public_payment_price_rules(cfg.slug)');
end $menu$;

-- The existing checkout endpoints remain available for unadjusted methods.
-- A new entry point binds the selected price to the same store/request/method,
-- forwards to the existing validated checkout and never creates a second order.
create or replace function public.pitacco_confirm_priced_public_checkout(
 p_slug text,p_request uuid,p_customer text,p_phone text,p_address text,p_items jsonb,
 p_fulfillment text,p_payment text,p_notes text,p_expected_cents bigint,p_price_revision bigint,
 p_key text default null,p_coupon text default '',p_reward text default '',p_quote uuid default null,p_scheduled_for timestamptz default null,
 p_use_loyalty boolean default false)
returns jsonb language plpgsql security definer set search_path='' as $checkout$
declare sid uuid; result jsonb; prior_scope text;
begin
 select store_id into sid from public.public_menu_settings where slug=p_slug and enabled;
 if sid is null or p_request is null or p_expected_cents is null or p_expected_cents not between 1 and 1000000
 or p_price_revision is null or p_price_revision<1 or p_payment is null or p_payment='fiado' or p_payment like 'voucher_%' then raise exception 'Confirmação de preço inválida';end if;
 prior_scope:=current_setting('pitacco.confirmed_payment_price',true);
 perform set_config('pitacco.confirmed_payment_price',sid::text||':'||p_request::text||':'||p_payment||':'||p_price_revision::text||':'||p_expected_cents::text,true);
 if p_use_loyalty then
  result:=public.pitacco_loyalty_checkout(p_slug,p_request,p_customer,p_phone,p_address,p_items,p_fulfillment,p_payment,p_notes,coalesce(p_key,''),coalesce(p_coupon,''),coalesce(p_reward,''),p_quote,p_scheduled_for,null);
 elsif coalesce(p_coupon,'')<>'' or coalesce(p_reward,'')<>'' then raise exception 'Benefícios exigem checkout Fideliza+';
 elsif p_fulfillment='delivery' then
  result:=public.pitacco_checkout_quoted_delivery(p_slug,p_request,p_customer,p_phone,p_address,p_items,p_fulfillment,p_payment,p_notes,p_quote,p_scheduled_for);
 elsif p_scheduled_for is not null then
  result:=public.pitacco_checkout_scheduled_order(p_slug,p_request,p_customer,p_phone,p_address,p_items,p_fulfillment,p_payment,p_notes,p_scheduled_for);
 else
  result:=public.checkout_public_order(p_slug,p_request,p_customer,p_phone,p_address,p_items,p_fulfillment,p_payment,p_notes);
 end if;
 perform set_config('pitacco.confirmed_payment_price',coalesce(prior_scope,''),true);
 if not (result?'error') and round((result->>'total')::numeric*100)::bigint is distinct from p_expected_cents then raise exception 'Preço por pagamento atualizado. Confira o total antes de confirmar o pedido.';end if;
 return result;
end $checkout$;
revoke all on function public.pitacco_confirm_priced_public_checkout(text,uuid,text,text,text,jsonb,text,text,text,bigint,bigint,text,text,text,uuid,timestamptz,boolean) from public,anon,authenticated;
grant execute on function public.pitacco_confirm_priced_public_checkout(text,uuid,text,text,text,jsonb,text,text,text,bigint,bigint,text,text,text,uuid,timestamptz,boolean) to anon,authenticated;

create or replace function public.pitacco_confirm_priced_merchant_checkout(p_store uuid,p_request uuid,p_sale_mode text,p_customer text,p_phone text,p_address text,p_items jsonb,p_payment text,p_notes text,p_coupon text,p_quote uuid,p_fiado_customer uuid,p_received_amount numeric,p_expected_cents bigint,p_price_revision bigint)
returns jsonb language plpgsql security definer set search_path='' as $checkout$
declare result jsonb; prior_scope text;
begin
 if auth.uid() is null or not public.is_store_manager(p_store) then raise exception 'Sem permissão' using errcode='42501';end if;
 if p_request is null or p_expected_cents is null or p_expected_cents not between 1 and 1000000 or p_price_revision is null or p_price_revision<1 or p_payment is null or p_payment='fiado' or p_payment like 'voucher_%' then raise exception 'Confirmação de preço inválida';end if;
 prior_scope:=current_setting('pitacco.confirmed_payment_price',true);
 perform set_config('pitacco.confirmed_payment_price',p_store::text||':'||p_request::text||':'||p_payment||':'||p_price_revision::text||':'||p_expected_cents::text,true);
 result:=public.pitacco_merchant_channel_checkout(p_store,p_request,p_sale_mode,p_customer,p_phone,p_address,p_items,p_payment,p_notes,p_coupon,p_quote,p_fiado_customer,p_received_amount);
 perform set_config('pitacco.confirmed_payment_price',coalesce(prior_scope,''),true);
 if not (result?'error') and round((result->>'total')::numeric*100)::bigint is distinct from p_expected_cents then raise exception 'Preço por pagamento atualizado. Confira o total antes de confirmar o pedido.';end if;
 return result;
end $checkout$;
revoke all on function public.pitacco_confirm_priced_merchant_checkout(uuid,uuid,text,text,text,text,jsonb,text,text,text,uuid,uuid,numeric,bigint,bigint) from public,anon,authenticated;
grant execute on function public.pitacco_confirm_priced_merchant_checkout(uuid,uuid,text,text,text,text,jsonb,text,text,text,uuid,uuid,numeric,bigint,bigint) to authenticated;
notify pgrst,'reload schema';
