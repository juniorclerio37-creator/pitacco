begin;
insert into auth.users(id,email) values ('10000000-0000-0000-0000-000000000091','loyalty-manager@example.invalid');
insert into public.stores(id,name) values ('20000000-0000-0000-0000-000000000091','Fideliza Teste'),('20000000-0000-0000-0000-000000000092','Outra Fideliza');
insert into public.store_members(store_id,user_id,role) values ('20000000-0000-0000-0000-000000000091','10000000-0000-0000-0000-000000000091','gestor');
insert into public.public_menu_settings(store_id,slug,enabled,delivery_enabled,pickup_enabled,delivery_fee,payment_methods)
 values ('20000000-0000-0000-0000-000000000091','loyalty-test',true,true,true,0,array['pix_manual']),
 ('20000000-0000-0000-0000-000000000092','loyalty-other',true,true,true,0,array['pix_manual'])
 on conflict(store_id) do update set slug=excluded.slug,enabled=true,delivery_enabled=true,pickup_enabled=true,payment_methods=excluded.payment_methods;
insert into public.products(id,store_id,name,price,cost,menu_active)
 values ('30000000-0000-0000-0000-000000000091','20000000-0000-0000-0000-000000000091','Produto',100,0,true);
insert into public.loyalty_programs(store_id,points_enabled,points_per_real,min_points_to_redeem,points_reward_cents,
 orders_enabled,orders_required,orders_reward_cents,cashback_enabled,cashback_percent,cashback_max_redeem_percent,
 referrals_enabled,referral_reward_cents,referral_welcome_cents,campaigns_enabled)
 values('20000000-0000-0000-0000-000000000091',true,1,100,1000,true,1,500,true,10,100,true,300,200,true);

create function pg_temp.loyalty_buy(k text,reward text default '',coupon text default '',req uuid default gen_random_uuid()) returns jsonb
language plpgsql as $$ declare p text;result jsonb;begin
 select phone into p from pitacco_private.loyalty_customers where key_hash=encode(sha256(convert_to(k,'UTF8')),'hex');
 result:=public.pitacco_loyalty_checkout('loyalty-test',req,'Cliente',p,'',
  '[{"product_id":"30000000-0000-0000-0000-000000000091","quantity":1,"options":[]}]','pickup','pix_manual','',k,coupon,reward);
 -- Remove apenas o rate-limit temporal no banco descartável, nunca em produção.
 update public.public_checkouts set created_at=now()-interval '1 hour';
 return result;
end $$;
create function pg_temp.loyalty_finish(oid uuid,paid boolean default true) returns void language plpgsql as $$begin
 update public.orders set status='accepted',preparation_status='completed',
 receipt=receipt||jsonb_build_object('payment_status',case when paid then 'paid' else 'pending' end) where id=oid;
end $$;

do $test$
declare s uuid:='20000000-0000-0000-0000-000000000091';a jsonb;b jsonb;k text;kb text;c uuid;cb uuid;
 r jsonb;rr jsonb;first_order uuid;points_order uuid;stamp_order uuid;cash_order uuid;ref_order uuid;ref_second uuid;cp_order uuid;req uuid;before_cash bigint;
 fiado_customer uuid;fiado_key text;fiado_order uuid;points_before bigint;slot timestamptz;quote_id uuid:=gen_random_uuid();legacy_request uuid:=gen_random_uuid();
