begin;
do $test$
declare r jsonb; m text;
begin
 r:=pitacco_private.payment_price_breakdown(10000,1000,500,'cartao_credito',400,350);
 assert (r->>'adjustment_cents')::int=360 and (r->>'total_cents')::int=9860;
 assert (r->>'loyalty_eligible_cents')::int=9000,'Card surcharge does not earn extra loyalty points';
 r:=pitacco_private.payment_price_breakdown(10000,1000,500,'pix_maquininha',-500,0);
 assert (r->>'adjustment_cents')::int=-450 and (r->>'total_cents')::int=9050;
 assert (r->>'loyalty_eligible_cents')::int=8550,'Loyalty follows net merchandise after discounts';
 foreach m in array array['dinheiro','pix_manual','pix_maquininha','pix_online','cartao_credito','cartao_debito','credito_online','debito_online'] loop
  r:=pitacco_private.payment_price_breakdown(10000,0,500,m,250,0);
  assert (r->>'total_cents')::int=10750 and (r->>'loyalty_eligible_cents')::int=10000;
  r:=pitacco_private.payment_price_breakdown(10000,0,500,m,-250,0);
  assert (r->>'total_cents')::int=10250 and (r->>'loyalty_eligible_cents')::int=9750;
 end loop;
 foreach m in array array['voucher_alelo','voucher_pluxee','voucher_vr','voucher_ticket'] loop
  r:=pitacco_private.payment_price_breakdown(10000,0,0,m,0,360);
  assert (r->>'total_cents')::int=10000 and (r->>'estimated_processing_cost_cents')::int=360;
  assert (r->>'loyalty_eligible_cents')::int=10000;
  begin
   perform pitacco_private.payment_price_breakdown(10000,0,0,m,300,360);
   raise exception 'Expected voucher surcharge rejection';
  exception when raise_exception then if sqlerrm<>'Ajuste de preço não permitido para esta forma' then raise;end if;end;
  begin
   perform pitacco_private.payment_price_breakdown(10000,0,0,m,-300,360);
   raise exception 'Expected voucher discount rejection';
  exception when raise_exception then if sqlerrm<>'Ajuste de preço não permitido para esta forma' then raise;end if;end;
 end loop;
 r:=pitacco_private.payment_price_breakdown(10000,0,0,'fiado',0,0);
 assert (r->>'loyalty_eligible_cents')::int=0;
 assert not has_table_privilege('anon','pitacco_private.payment_pricing_drafts','select');
 assert not has_function_privilege('anon','public.pitacco_payment_pricing_drafts(uuid)','execute');
 assert not has_function_privilege('anon','public.pitacco_save_payment_pricing_draft(uuid,text,text,integer,integer,bigint)','execute');
end $test$;
insert into auth.users(id,email) values ('10000000-0000-0000-0000-000000000095','payment-pricing@example.invalid');
insert into public.stores(id,name) values ('20000000-0000-0000-0000-000000000095','Payment pricing test'),('20000000-0000-0000-0000-000000000096','Other store');
insert into public.store_members(store_id,user_id,role) values ('20000000-0000-0000-0000-000000000095','10000000-0000-0000-0000-000000000095','gestor');
set local role authenticated;
select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000095',true);
do $test$
declare s uuid:='20000000-0000-0000-0000-000000000095';r jsonb;
begin
 r:=public.pitacco_save_payment_pricing_draft(s,'balcao','cartao_credito',300,300,0);
 assert (r->>'revision')::int=1;
 r:=public.pitacco_save_payment_pricing_draft(s,'cardapio','cartao_credito',-500,300,0);
 assert (r->>'revision')::int=1;
 r:=public.pitacco_save_payment_pricing_draft(s,'balcao','pix_maquininha',200,0,0);
 assert (r->>'adjustment_bps')::integer=200;
 r:=public.pitacco_save_payment_pricing_draft(s,'balcao','dinheiro',-200,0,0);
 assert (r->>'adjustment_bps')::integer=-200;
 assert jsonb_array_length(public.pitacco_payment_pricing_drafts(s))=4;
 begin
  perform public.pitacco_save_payment_pricing_draft(s,'balcao','cartao_credito',200,300,0);
  raise exception 'Expected stale revision rejection';
 exception when raise_exception then if sqlerrm not like 'Configuração alterada%' then raise;end if;end;
 begin
  perform public.pitacco_payment_pricing_drafts('20000000-0000-0000-0000-000000000096');
  raise exception 'Expected tenant isolation';
 exception when insufficient_privilege then null;end;
end $test$;
reset role;
rollback;
