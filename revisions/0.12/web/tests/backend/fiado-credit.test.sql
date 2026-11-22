begin;
insert into auth.users(id,email) values
 ('10000000-0000-0000-0000-000000000081','fiado-gestor@example.invalid'),
 ('10000000-0000-0000-0000-000000000082','fiado-outsider@example.invalid');
insert into public.stores(id,name) values
 ('20000000-0000-0000-0000-000000000081','Fiado Teste'),
 ('20000000-0000-0000-0000-000000000082','Fiado Outra Loja');
insert into public.store_members(store_id,user_id,role) values
 ('20000000-0000-0000-0000-000000000081','10000000-0000-0000-0000-000000000081','gestor');
insert into public.public_menu_settings(store_id,slug,enabled,delivery_enabled,pickup_enabled,delivery_fee,payment_methods)
 values ('20000000-0000-0000-0000-000000000081','fiado-fixture',true,true,true,0,array['dinheiro'])
 on conflict(store_id) do update set slug=excluded.slug,enabled=excluded.enabled,
  delivery_enabled=excluded.delivery_enabled,pickup_enabled=excluded.pickup_enabled,
  delivery_fee=excluded.delivery_fee,payment_methods=excluded.payment_methods;
insert into public.products(id,store_id,name,price,cost,menu_active)
 values ('30000000-0000-0000-0000-000000000081','20000000-0000-0000-0000-000000000081','Produto teste fiado',20,5,true);

-- Os asserts conferem tabelas internas como papel de teste privilegiado; as RPCs
-- verificam o gestor por auth.uid, e as permissões do papel authenticated são
-- checadas explicitamente com has_table_privilege/has_function_privilege.
select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000081',true);
do $test$
declare
 store uuid:='20000000-0000-0000-0000-000000000081';
 c uuid; secret text; v_order_id uuid; second_order uuid;
 request uuid:='60000000-0000-0000-0000-000000000081';
 payload jsonb:='[{"product_id":"30000000-0000-0000-0000-000000000081","quantity":1,"options":[]}]'::jsonb;
 created jsonb; replay jsonb; payment_result jsonb; payment_request uuid:='70000000-0000-0000-0000-000000000081';
