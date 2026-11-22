import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');

test('arrival RPC records arrived_at and never completes a delivery',()=>{
 const sql=read('docs/sql/driver-arrival-privacy-proof.sql');
 const section=sql.split('create or replace function public.pitacco_driver_arrive')[1].split('revoke all on function public.pitacco_driver_arrive')[0];
 assert.match(section,/pitacco_courier_session_ready/);
 assert.match(section,/c\.user_id=\(select auth\.uid\(\)\)/);
 assert.match(section,/d\.status<>'retirada'/);
 assert.match(section,/set arrived_at=pg_catalog\.now\(\)/);
 assert.match(section,/courier_arrived/);
 assert.doesNotMatch(section,/status\s*=\s*'entregue'/);
});
test('completed delivery raw data is hidden at RLS layer; only sanitized history is available',()=>{
 const sql=read('docs/sql/driver-arrival-privacy-proof.sql');
 assert.match(sql,/deliveries\.status not in \('entregue','cancelada'\)/);
 assert.match(sql,/pitacco_courier_session_ready/);
 assert.match(sql,/not exists\(select 1 from public\.profiles p where p\.id=\(select auth\.uid\(\)\) and p\.role='entregador'\)/);
 const history=sql.split('create or replace function public.pitacco_driver_history')[1].split('revoke all on function public.pitacco_driver_history')[0];
 assert.match(history,/d\.status='entregue'/);
 assert.match(history,/c\.user_id=\(select auth\.uid\(\)\)/);
 assert.match(history,/'initial'/);
 assert.match(history,/'address_hint'/);
 assert.doesNotMatch(history,/'customer_name'|'phone_number'|'address'\s*,\s*d\.address/);
});
test('direct Pitacco PIN only completes after arrival and correct code',()=>{
 const sql=read('docs/sql/driver-arrival-privacy-proof.sql');
 assert.match(sql,/extensions\.gen_random_bytes/);
 assert.match(sql,/pitacco_own_delivery_codes/);
 assert.match(sql,/revoke all on public\.pitacco_own_delivery_codes from public,anon,authenticated/);
 assert.match(sql,/p_code !~ '\^\[0-9\]\{6\}\$'/);
 assert.match(sql,/d\.status<>'retirada' or d\.arrived_at is null/);
 assert.match(sql,/if code_row\.code<>p_code then/);
 assert.match(sql,/return pg_catalog\.jsonb_build_object\('verified',false/);
 assert.match(sql,/set delivery_code_verified_at=pg_catalog\.now\(\),/);
 assert.match(sql,/Chegada e código de entrega verificado são obrigatórios/);
});
test('customer tracking shows private PIN only with active tracking token',()=>{
 const sql=read('docs/sql/customer-tracking-arrival-code.sql');
 const html=read('marketing/acompanhar.html');
 assert.match(sql,/c\.tracking_token=p_token and c\.expires_at>now\(\)/);
 assert.match(sql,/o\.source='proprio' and d\.status='retirada'/);
 assert.match(sql,/pitacco_own_delivery_codes/);
 assert.match(html,/id="deliveryPinCard"/);
 assert.match(html,/id="deliveryPin"/);
 assert.match(html,/d\.arrived_at/);
});
test('courier app uses arrival before code, no completed PII from ordinary list',()=>{
 const page=read('entregador/painel.html');
 const client=read('entregador/supabase-client.mjs');
 assert.match(page,/Cheguei na entrega/);
 assert.match(page,/pitacco_driver_arrive/);
 assert.match(page,/pitacco_driver_verify_own_code/);
 assert.match(page,/pitacco_driver_history/);
 assert.match(read("entregador/delivery-confirmation.mjs"),/Finalizar entrega/);
 assert.match(page,/Registre primeiro a chegada ao cliente/);
 assert.match(client,/\.in\('status', \['pendente','atribuida','aceita','retirada'\]\)/);
 assert.doesNotMatch(page,/set_delivery_status/);
});
test('iFood code result is guarded by assigned order, arrival and server credentials',()=>{
 const sql=read('docs/sql/ifood-courier-arrival-verify.sql');
 assert.match(sql,/pitacco_courier_session_ready/);
 assert.match(sql,/c\.user_id=\(select auth\.uid\(\)\)/);
 assert.match(sql,/src\.status='retirada' and src\.arrived_at is not null/);
 assert.match(sql,/pitacco_private\.ifood_order_links/);
 assert.match(sql,/grant execute on function public\.pitacco_ifood_driver_result\(uuid,uuid,text,boolean,boolean\) to service_role/);
 const handler=read('supabase/functions/ifood-orders/handler.mjs');
 assert.match(handler,/arrivedAtDestination/);
 assert.match(handler,/verifyDeliveryCode/);
 assert.match(handler,/verification\?\.valid===true/);
});
