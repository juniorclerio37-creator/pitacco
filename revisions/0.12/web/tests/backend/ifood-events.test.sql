begin;
insert into auth.users(id,email) values
 ('10000000-0000-0000-0000-000000000001','owner-ifood@example.invalid'),
 ('10000000-0000-0000-0000-000000000002','manager-ifood@example.invalid');
insert into pitacco_private.platform_owner(user_id,login_name_hash)
values ('10000000-0000-0000-0000-000000000001',sha256(convert_to('00000000001','UTF8')));
insert into public.stores(id,name) values
 ('20000000-0000-0000-0000-000000000001','Loja iFood A'),
 ('20000000-0000-0000-0000-000000000002','Loja iFood B');
insert into public.store_members values
 ('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000002','gestor');

set local role authenticated;
select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000002',true);
do $$ begin
 assert not public.pitacco_ifood_linking_status();
 begin
  perform public.pitacco_owner_enable_ifood_linking(true);
  raise exception 'Expected merchant approval to fail';
 exception when insufficient_privilege then null;
 end;
 begin
  perform * from public.pitacco_ifood_connections('20000000-0000-0000-0000-000000000002');
  raise exception 'Other tenant credentials must be isolated';
 exception when insufficient_privilege then null;
 end;
 begin
  perform public.pitacco_ifood_claim_auto_confirm(null);
  raise exception 'Claim is service-only';
 exception when insufficient_privilege then null;
 end;
 begin
  perform public.pitacco_ifood_retry_authorized(gen_random_uuid());
  raise exception 'Scheduler verification is service-only';
 exception when insufficient_privilege then null;
 end;
end $$;
select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000001',true);
select public.pitacco_owner_enable_ifood_linking(true);

reset role;
insert into public.acceptance_settings(store_id,source,mode,enabled) values
 ('20000000-0000-0000-0000-000000000001','ifood','manual',true),
 ('20000000-0000-0000-0000-000000000002','ifood','automatic',true)
on conflict(store_id,source) do update set mode=excluded.mode,enabled=excluded.enabled;
set local role service_role;
do $$
declare
 merchant uuid:='40000000-0000-0000-0000-000000000001';
 store_a uuid:='20000000-0000-0000-0000-000000000001';
 store_b uuid:='20000000-0000-0000-0000-000000000002';
 actor uuid:='10000000-0000-0000-0000-000000000002';
 ref uuid;
 external_id uuid:=gen_random_uuid();
 event_id uuid:=gen_random_uuid();
 receipt jsonb;
 claim record;
 auto_claim record;
 partner_order uuid;
begin
 ref:=public.pitacco_ifood_begin_auth(actor,store_a,merchant,false,'encrypted-verifier-only',600);
 assert not exists(select 1 from public.pitacco_ifood_take_auth(ref,actor,store_b));
 assert (select merchant_id from public.pitacco_ifood_take_auth(ref,actor,store_a))=merchant;
 assert not exists(select 1 from public.pitacco_ifood_take_auth(ref,actor,store_a));
 perform public.pitacco_ifood_link_verified(store_a,merchant,false,'encrypted-credential-only');
 begin
  perform public.pitacco_ifood_link_verified(store_b,merchant,false,'other-encrypted-credential');
  raise exception 'Expected same merchant to stay with existing tenant';
 exception when raise_exception then
  if sqlerrm not like 'Esta conta iFood%' then raise; end if;
 end;
 assert not public.pitacco_ifood_enqueue(event_id,merchant,external_id,'PLACED',now());
 assert public.pitacco_ifood_enqueue(event_id,merchant,external_id,'PLACED',now(),true);
 assert not public.pitacco_ifood_enqueue(event_id,merchant,external_id,'PLACED',now(),true);
 select * into claim from public.pitacco_ifood_claim(event_id);
 assert claim.external_order_id=external_id;
 assert not exists(select 1 from public.pitacco_ifood_claim(event_id));
 receipt:=jsonb_build_object('external_order_id',external_id,'merchant_id',merchant,'total',25,
  'created_at',now(),'display_number','iFood-501','items','[]'::jsonb,'logistics','loja','address','Endereço de teste');
 perform public.pitacco_ifood_complete(event_id,gen_random_uuid(),receipt,false);
 assert not exists(select 1 from public.orders where source='ifood');
 perform public.pitacco_ifood_complete(event_id,claim.lease,receipt,false);
 assert (select count(*) from public.orders where source='ifood' and store_id=store_a and status='pending')=1;
 assert not exists(select 1 from public.pitacco_ifood_claim_auto_confirm(external_id));
 update public.acceptance_settings set mode='automatic' where store_id=store_a and source='ifood';
 select * into auto_claim from public.pitacco_ifood_claim_auto_confirm(external_id);
 assert auto_claim.external_order_id=external_id and auto_claim.uses_store_token;
 assert not exists(select 1 from public.pitacco_ifood_claim_auto_confirm(external_id));
 perform public.pitacco_ifood_finish_auto_confirm(external_id,auto_claim.lease,false);
 assert exists(select 1 from public.orders o where o.receipt->>'external_order_id'=external_id::text and status='pending');
 event_id:=gen_random_uuid();
 assert public.pitacco_ifood_enqueue(event_id,merchant,external_id,'CONFIRMED',now(),true);
 select * into claim from public.pitacco_ifood_claim(event_id);
 perform public.pitacco_ifood_complete(event_id,claim.lease,receipt,false);
 assert exists(select 1 from public.deliveries d join public.orders o on o.id=d.order_id
  where o.receipt->>'external_order_id'=external_id::text and o.status='accepted'
   and d.logistics_provider='loja' and d.status='pendente' and d.courier_id is null);
 partner_order:=gen_random_uuid();
 event_id:=gen_random_uuid();
 assert public.pitacco_ifood_enqueue(event_id,merchant,partner_order,'CONFIRMED',now(),true);
 select * into claim from public.pitacco_ifood_claim(event_id);
 perform public.pitacco_ifood_complete(event_id,claim.lease,receipt||jsonb_build_object('external_order_id',partner_order,'logistics','marketplace'),false);
 assert exists(select 1 from public.deliveries where external_order_id=partner_order::text and logistics_provider='marketplace' and courier_id is null);
 event_id:=gen_random_uuid();
 assert public.pitacco_ifood_enqueue(event_id,merchant,external_id,'CANCELLED',now()+interval '1 minute',true);
 select * into claim from public.pitacco_ifood_claim(event_id);
 perform public.pitacco_ifood_complete(event_id,claim.lease,receipt,false);
 event_id:=gen_random_uuid();
 assert public.pitacco_ifood_enqueue(event_id,merchant,external_id,'CONFIRMED',now(),true);
 select * into claim from public.pitacco_ifood_claim(event_id);
 perform public.pitacco_ifood_complete(event_id,claim.lease,receipt,false);
 assert (select count(*) from public.orders where source='ifood' and store_id=store_a and status='cancelled')=1;
 assert not exists(select 1 from public.orders where source='ifood' and store_id=store_b);
end $$;
rollback;
