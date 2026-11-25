begin;
insert into auth.users(id,email) values ('10000000-0000-0000-0000-000000000071','cancel-manager@example.invalid'),('10000000-0000-0000-0000-000000000072','cancel-outsider@example.invalid');
insert into public.stores(id,name) values ('20000000-0000-0000-0000-000000000071','Cancel Test');
insert into public.store_members values ('20000000-0000-0000-0000-000000000071','10000000-0000-0000-0000-000000000071','gestor');
insert into public.orders(id,store_id,channel,gross,source,status,preparation_status) values
 ('30000000-0000-0000-0000-000000000071','20000000-0000-0000-0000-000000000071','Delivery próprio',20,'proprio','accepted','preparing'),
 ('30000000-0000-0000-0000-000000000072','20000000-0000-0000-0000-000000000071','Delivery próprio',20,'proprio','accepted','ready'),
 ('30000000-0000-0000-0000-000000000073','20000000-0000-0000-0000-000000000071','Delivery próprio',20,'proprio','accepted','completed'),
 ('30000000-0000-0000-0000-000000000074','20000000-0000-0000-0000-000000000071','Delivery próprio',20,'proprio','accepted','ready'),
 ('30000000-0000-0000-0000-000000000075','20000000-0000-0000-0000-000000000071','Delivery próprio',20,'proprio','pending','preparing'),
 ('30000000-0000-0000-0000-000000000076','20000000-0000-0000-0000-000000000071','iFood',20,'ifood','accepted','ready');
update public.orders set receipt='{"logistics":"retirada","merchant_sale_mode":"balcao","sales_channel":"venda_direta","point_of_sale":true}' where id='30000000-0000-0000-0000-000000000074';
update public.orders set receipt='{"logistics":"retirada"}' where id='30000000-0000-0000-0000-000000000075';
update public.orders set receipt='{"logistics":"loja"}' where id='30000000-0000-0000-0000-000000000072';
insert into public.deliveries(id,store_id,order_id,customer_name,address,status,source,logistics_provider)
values ('50000000-0000-0000-0000-000000000072','20000000-0000-0000-0000-000000000071','30000000-0000-0000-0000-000000000072','Cliente teste','Endereço de teste','pendente','proprio','loja');
set local role authenticated;
select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000072',true);
do $$begin
 begin perform public.pitacco_cancel_active_order('30000000-0000-0000-0000-000000000071','Teste bloqueio');raise exception 'Unexpected permission';
 exception when insufficient_privilege then null;end;
end $$;
select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000071',true);
do $$begin
 perform public.pitacco_cancel_active_order('30000000-0000-0000-0000-000000000071','Cancelamento no preparo');
 perform public.pitacco_cancel_active_order('30000000-0000-0000-0000-000000000072','Cancelamento pronto');
 perform public.pitacco_cancel_active_order('30000000-0000-0000-0000-000000000072','Repetição idempotente');
 perform public.pitacco_cancel_active_order('30000000-0000-0000-0000-000000000074','Retirada de balcão cancelada');
 perform public.pitacco_cancel_active_order('30000000-0000-0000-0000-000000000075','Retirada do cardápio cancelada');
 begin perform public.pitacco_cancel_active_order('30000000-0000-0000-0000-000000000076','Pedido externo');raise exception 'Unexpected marketplace cancellation';
 exception when raise_exception then if sqlerrm <> 'Use o cancelamento oficial da plataforma' then raise;end if;end;
 assert (select status='cancelada' from public.deliveries where id='50000000-0000-0000-0000-000000000072');
 assert (select status='accepted' from public.orders where id='30000000-0000-0000-0000-000000000076');
 assert (select count(*)=4 from public.orders where store_id='20000000-0000-0000-0000-000000000071' and status='cancelled');
 assert (select count(*)=4 from public.operation_audit where store_id='20000000-0000-0000-0000-000000000071' and action='order_cancelled');
 begin perform public.pitacco_cancel_active_order('30000000-0000-0000-0000-000000000073','Pedido concluído');raise exception 'Unexpected cancellation';
 exception when raise_exception then if sqlerrm <> 'Pedido já finalizado ou fora de andamento' then raise;end if;end;
end $$;
rollback;