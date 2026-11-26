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
select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000002',true);
do $central$ begin
 perform public.pitacco_ifood_central_request('20000000-0000-0000-0000-000000000001','40000000-0000-0000-0000-000000000001');
 assert (select count(*) from public.pitacco_ifood_central_requests('20000000-0000-0000-0000-000000000001'))=1;
 begin
  perform public.pitacco_ifood_central_request('20000000-0000-0000-0000-000000000002','40000000-0000-0000-0000-000000000001');
  raise exception 'Other tenant must not be writable';
 exception when insufficient_privilege then null; end;
 begin
  perform public.pitacco_owner_ifood_central_requests();
  raise exception 'Owner-only review queue';
 exception when insufficient_privilege then null; end;
 begin
  perform public.pitacco_ifood_central_approve(gen_random_uuid(),auth.uid(),gen_random_uuid(),'Unauthorized');
  raise exception 'Approval is service-only';
 exception when insufficient_privilege then null; end;
end $central$;
select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000001',true);
select set_config('pitacco.test_central_request',id::text,true) from public.pitacco_owner_ifood_central_requests() where merchant_id='40000000-0000-0000-0000-000000000001';
select public.pitacco_owner_ifood_central_review(current_setting('pitacco.test_central_request')::uuid,'awaiting');

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
 begin
  perform public.pitacco_ifood_begin_auth(actor,store_a,merchant,false,'encrypted-verifier-only',600);
  raise exception 'Expected distributed production link to fail';
 exception when raise_exception then
  if sqlerrm not like 'Use a solicitação centralizada%' then raise; end if;
 end;
 ref:=public.pitacco_ifood_begin_auth(actor,store_a,merchant,true,'encrypted-verifier-only',600);
 assert not exists(select 1 from public.pitacco_ifood_take_auth(ref,actor,store_b));
 assert (select merchant_id from public.pitacco_ifood_take_auth(ref,actor,store_a))=merchant;
 assert not exists(select 1 from public.pitacco_ifood_take_auth(ref,actor,store_a));
 ref:=current_setting('pitacco.test_central_request')::uuid;
 assert public.pitacco_ifood_central_approve(ref,'10000000-0000-0000-0000-000000000001',merchant,'Loja iFood A');
 assert public.pitacco_ifood_central_environment(merchant)='production';
 assert not public.pitacco_ifood_central_enqueue(event_id,merchant,external_id,'PLACED',now(),false);
 assert public.pitacco_ifood_central_enqueue(event_id,merchant,external_id,'PLACED',now(),true);
 assert not public.pitacco_ifood_central_enqueue(event_id,merchant,external_id,'PLACED',now(),true);
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
 assert auto_claim.external_order_id=external_id and not auto_claim.uses_store_token;
 assert not exists(select 1 from public.pitacco_ifood_claim_auto_confirm(external_id));
 perform public.pitacco_ifood_finish_auto_confirm(external_id,auto_claim.lease,false);
 assert exists(select 1 from public.orders o where o.receipt->>'external_order_id'=external_id::text and status='pending');
 event_id:=gen_random_uuid();
 assert public.pitacco_ifood_central_enqueue(event_id,merchant,external_id,'CONFIRMED',now(),true);
 select * into claim from public.pitacco_ifood_claim(event_id);
 perform public.pitacco_ifood_complete(event_id,claim.lease,receipt,false);
 assert exists(select 1 from public.deliveries d join public.orders o on o.id=d.order_id
  where o.receipt->>'external_order_id'=external_id::text and o.status='accepted'
   and d.logistics_provider='loja' and d.status='pendente' and d.courier_id is null);
 partner_order:=gen_random_uuid();
 event_id:=gen_random_uuid();
 assert public.pitacco_ifood_central_enqueue(event_id,merchant,partner_order,'CONFIRMED',now(),true);
 select * into claim from public.pitacco_ifood_claim(event_id);
 perform public.pitacco_ifood_complete(event_id,claim.lease,receipt||jsonb_build_object('external_order_id',partner_order,'logistics','marketplace'),false);
 assert exists(select 1 from public.deliveries where external_order_id=partner_order::text and logistics_provider='marketplace' and courier_id is null);
 event_id:=gen_random_uuid();
 assert public.pitacco_ifood_central_enqueue(event_id,merchant,external_id,'CANCELLED',now()+interval '1 minute',true);
 select * into claim from public.pitacco_ifood_claim(event_id);
 perform public.pitacco_ifood_complete(event_id,claim.lease,receipt,false);
 event_id:=gen_random_uuid();
 assert public.pitacco_ifood_central_enqueue(event_id,merchant,external_id,'CONFIRMED',now(),true);
 select * into claim from public.pitacco_ifood_claim(event_id);
 perform public.pitacco_ifood_complete(event_id,claim.lease,receipt,false);
 assert (select count(*) from public.orders where source='ifood' and store_id=store_a and status='cancelled')=1;
 assert not exists(select 1 from public.orders where source='ifood' and store_id=store_b);
end $$;
rollback;

