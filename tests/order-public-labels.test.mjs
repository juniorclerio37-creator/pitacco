import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {publicOrderNumber,validLocalizer,historyCustomer} from '../revisions/0.12/web/orderDisplay.mjs';
const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');

test('D-/B- own orders show their assigned public number',()=>{
 assert.equal(publicOrderNumber({source:'proprio',receipt:{display_number:'D-1002',number:'a2b5c7d8-f111-4123-b456-abcdeffabcdef'}}),'D-1002');
 assert.equal(publicOrderNumber({source:'proprio',receipt:{display_number:'B-1001'}}),'B-1001');
});
test('99Food uses short operational number, never long internal ID',()=>{
 const o={source:'99food',id:'fd3998ee-80a0-4ea6-94f1-82bce4e5d812',
  receipt:{number:'99881234567890123',external_order_id:'99881234567890123',
  display_number:'4598'}};
 assert.equal(publicOrderNumber(o),'4598');
 assert.equal(publicOrderNumber({...o,receipt:{number:'99881234567890123'}}),'Aguardando número');
 assert.equal(publicOrderNumber({...o,receipt:{display_number:o.id}}),'Aguardando número');
 assert.equal(publicOrderNumber({...o,receipt:{display_number:'99881234567890123'}}),'Aguardando número');
 assert.equal(publicOrderNumber({...o,receipt:{}},{public_number:'4598'}),'4598');
});
test('merchant cards and kitchen board use the same authorized badge RPC',()=>{
 const ops=read('revisions/0.12/web/Operations.jsx');
 const mount=read('revisions/0.12/mount_orders_045.py');
 const orders=read('revisions/0.12/web/Pedidos.jsx');
 assert.match(ops,/client\.rpc\('pitacco_merchant_order_badges',\{p_store:storeId\}\)/);
 assert.match(ops,/setOrderBadges\(results\[7\]\.data\|\|\[\]\)/);
 assert.match(mount,/badges=\{orderBadges\}/);
 assert.match(orders,/publicOrderNumber\(o,badgeByOrder\.get\(o\?\.id\)\)/);
 assert.match(orders,/pedidos-localizer/);
 assert.match(ops,/operations-order-localizer/);
 assert.doesNotMatch(ops,/o\.id\.slice\(0,8\)/);
 assert.doesNotMatch(orders,/o\.id\.slice\(0,8\)/);
});
test('compact driver cards show public order number; private contact localizer stays in details',()=>{
 const html=read('entregador/painel.html');
 const detail=read('entregador/order-details.mjs');
 const sql=read('docs/sql/order-detail-public-number.sql');
 assert.match(html,/sb\.rpc\("pitacco_driver_card_badges"\)/);
 assert.match(html,/orderCardBadges\.get\(d\.id\)/);
 assert.match(html,/badge\?\.public_number\|\|"Aguardando número"/);
 assert.match(detail,/LOCALIZADOR DO CONTATO/);
 assert.match(html,/orderDetails\.open\(d\)/);
 assert.doesNotMatch(html,/String\(d\.order_id\|\|d\.id\)\.slice\(0,8\)/);
 assert.match(detail,/data\.display_number\|\|'Aguardando número'/);
 assert.match(sql,/pitacco_order_public_label/);
 assert.doesNotMatch(sql,/nullif\(v_delivery\.external_order_id/);
});
test('localizer is numeric and visible only if supplied',()=>{
 assert.equal(validLocalizer({localizer:'Localizador 1234 5678'}),'12345678');
 assert.equal(validLocalizer({localizer:null}),null);
});
test('badge functions are restricted to own assigned courier or authorized store',()=>{
 const sql=read('docs/sql/order-card-public-number-localizer.sql');
 assert.match(sql,/pitacco_courier_session_ready\(\)/);
 assert.match(sql,/c\.user_id=\(select auth\.uid\(\)\)/);
 assert.match(sql,/c\.store_id=d\.store_id/);
 assert.match(sql,/pitacco_private\.platform_owner/);
 assert.match(sql,/m\.role in \('gestor','lojista'\)/);
 assert.match(sql,/revoke all on function public\.pitacco_driver_card_badges\(\) from public,anon/);
 assert.match(sql,/revoke all on function public\.pitacco_merchant_order_badges\(uuid\) from public,anon/);
});

test('iFood importer saves phone locator privately without copying contact fields into receipts',()=>{
 const handler=read('supabase/functions/ifood-orders/handler.mjs');
 const sql=read('docs/sql/ifood-private-contact-ingestion.sql');
 assert.match(handler,/contact_phone:text\(order\.customer\?\.phone\?\.number,64\)/);
 assert.match(handler,/contact_localizer:text\(order\.customer\?\.phone\?\.localizer,32\)/);
 assert.match(handler,/contact_expires_at:iso\(order\.customer\?\.phone\?\.localizerExpiration\)/);
 assert.match(sql,/pitacco_delivery_customer_contacts/);
 assert.match(sql,/p_order-'merchant_id'-'created_at'-'contact_phone'-'contact_localizer'-'contact_expires_at'/);
 assert.match(sql,/d\.logistics_provider='loja'/);
 assert.match(sql,/d\.source='ifood'/);
});

test('order history retains own customer contacts and labels unavailable marketplace data',()=>{
 assert.deepEqual(historyCustomer({source:'proprio',receipt:{customer:'Cliente Exemplo',phone:'21900000000'}}),{name:'Cliente Exemplo',phone:'21900000000',phoneLabel:'21900000000'});
 assert.equal(historyCustomer({source:'ifood',receipt:{customer:'********',phone:'08007053040'}}).name,'Nome não disponível');
 assert.equal(historyCustomer({source:'ifood',receipt:{customer:'********',phone:'08007053040'}}).phone,'');
 assert.equal(historyCustomer({source:'ifood',receipt:{customer:'Cliente Exemplo'}}).name,'Cliente Exemplo');
 assert.equal(historyCustomer({source:'99food',receipt:{customer:'Cliente Exemplo',phone:'21****0000'}}).phone,'');
});
