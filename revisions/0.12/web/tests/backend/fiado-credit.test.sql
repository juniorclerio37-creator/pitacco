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

-- Helper de regressão: simula cliente que informa o PIN, recebe um token
-- interno e usa esse token somente para a requisição correspondente.
create or replace function pg_temp.fiado_checkout_test(
 p_slug text,p_request uuid,p_customer text,p_phone text,p_address text,
 p_items jsonb,p_fulfillment text,p_notes text,p_code text,
 p_quote uuid default null,p_scheduled_for timestamptz default null
) returns jsonb language plpgsql as $testcheckout$
declare verified jsonb;
begin
 verified:=public.pitacco_fiado_verify_pin(p_slug,p_phone,'438216',p_request);
 if coalesce((verified->>'verified')::boolean,false) is not true then
  return jsonb_build_object('error','Não foi possível validar o Fiado');end if;
 return public.pitacco_checkout_fiado(p_slug,p_request,p_customer,p_phone,p_address,
  p_items,p_fulfillment,p_notes,verified->>'token',p_quote,p_scheduled_for);
end $testcheckout$;

-- Os asserts conferem tabelas internas como papel de teste privilegiado; as RPCs
-- verificam o gestor por auth.uid, e as permissões do papel authenticated são
-- checadas explicitamente com has_table_privilege/has_function_privilege.
select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000081',true);
do $test$
declare
 store uuid:='20000000-0000-0000-0000-000000000081';
 c uuid; v_order_id uuid; second_order uuid; i integer;
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
 c:=public.pitacco_fiado_save_customer_pin(store,'Cliente Fiado','21988887777',25,true,7,'automatic',true,'438216');
 assert (select pin_hash is not null from public.pitacco_fiado_customers where id=c),
  'Lojista cadastra PIN com hash bcrypt, sem texto simples';
 assert (select pin_hash <> '438216' and pin_hash like '$2a$%' from public.pitacco_fiado_customers where id=c),
  'PIN não fica em texto puro e usa bcrypt';
 assert not has_table_privilege('anon','public.pitacco_fiado_customers','select');
 assert not has_table_privilege('authenticated','public.pitacco_fiado_customers','select');
 assert to_regprocedure('public.pitacco_fiado_verify_birthdate(text,text,text,uuid)') is null,
   'RPC antiga de nascimento foi removida';
 assert to_regprocedure('public.pitacco_fiado_save_customer_identity(uuid,text,text,numeric,boolean,integer,text,boolean,text)') is null,
   'Cadastro com data de nascimento foi removido';
 assert (select count(*)=0 from information_schema.columns
  where table_schema='public' and table_name='pitacco_fiado_customers' and column_name like 'birth_date%');
  assert not has_function_privilege('authenticated','public.pitacco_fiado_rotate_code(uuid,uuid)','execute'),
  'A loja não deve gerar códigos para clientes';
 assert not has_function_privilege('anon','public.pitacco_fiado_public_eligibility(text,text,text)','execute'),
  'A consulta pública antiga por código foi desativada';
 assert (public.pitacco_fiado_phone_eligibility('fiado-fixture','21988887777')->>'eligible')::boolean=false,
   'Opção Fiado só aparece quando loja e cliente estiverem ativos';
 perform public.pitacco_fiado_toggle(store,true);
 assert (public.pitacco_fiado_verify_pin('fiado-fixture','21988887777','438217',gen_random_uuid())->>'verified')::boolean=false,
  'PIN incorreto não deve emitir autorização';
 assert (public.pitacco_fiado_verify_pin('fiado-fixture','21988887777','438216',gen_random_uuid())->>'verified')::boolean,
  'PIN correto emite token de uso curto';
 assert (public.pitacco_checkout_fiado('fiado-fixture',gen_random_uuid(),'Cliente Fiado','21988887777','',
   '[{"product_id":"30000000-0000-0000-0000-000000000081","quantity":1,"options":[]}]'::jsonb,
   'pickup','',null) ? 'error'),'Sem token não é possível comprar';

 assert (public.pitacco_fiado_phone_eligibility('fiado-fixture','21988887777')->>'eligible')::boolean,
   'Telefone autorizado recebe Fiado automaticamente';
 assert public.pitacco_fiado_checkout_status('fiado-fixture','21988887777',20) @> '{"visible":true,"enabled":true}'::jsonb,
   'Compra abaixo do saldo interno habilita o Fiado sem expor números';
 assert public.pitacco_fiado_checkout_status('fiado-fixture','21988887777',26) @> '{"visible":true,"enabled":false}'::jsonb,
   'Compra acima do saldo interno mantém opção visível e desabilitada';
 assert not (public.pitacco_fiado_checkout_status('fiado-fixture','21988887777',20) ? 'available')
   and not (public.pitacco_fiado_checkout_status('fiado-fixture','21988887777',20) ? 'credit_limit')
   and not (public.pitacco_fiado_checkout_status('fiado-fixture','21988887777',20) ? 'used'),
   'RPC pública não envia limite, saldo ou valor consumido';
 assert not (public.pitacco_fiado_checkout_status('fiado-fixture','21988887777',20) ? 'available'),
   'Consulta não revela limite disponível';
 assert public.pitacco_fiado_checkout_status('fiado-fixture','21911112222',20) @> '{"visible":false,"enabled":false}'::jsonb,
   'Não autorizado não vê a opção';
 assert (public.pitacco_fiado_phone_eligibility('fiado-fixture','21911112222')->>'eligible')::boolean=false,
   'Telefone não cadastrado não vê Fiado';
 assert not public.pitacco_fiado_phone_eligibility('fiado-fixture','21988887777') ? 'phone',
   'Consulta não expõe telefone, dívidas nem limites';
 created:=pg_temp.fiado_checkout_test('fiado-fixture',request,'Cliente Fiado','21988887777','',
    payload,'pickup','',null);
 v_order_id:=(created->>'order_id')::uuid;
 assert v_order_id is not null;
 assert created->>'fiado_approval'='approved', 'Modo automático autoriza Fiado sem código';
 assert (select used=20 from public.pitacco_fiado_customers where id=c), 'Crédito reservado na criação';
 assert (public.pitacco_fiado_phone_eligibility('fiado-fixture','21988887777')->>'eligible')::boolean,
   'A elegibilidade por telefone continua positiva se ainda existe algum crédito';
 assert public.pitacco_fiado_checkout_status('fiado-fixture','21988887777',20) @> '{"visible":true,"enabled":false}'::jsonb,
   'Pedido acima do restante apresenta opção desabilitada';
 assert (select state='reserved' from public.pitacco_fiado_charges where order_id=v_order_id);
 -- Reenviar mesma requisição quando saldo disponível é menor que o pedido não duplica dívida.
 replay:=pg_temp.fiado_checkout_test('fiado-fixture',request,'Cliente Fiado','21988887777','',
    payload,'pickup','',null);
 assert replay->>'order_id'=created->>'order_id';
 assert (select count(*)=1 from public.pitacco_fiado_charges where customer_id=c);
 assert (select used=20 from public.pitacco_fiado_customers where id=c);
 begin
  perform pg_temp.fiado_checkout_test('fiado-fixture',gen_random_uuid(),'Cliente Fiado','21988887777','',
    payload,'pickup','',null);
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
 created:=pg_temp.fiado_checkout_test('fiado-fixture',gen_random_uuid(),'Cliente Fiado','21988887777','',
    payload,'pickup','',null);
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
 created:=pg_temp.fiado_checkout_test('fiado-fixture',gen_random_uuid(),'Cliente Fiado','21988887777','',
    payload,'pickup','',null);
 second_order:=(created->>'order_id')::uuid;
 assert created->>'fiado_approval'='pending','Modo manual aguarda a loja';
 assert (select approval_required and approved_at is null from public.pitacco_fiado_charges where order_id=second_order),
  'Crédito reservado mas ainda não autorizado';
 begin
  update public.orders set status='accepted' where id=second_order;
  raise exception 'Deveria aguardar aprovação';
 exception when invalid_parameter_value then null;end;
 assert public.pitacco_fiado_approve(store,second_order,true);
 assert (select receipt->>'fiado_approval'='approved' from public.orders where id=second_order),
  'Aprovação no gestor aparece no pedido';
 update public.orders set status='accepted' where id=second_order;
 assert (select approved_at is not null from public.pitacco_fiado_charges where order_id=second_order);
 update public.orders set status='cancelled' where id=second_order;
 assert (select used=0 from public.pitacco_fiado_customers where id=c);
 -- Recusa manual devolve integralmente o crédito reservado, sem gerar contas a receber.
 created:=pg_temp.fiado_checkout_test('fiado-fixture',gen_random_uuid(),'Cliente Fiado','21988887777','',
    payload,'pickup','',null);
 second_order:=(created->>'order_id')::uuid;
 assert created->>'fiado_approval'='pending';
 assert public.pitacco_fiado_approve(store,second_order,false);
 assert (select status='rejected' and receipt->>'fiado_approval'='rejected'
   from public.orders where id=second_order),'A loja recusa o pedido sem autorizar o Fiado';
 assert (select state='cancelled' from public.pitacco_fiado_charges where order_id=second_order);
 assert (select used=0 from public.pitacco_fiado_customers where id=c),'Recusa libera reserva';
 -- Um número sem autorização não cria pedido, ainda que enviado com pagamento Fiado.
 created:=pg_temp.fiado_checkout_test('fiado-fixture',gen_random_uuid(),'Pessoa sem fiado','21911119999','',
    payload,'pickup','',null);
 assert created ? 'error';
 -- Cinco tentativas inválidas bloqueiam temporariamente o cliente;
 -- após atualizar o PIN no painel, o gestor pode redefinir o bloqueio.
 for i in 1..5 loop
  assert (public.pitacco_fiado_verify_pin('fiado-fixture','21988887777','438217',gen_random_uuid())->>'verified')::boolean=false;
 end loop;
 assert (select pin_locked_until>now() from public.pitacco_fiado_customers where id=c);
 assert (public.pitacco_fiado_verify_pin('fiado-fixture','21988887777','438216',gen_random_uuid())->>'verified')::boolean=false,
  'PIN correto durante bloqueio não permite crédito';
 perform public.pitacco_fiado_save_customer_pin(store,'Cliente Fiado','21988887777',25,true,7,'manual',true,'438216');
 assert (select pin_locked_until is null from public.pitacco_fiado_customers where id=c),
  'Lojista redefine acesso mediante atualização do PIN';
  -- O gerente não pode enxergar cadastro alheio pela mesma RPC.
 begin
  perform public.pitacco_fiado_overview('20000000-0000-0000-0000-000000000082');
  raise exception 'Acesso indevido a outra loja';
 exception when insufficient_privilege then null;end;
end $test$;
rollback;