begin
 perform public.checkout_public_order('loyalty-test',legacy_request,'Cliente','21999990001','',
  '[{"product_id":"30000000-0000-0000-0000-000000000091","quantity":1,"options":[]}]','pickup','pix_manual','');
 a:=public.pitacco_loyalty_join('loyalty-test','Cliente A','21999990001');k:=a->>'key';c:=(a->>'customer_id')::uuid;
 assert length(k)=64 and c is not null;
 assert public.pitacco_loyalty_join('loyalty-test','Outra pessoa','21999990001') ? 'error', 'Não recuperar conta por telefone';
 assert public.pitacco_loyalty_wallet('loyalty-other',k) ? 'error', 'Isolamento entre lojas';
 assert public.pitacco_loyalty_wallet('loyalty-test',repeat('0',64)) ? 'error';
 begin
  perform pg_temp.loyalty_buy(k,'','',legacy_request);raise exception 'Não atribuir benefício retroativamente';
 exception when raise_exception then if sqlerrm<>'Este pedido já foi criado fora do Fideliza+; consulte seu acompanhamento' then raise;end if;end;
 b:=public.pitacco_loyalty_join('loyalty-test','Cliente B','21999990002',public.pitacco_loyalty_wallet('loyalty-test',k)->>'referral_code');
 kb:=b->>'key';cb:=(b->>'customer_id')::uuid;assert kb is not null;
 r:=pg_temp.loyalty_buy(k);first_order:=(r->>'order_id')::uuid;
 perform pg_temp.loyalty_finish(first_order,false);
 assert pitacco_private.loyalty_balance(s,c,'points')=0, 'Entrega sem pagamento não gera benefício';
 update public.orders set receipt=receipt||'{"payment_status":"paid"}'::jsonb where id=first_order;
 perform pitacco_private.loyalty_refresh_order(first_order);
 assert pitacco_private.loyalty_balance(s,c,'points')=100;
 assert pitacco_private.loyalty_balance(s,c,'orders')=1;
 assert pitacco_private.loyalty_balance(s,c,'cashback')=1000;
 assert (select count(*)=3 from public.loyalty_ledger where order_id=first_order), 'Sem crédito duplicado';

 req:=gen_random_uuid();r:=pg_temp.loyalty_buy(k,'points','',req);points_order:=(r->>'order_id')::uuid;
 assert (r->>'total')::numeric=90;
 assert pitacco_private.loyalty_balance(s,c,'points')=0, 'Reserva de pontos imediata';
 rr:=pg_temp.loyalty_buy(k,'points','',req);assert r=rr;
 insert into pitacco_private.store_feature_rules(store_id,feature,enabled) values(s,'fideliza',false);
 rr:=pg_temp.loyalty_buy(k,'points','',req);assert r=rr,'Desativar módulo não apaga a confirmação de pedido já criado';
 update pitacco_private.store_feature_rules set enabled=true where store_id=s and feature='fideliza';
 begin
  perform pg_temp.loyalty_buy(k,'points');raise exception 'Não pode resgatar saldo reservado';
 exception when raise_exception then if sqlerrm<>'Saldo insuficiente para este benefício' then raise;end if;end;
 update public.orders set status='cancelled' where id=points_order;
 perform pitacco_private.loyalty_refresh_order(points_order);
 assert pitacco_private.loyalty_balance(s,c,'points')=100,'Cancelar restitui pontos apenas uma vez';

 r:=pg_temp.loyalty_buy(k,'orders');stamp_order:=(r->>'order_id')::uuid;
 assert (r->>'total')::numeric=95;
 perform pg_temp.loyalty_finish(stamp_order);
 assert pitacco_private.loyalty_balance(s,c,'points')=195, 'Pontos sobre produtos após desconto';
 assert pitacco_private.loyalty_balance(s,c,'cashback')=1950;
 r:=pg_temp.loyalty_buy(k,'cashback');cash_order:=(r->>'order_id')::uuid;
 assert (r->>'total')::numeric=80.50;
 assert pitacco_private.loyalty_balance(s,c,'cashback')=0;
 update public.orders set status='rejected' where id=cash_order;
 assert pitacco_private.loyalty_balance(s,c,'cashback')=1950;

 before_cash:=pitacco_private.loyalty_balance(s,c,'cashback');
 r:=pg_temp.loyalty_buy(kb);ref_order:=(r->>'order_id')::uuid;perform pg_temp.loyalty_finish(ref_order);
 assert pitacco_private.loyalty_balance(s,c,'cashback')=before_cash+300;
 assert pitacco_private.loyalty_balance(s,cb,'cashback')=1200;
 r:=pg_temp.loyalty_buy(kb);ref_second:=(r->>'order_id')::uuid;perform pg_temp.loyalty_finish(ref_second);
 assert pitacco_private.loyalty_balance(s,c,'cashback')=before_cash+300,'Indicação apenas uma vez';
 update public.orders set status='cancelled' where id=ref_order;
 assert pitacco_private.loyalty_balance(s,c,'cashback')=before_cash,'Cancelar reverte também o indicador';
 assert pitacco_private.loyalty_balance(s,cb,'cashback')=1000;
 update public.orders set receipt=receipt||'{"payment_status":"refunded"}'::jsonb where id=ref_second;
 assert pitacco_private.loyalty_balance(s,cb,'cashback')=0,'Estorno integral confirmado reverte benefícios';

 insert into public.loyalty_coupons(store_id,code,title,kind,discount_type,discount_value,target_customer_id,max_uses,per_customer_limit)
 values(s,'PESSOAL20','Campanha pessoal','campaign','percent',20,c,1,1);
 assert jsonb_array_length(public.pitacco_loyalty_wallet('loyalty-test',k)->'offers')=1,'Oferta pessoal aparece só na carteira correta';
 assert jsonb_array_length(public.pitacco_loyalty_wallet('loyalty-test',kb)->'offers')=0;
 begin
  perform pg_temp.loyalty_buy(kb,'','PESSOAL20');raise exception 'Outro cliente não pode usar cupom pessoal';
 exception when raise_exception then if sqlerrm<>'Cupom exclusivo para outro cliente' then raise;end if;end;
 r:=pg_temp.loyalty_buy(k,'','PESSOAL20');cp_order:=(r->>'order_id')::uuid;assert (r->>'total')::numeric=80;
 assert (select count(*)=1 from public.loyalty_coupon_redemptions where order_id=cp_order);
 update public.orders set status='cancelled' where id=cp_order;
 assert (select uses=0 from public.loyalty_coupons where code='PESSOAL20');
 assert (select state='cancelled' from public.loyalty_coupon_redemptions where order_id=cp_order);
 r:=pg_temp.loyalty_buy(k,'','PESSOAL20');assert (r->>'total')::numeric=80,'Cancelamento libera utilização';
 assert public.pitacco_loyalty_preview('loyalty-test','[{"product_id":"30000000-0000-0000-0000-000000000091","quantity":1}]',k,'','cashback')->>'discount_cents'='1950';

 -- Reversão depois de benefício gasto não fabrica saldo: a carteira pode ficar devedora.
 r:=pg_temp.loyalty_buy(k,'points');
 update public.orders set status='cancelled' where id=first_order;
 assert pitacco_private.loyalty_balance(s,c,'points')=-5;
 assert (public.pitacco_loyalty_wallet('loyalty-test',k)->>'points')::integer=0;
 assert not has_function_privilege('anon','pitacco_private.loyalty_entry(uuid,uuid,uuid,text,integer,text,text,jsonb)','execute');
 assert not has_table_privilege('anon','pitacco_private.loyalty_customers','select');
 assert not has_table_privilege('authenticated','public.loyalty_ledger','insert');
 perform set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000091',true);
 assert jsonb_array_length(public.pitacco_loyalty_customers(s))=2;
 rr:=public.pitacco_loyalty_wallet('loyalty-test',k);
 k:=public.pitacco_loyalty_reset_key(s,c);
 assert public.pitacco_loyalty_wallet('loyalty-test',a->>'key') ? 'error','Chave antiga revogada';
 assert public.pitacco_loyalty_wallet('loyalty-test',k)->>'customer_id'=c::text;
 -- A caderneta participa apenas depois da quitação integral e da entrega.
 fiado_customer:=public.pitacco_fiado_save_customer(s,'Cliente A','21999990001',500,true,7,'automatic',true);
 fiado_key:=public.pitacco_fiado_rotate_code(s,fiado_customer);perform public.pitacco_fiado_toggle(s,true);
 update public.public_checkouts set created_at=now()-interval '1 hour';
 points_before:=pitacco_private.loyalty_balance(s,c,'points');
 r:=public.pitacco_loyalty_checkout('loyalty-test',gen_random_uuid(),'Cliente A','21999990001','',
  '[{"product_id":"30000000-0000-0000-0000-000000000091","quantity":1}]','pickup','fiado','',k,'','',null,null,fiado_key);
 fiado_order:=(r->>'order_id')::uuid;assert fiado_order is not null;
 update public.orders set status='accepted',preparation_status='completed' where id=fiado_order;
 perform public.pitacco_fiado_receive(s,fiado_customer,30,'pix',gen_random_uuid(),'Parcial');
 assert pitacco_private.loyalty_balance(s,c,'points')=points_before;
 perform public.pitacco_fiado_receive(s,fiado_customer,70,'pix',gen_random_uuid(),'Quitação');
 assert pitacco_private.loyalty_balance(s,c,'points')=points_before+100;

 -- Agenda e cotação preservam os cálculos e o ponto de entrega originais.
 insert into public.pitacco_schedule_windows(store_id,weekday,enabled,opens_minute,closes_minute)
 select s,day,true,0,1440 from generate_series(1,7) day;
 slot:=(public.pitacco_public_schedule_slots('loyalty-test','pickup'))[1];assert slot is not null;
 insert into public.loyalty_coupons(store_id,code,discount_type,discount_value) values(s,'FRETE5','fixed',5);
 update public.public_checkouts set created_at=now()-interval '1 hour';
 r:=public.pitacco_loyalty_checkout('loyalty-test',gen_random_uuid(),'Cliente A','21999990001','',
  '[{"product_id":"30000000-0000-0000-0000-000000000091","quantity":1}]','pickup','pix_manual','',k,'FRETE5','',null,slot);
 assert (r->>'total')::numeric=95;
 assert (select scheduled_for=slot from public.orders where id=(r->>'order_id')::uuid);
 update public.stores set address='Rua Teste 100',city='Nova Iguaçu',state='RJ' where id=s;
 perform public.pitacco_save_delivery_pricing(s,5,'[2,4,6,8,10,12,14,16,18,20]'::jsonb,'[]'::jsonb);
 update public.pitacco_delivery_pricing set enabled=true where store_id=s;
 req:=gen_random_uuid();
 insert into public.pitacco_delivery_route_quotes(id,store_id,request_id,destination_address,distance_m,fee,pricing_updated_at,expires_at,destination_latitude,destination_longitude)
 select quote_id,s,req,'Rua Teste 100',1000,7.50,updated_at,now()+interval '5 minutes',-22.91,-43.46 from public.pitacco_delivery_pricing where store_id=s;
 update public.public_checkouts set created_at=now()-interval '1 hour';
 r:=public.pitacco_loyalty_checkout('loyalty-test',req,'Cliente A','21999990001','Rua Teste 100',
  '[{"product_id":"30000000-0000-0000-0000-000000000091","quantity":1}]','delivery','pix_manual','',k,'FRETE5','',quote_id);
 assert (r->>'total')::numeric=102.50;
 assert (select receipt->'delivery_location'->>'latitude'='-22.91' from public.orders where id=(r->>'order_id')::uuid),'Cupom mantém o destino da cotação';
 assert (select (receipt->>'delivery_fee')::numeric=7.50 from public.orders where id=(r->>'order_id')::uuid);
 insert into public.loyalty_coupons(store_id,code,discount_type,discount_value,target_customer_id)
 values(s,'SECRET5','fixed',5,c);
 perform set_config('fideliza.fixture.key',k,true);
 begin perform public.pitacco_loyalty_customers('20000000-0000-0000-0000-000000000092');raise exception 'Outra loja';
 exception when insufficient_privilege then null;end;
end $test$;
set local role anon;
select set_config('request.jwt.claim.sub','',true);
do $anon$
begin
 assert (public.pitacco_loyalty_wallet('loyalty-test',current_setting('fideliza.fixture.key'))->>'phone')='21999990001';
 begin
  perform public.checkout_public_order_coupon('loyalty-test',gen_random_uuid(),'Cliente A','21999990001','',
   '[{"product_id":"30000000-0000-0000-0000-000000000091","quantity":1}]','pickup','pix_manual','','SECRET5');
  raise exception 'Telefone não autoriza cupom pessoal';
 exception when raise_exception then if sqlerrm<>'Cupom exclusivo para outro cliente' then raise;end if;end;
 begin perform public.pitacco_loyalty_customers('20000000-0000-0000-0000-000000000091');raise exception 'Sem acesso';
 exception when insufficient_privilege then null;end;
end $anon$;
reset role;
rollback;