-- New orders arriving while Pitacco is blocked are permanently suppressed, without disconnecting the provider.
begin;
do $test$
declare s uuid;m uuid:=gen_random_uuid(); distributed_m uuid:=gen_random_uuid();o uuid:=gen_random_uuid(); dist_order uuid:=gen_random_uuid(); fresh uuid:=gen_random_uuid();prior uuid:=gen_random_uuid();queued uuid:=gen_random_uuid(); e uuid;l uuid;payload jsonb; c uuid; i uuid; a uuid:=gen_random_uuid(); offer jsonb; pe date:=current_date-7;
begin
 insert into public.stores(name) values('iFood block fixture') returning id into s;
 insert into pitacco_private.ifood_merchants(merchant_id,store_id,test_only,enabled) values(m,s,true,true);
 insert into pitacco_private.ifood_merchants(merchant_id,store_id,test_only,enabled,credential) values(distributed_m,s,true,true,'fixture-only');
 e:=gen_random_uuid();perform public.pitacco_ifood_enqueue(e,m,prior,'PLACED',now(),false);
 select lease into l from public.pitacco_ifood_claim(e);
 payload:=jsonb_build_object('external_order_id',prior,'merchant_id',m,'total',20,'created_at',now(),'logistics','loja');
 perform public.pitacco_ifood_complete(e,l,payload,true);
 assert exists(select 1 from pitacco_private.ifood_order_links where external_id=prior);
 e:=gen_random_uuid();perform public.pitacco_ifood_enqueue(e,m,queued,'PLACED',now(),false);
 select lease into l from public.pitacco_ifood_claim(e);
 insert into pitacco_private.subscription_admin_controls(store_id,suspended) values(s,true);
 perform public.pitacco_ifood_complete(e,l,null,null);
 assert exists(select 1 from pitacco_private.ifood_suppressed_orders where merchant_id=m and external_order_id=queued);
 assert (select done_at is not null from pitacco_private.ifood_events where id=e);
 e:=gen_random_uuid();perform public.pitacco_ifood_central_enqueue(e,m,o,'PLACED',now(),false);
 assert (select done_at is not null from pitacco_private.ifood_events where id=e);
 assert not exists(select 1 from public.pitacco_ifood_claim(e));
 e:=gen_random_uuid();perform public.pitacco_ifood_enqueue(e,distributed_m,dist_order,'PLACED',now(),true);
 assert (select done_at is not null from pitacco_private.ifood_events where id=e);
 assert not exists(select 1 from public.pitacco_ifood_claim(e));
 assert m=any(public.pitacco_ifood_central_online(array[m],false)),'Do not disconnect provider';
 e:=gen_random_uuid();perform public.pitacco_ifood_enqueue(e,m,prior,'CONFIRMED',now(),false);
 select lease into l from public.pitacco_ifood_claim(e);
 assert l is not null;perform public.pitacco_ifood_complete(e,l,payload,true);
 assert (select state_rank=2 from pitacco_private.ifood_order_links where external_id=prior);
 update pitacco_private.subscription_admin_controls set suspended=false where store_id=s;
 e:=gen_random_uuid();perform public.pitacco_ifood_enqueue(e,m,o,'CONFIRMED',now(),false);
 assert (select done_at is not null from pitacco_private.ifood_events where id=e);
 assert not exists(select 1 from public.pitacco_ifood_claim(e));
 e:=gen_random_uuid();perform public.pitacco_ifood_enqueue(e,distributed_m,dist_order,'CONFIRMED',now(),true);
 assert (select done_at is not null from pitacco_private.ifood_events where id=e);
 -- Financial block uses the same gate, not a separate provider state.
 update pitacco_private.commercial_billing_control set enforce_own_orders=true,payment_instructions='Teste isolado de cobrança',pix_cnpj='00000000000000',pix_recipient='Fixture de teste' where singleton;
 select x into offer from pitacco_private.plan_catalog_versions v cross join lateral jsonb_array_elements(v.plans) x where v.revision='2026-11-24-v4' and x->>'code'='free';
 insert into pitacco_private.commercial_contracts(store_id,revision,plan_code,effective_from,terms,assigned_by) values(s,'2026-11-24-v4','free',pe-7,offer,a) returning id into c;
 insert into pitacco_private.commercial_closings(contract_id,store_id,kind,period_start,period_end,due_at,grace_until,amount_cents,state,details) values(c,s,'commission',pe-6,pe,now()-interval '49 hours',now()-interval '1 hour',2000,'calculated','{}');
 insert into pitacco_private.commercial_invoices(contract_id,kind,period_end,amount_cents,due_at,grace_until) values(c,'commission',pe,2000,now()-interval '49 hours',now()-interval '1 hour') returning id into i;
 o:=gen_random_uuid();e:=gen_random_uuid();perform public.pitacco_ifood_enqueue(e,m,o,'PLACED',now(),false);
 assert (select done_at is not null from pitacco_private.ifood_events where id=e);
 insert into pitacco_private.commercial_manual_payments(invoice_id,amount_cents,reference,verified_by,note) values(i,2000,'TEST-'||gen_random_uuid(),a,'Isolated payment');
 e:=gen_random_uuid();perform public.pitacco_ifood_enqueue(e,m,o,'CONFIRMED',now(),false);
 assert (select done_at is not null from pitacco_private.ifood_events where id=e);
 e:=gen_random_uuid();perform public.pitacco_ifood_enqueue(e,m,fresh,'PLACED',now(),false);
 select lease into l from public.pitacco_ifood_claim(e);
 assert l is not null;perform public.pitacco_ifood_complete(e,l,jsonb_build_object('external_order_id',fresh,'merchant_id',m,'total',20,'created_at',now(),'logistics','loja'),true);
 assert exists(select 1 from pitacco_private.ifood_order_links where external_id=fresh);
 assert not exists(select 1 from pitacco_private.ifood_order_links where external_id in(o,queued,dist_order));
 assert (select count(*) from public.orders where store_id=s)=2;
 assert not has_table_privilege('authenticated','pitacco_private.ifood_suppressed_orders','SELECT');
end $test$;
rollback;
