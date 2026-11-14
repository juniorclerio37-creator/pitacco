begin;
insert into auth.users(id,email) values
 ('10000000-0000-0000-0000-000000000001','settlement-manager@example.invalid'),
 ('10000000-0000-0000-0000-000000000002','settlement-other@example.invalid');
insert into public.stores(id,name) values
 ('20000000-0000-0000-0000-000000000001','Settlement Store'),
 ('20000000-0000-0000-0000-000000000002','Other Store');
insert into public.store_members values
 ('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','gestor'),
 ('20000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000002','gestor');
insert into public.orders(id,store_id,channel,gross,fees,source,status,receipt) values
 ('30000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','iFood',30,5,'ifood','accepted','{"external_order_id":"001","external_account_id":"account"}'),
 ('30000000-0000-0000-0000-000000000002','20000000-0000-0000-0000-000000000001','iFood',40,5,'ifood','accepted','{}'),
 ('30000000-0000-0000-0000-000000000003','20000000-0000-0000-0000-000000000001','iFood',25,5,'ifood','accepted','{"external_order_id":"003"}'),
 ('30000000-0000-0000-0000-000000000004','20000000-0000-0000-0000-000000000001','iFood',25,5,'ifood','accepted','{"external_order_id":"003"}'),
 ('30000000-0000-0000-0000-000000000005','20000000-0000-0000-0000-000000000002','iFood',25,5,'ifood','accepted','{"external_order_id":"004"}'),
 ('30000000-0000-0000-0000-000000000006','20000000-0000-0000-0000-000000000001','iFood',25,5,'ifood','accepted','{"external_order_id":"001","external_account_id":"account-other"}');
insert into public.marketplace_acceptance_requests (id,store_id,order_id,source,state,external_order_id) values
 ('40000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000002','ifood','confirmed','002');
set local role authenticated;
select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000001',true);
do $test$
declare
 id uuid;
 store_id uuid:='20000000-0000-0000-0000-000000000001';
 lines jsonb:='[{"external_order":"001","net":"25.00"},{"external_order":"002","net":"34.30"},{"external_order":"003","net":"20.00"},{"external_order":"004","net":"20.00"}]';
 statuses jsonb;
begin
 id:=public.pitacco_import_marketplace_settlement(store_id,'ifood','account','payout','2026-11-12',lines);
 perform set_config('pitacco.test.settlement',id::text,true);
 assert public.pitacco_import_marketplace_settlement(store_id,'ifood','account','payout','2026-11-12',jsonb_build_array(lines->3,lines->1,lines->0,lines->2))=id;
 select jsonb_object_agg(r.external_order,r.status) into statuses from public.pitacco_marketplace_settlement_report(id) r;
 assert statuses='{"001":"matched","002":"different","003":"ambiguous","004":"unmatched"}';
 assert (select r.difference from public.pitacco_marketplace_settlement_report(id) r where r.external_order='002')=-0.70;
 begin
  perform public.pitacco_import_marketplace_settlement(store_id,'ifood','account','payout','2026-11-12','[{"external_order":"001","net":"21.00"}]');
  raise exception 'Expected a conflicting duplicate to fail';
 exception when raise_exception then
  if sqlerrm <> 'Esta referência já foi importada com dados diferentes' then raise;end if;
 end;
end;
$test$;
select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000002',true);
do $test$
begin
 assert not exists(select id from public.pitacco_marketplace_settlements);
 begin
  perform public.pitacco_marketplace_settlement_report(current_setting('pitacco.test.settlement')::uuid);
  raise exception 'Expected a report from another store to be denied';
 exception when raise_exception then
  if sqlerrm <> 'Repasse indisponível para este usuário' then raise;end if;
 end;
end;
$test$;
rollback;
