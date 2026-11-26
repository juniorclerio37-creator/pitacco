begin;
insert into auth.users(id,email) values ('10000000-0000-0000-0000-000000000097','priced-checkout@example.invalid');
insert into public.stores(id,name) values ('20000000-0000-0000-0000-000000000097','Priced Checkout');
insert into public.store_members(store_id,user_id,role) values ('20000000-0000-0000-0000-000000000097','10000000-0000-0000-0000-000000000097','gestor');
update public.public_menu_settings set slug='priced-checkout',enabled=true,delivery_enabled=true,pickup_enabled=true,payment_methods=array['dinheiro','cartao_credito'],pdv_payment_methods=array['dinheiro','cartao_credito'] where store_id='20000000-0000-0000-0000-000000000097';
insert into public.products(id,store_id,name,price,cost,menu_active) values ('30000000-0000-0000-0000-000000000097','20000000-0000-0000-0000-000000000097','Produto',100,0,true);
insert into pitacco_private.payment_pricing_drafts(store_id,channel,method,adjustment_bps,active_adjustment_bps,active_revision)
values ('20000000-0000-0000-0000-000000000097','cardapio','cartao_credito',300,300,1),
 ('20000000-0000-0000-0000-000000000097','balcao','cartao_credito',-500,-500,1),
 ('20000000-0000-0000-0000-000000000097','cardapio','dinheiro',-800,null,null);
set local role anon;
select set_config('request.jwt.claim.sub','',true);
do $test$
declare items jsonb:='[{"product_id":"30000000-0000-0000-0000-000000000097","quantity":1}]';req uuid:=gen_random_uuid();r jsonb;
begin
 assert public.pitacco_public_payment_price_rules('priced-checkout')='{"cartao_credito":{"adjustment_bps":300,"revision":1}}'::jsonb;
 begin
  perform public.checkout_public_order('priced-checkout',req,'Cliente','21999990097','',items,'pickup','cartao_credito','');
  raise exception 'Expected confirmation required';
 exception when raise_exception then if sqlerrm not like 'Preço por pagamento atualizado%' then raise;end if;end;
 begin
  perform public.pitacco_confirm_priced_public_checkout('priced-checkout',req,'Cliente','21999990097','',items,'pickup','cartao_credito','',10200,1);
  raise exception 'Expected wrong total rejected';
 exception when raise_exception then if sqlerrm not like 'Preço por pagamento atualizado%' then raise;end if;end;
 r:=public.pitacco_confirm_priced_public_checkout('priced-checkout',req,'Cliente','21999990097','',items,'pickup','cartao_credito','',10300,1);
 assert (r->>'total')::numeric=103;
 assert (public.pitacco_confirm_priced_public_checkout('priced-checkout',req,'Cliente','21999990097','',items,'pickup','cartao_credito','',10300,1)->>'order_id')=(r->>'order_id');
 assert (public.checkout_public_order('priced-checkout',gen_random_uuid(),'Cliente','21999990098','',items,'pickup','dinheiro','')->>'total')::numeric=100,'Draft must never affect checkout';
end $test$;
reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000097',true);
do $test$
declare s uuid:='20000000-0000-0000-0000-000000000097';r jsonb;req uuid:=gen_random_uuid();
begin
 r:=public.pitacco_confirm_priced_merchant_checkout(s,req,'balcao','Cliente','21999990099','','[{"product_id":"30000000-0000-0000-0000-000000000097","quantity":1}]'::jsonb,'cartao_credito','','',null,null,95,9500,1);
 assert (r->>'total')::numeric=95 and r->>'payment_status'='paid_manual';
 assert (select (receipt->'payment_price'->>'adjustment_cents')::integer=-500 and (receipt->'payment_price'->>'loyalty_eligible_cents')::integer=9500 from public.orders where request_id=req);
end $test$;
reset role;
rollback;