begin
 assert not has_function_privilege('anon','public.pitacco_fiado_overview(uuid)','execute');
 assert not has_function_privilege('anon','public.pitacco_fiado_rotate_code(uuid,uuid)','execute');
 assert not has_table_privilege('authenticated','public.pitacco_fiado_customers','select');
 assert pitacco_private.courier_payment_details(
   '{"payment":"fiado","payment_status":"fiado","fiado_customer_id":"segredo","debt":80}'::jsonb,20)
   ='{"state":"no_collect","method":"Sem cobrança na entrega","amount":null,"change_for":null,"change_due":null,"received_by_courier":false,"received_at":null}'::jsonb,
   'Entregador recebe somente instrução de não cobrar, sem situação financeira';
 c:=public.pitacco_fiado_save_customer(store,'Cliente Fiado','21988887777',25,true,7,'automatic',true);
 secret:=public.pitacco_fiado_rotate_code(store,c);
 assert length(secret)=10 and secret ~ '^[0-9]{10}$';
 assert (public.pitacco_fiado_public_eligibility('fiado-fixture','21988887777',secret)->>'eligible')::boolean=false,
   'Fiado desativado deve permanecer oculto';
 perform public.pitacco_fiado_toggle(store,true);
 assert (public.pitacco_fiado_public_eligibility('fiado-fixture','21988887777',secret)->>'eligible')::boolean;
 created:=public.pitacco_checkout_fiado('fiado-fixture',request,'Cliente Fiado','21988887777','',
    payload,'pickup','',secret);
 v_order_id:=(created->>'order_id')::uuid;
 assert v_order_id is not null;
 assert (select used=20 from public.pitacco_fiado_customers where id=c), 'Crédito reservado na criação';
 assert (select state='reserved' from public.pitacco_fiado_charges where order_id=v_order_id);
 -- Reenviar mesma requisição quando saldo disponível é menor que o pedido não duplica dívida.
 replay:=public.pitacco_checkout_fiado('fiado-fixture',request,'Cliente Fiado','21988887777','',
    payload,'pickup','',secret);
 assert replay->>'order_id'=created->>'order_id';
 assert (select count(*)=1 from public.pitacco_fiado_charges where customer_id=c);
 assert (select used=20 from public.pitacco_fiado_customers where id=c);
 begin
  perform public.pitacco_checkout_fiado('fiado-fixture',gen_random_uuid(),'Cliente Fiado','21988887777','',
    payload,'pickup','',secret);
  raise exception 'O limite deveria impedir a segunda compra';
 exception when others then
  if sqlerrm <> 'Limite do fiado insuficiente para este pedido' then raise;end if;
 end;
 -- Retirada entregue pelo funcionário converte a reserva em conta a receber.
 update public.orders set status='accepted',preparation_status='completed' where id=v_order_id;
 assert (select state='open' from public.pitacco_fiado_charges where order_id=v_order_id);
 payment_result:=public.pitacco_fiado_receive(store,c,8,'pix',payment_request,'Pagamento parcial');
 assert (payment_result->>'remaining')::numeric=12;
 assert (select amount=8 from public.pitacco_period_financial_report(store,
   (now() at time zone 'America/Sao_Paulo')::date,(now() at time zone 'America/Sao_Paulo')::date)
   where metric='recebimentos_fiado'), 'Somente pagamento efetivo entra como recebimento fiado';
 assert (select amount=12 from public.pitacco_period_financial_report(store,
   (now() at time zone 'America/Sao_Paulo')::date,(now() at time zone 'America/Sao_Paulo')::date)
   where metric='fiado_a_receber'), 'Saldo parcial continua separado do dinheiro recebido';
 assert (select amount=0 from public.pitacco_period_financial_report(store,
   (now() at time zone 'America/Sao_Paulo')::date,(now() at time zone 'America/Sao_Paulo')::date)
   where metric='recebimentos'), 'Caderneta não duplica recebimento de caixa';
 assert (select paid=8 from public.pitacco_fiado_charges where order_id=v_order_id);
 payment_result:=public.pitacco_fiado_receive(store,c,8,'pix',payment_request,'Pagamento parcial');
 assert (payment_result->>'duplicate')::boolean, 'Retentativa jamais debita em duplicidade';
 assert (select used=12 from public.pitacco_fiado_customers where id=c);
 payment_result:=public.pitacco_fiado_receive(store,c,12,'dinheiro',gen_random_uuid(),'Quitação');
 assert (payment_result->>'remaining')::numeric=0;
 assert (select state='settled' from public.pitacco_fiado_charges where order_id=v_order_id);
 assert (select used=0 from public.pitacco_fiado_customers where id=c);
 assert (select amount=20 and entries=2 from public.pitacco_period_financial_report(store,
   (now() at time zone 'America/Sao_Paulo')::date,(now() at time zone 'America/Sao_Paulo')::date)
   where metric='recebimentos_fiado'), 'Retentativa não duplica recebimentos no relatório';
 -- Um novo pedido cancelado precisa devolver o limite reservado.
 created:=public.pitacco_checkout_fiado('fiado-fixture',gen_random_uuid(),'Cliente Fiado','21988887777','',
    payload,'pickup','',secret);
 second_order:=(created->>'order_id')::uuid;
 assert (select amount=20 from public.pitacco_period_financial_report(store,
   (now() at time zone 'America/Sao_Paulo')::date,(now() at time zone 'America/Sao_Paulo')::date)
   where metric='fiado_reservado'), 'Reserva não é recebimento nem dívida exigível';
 update public.orders set status='cancelled' where id=second_order;
 assert (select state='cancelled' from public.pitacco_fiado_charges where order_id=second_order);
 assert (select used=0 from public.pitacco_fiado_customers where id=c);
 assert not exists(select 1 from public.pitacco_period_financial_report(store,
   (now() at time zone 'America/Sao_Paulo')::date,(now() at time zone 'America/Sao_Paulo')::date)
   where metric in ('fiado_a_receber','fiado_reservado')), 'Cancelamento e quitação eliminam os saldos abertos';
 -- Autorização manual não permite aceitar nem entregar antes da decisão da loja.
 perform public.pitacco_fiado_save_customer(store,'Cliente Fiado','21988887777',25,true,7,'manual',true);
 created:=public.pitacco_checkout_fiado('fiado-fixture',gen_random_uuid(),'Cliente Fiado','21988887777','',
    payload,'pickup','',secret);
 second_order:=(created->>'order_id')::uuid;
 begin
  update public.orders set status='accepted' where id=second_order;
  raise exception 'Deveria aguardar aprovação';
 exception when invalid_parameter_value then null;end;
 assert public.pitacco_fiado_approve(store,second_order,true);
 update public.orders set status='accepted' where id=second_order;
 assert (select approved_at is not null from public.pitacco_fiado_charges where order_id=second_order);
 update public.orders set status='cancelled' where id=second_order;
 assert (select used=0 from public.pitacco_fiado_customers where id=c);
 -- O gerente não pode enxergar cadastro alheio pela mesma RPC.
 begin
  perform public.pitacco_fiado_overview('20000000-0000-0000-0000-000000000082');
  raise exception 'Acesso indevido a outra loja';
 exception when insufficient_privilege then null;end;
end $test$;
rollback;
