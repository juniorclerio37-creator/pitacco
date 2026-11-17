import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createOrderDetailsController} from '../entregador/order-details.mjs';
const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');

test('tapping a card requests detailed data for the assigned delivery only',()=>{
 const html=read('entregador/painel.html');
 const module=read('entregador/order-details.mjs');
 assert.match(html,/class="order-overlay" id="orderDetailOverlay" hidden/);
 assert.match(html,/role="dialog" aria-modal="true"/);
 assert.match(html,/orderDetails\.open\(d\)/);
 assert.match(module,/supabase\.rpc\('pitacco_driver_order_detail',\{p_delivery:delivery\.id\}\)/);
 assert.match(module,/data\.delivery_id!==delivery\.id/);
 assert.match(module,/content\.replaceChildren\(buildDetails\(data,delivery,navigate\)\)/);
 assert.doesNotMatch(module,/\.innerHTML\s*=/);
});
test('contact action is chosen by real phone versus intermediary 0800 and localizer',()=>{
 const module=read('entregador/order-details.mjs');
 assert.match(module,/resolveCustomerContact\(details\.contact\)/);
 assert.match(module,/resolved\.type === 'real'/);
 assert.match(module,/resolved\.type === 'expired'/);
 assert.match(module,/resolved\.localizer/);
 assert.match(module,/Ligar para o 0800/);
 assert.match(module,/Conversar no WhatsApp/);
 assert.match(module,/Não funciona pelo WhatsApp/);
 assert.match(module,/resolved\.callHref/);
 assert.match(module,/linkButton\('Ligar para o 0800', resolved\.href, 'call'\)/);
 assert.match(module,/navigate\(\{\.\.\.delivery,address:details\.address \?\? delivery\.address\}\)/);
});
test('RPC protects contact PII with assigned courier, active status and a valid session',()=>{
 const sql=read('docs/sql/driver-order-details-contact.sql');
 assert.match(sql,/security definer/);
 assert.match(sql,/pitacco_courier_session_ready\(\)/);
 assert.match(sql,/c\.user_id = \(select auth\.uid\(\)\)/);
 assert.match(sql,/c\.store_id = d\.store_id/);
 assert.match(sql,/d\.status not in \('entregue','cancelada'\)/);
 assert.match(sql,/co\.delivery_id = v_delivery\.id/);
 assert.match(sql,/co\.store_id = v_delivery\.store_id/);
 assert.match(sql,/revoke all on table public\.pitacco_delivery_customer_contacts from public, anon, authenticated/);
 assert.match(sql,/revoke all on function public\.pitacco_driver_order_detail\(uuid\) from public, anon/);
 assert.match(sql,/grant execute on function public\.pitacco_driver_order_detail\(uuid\) to authenticated/);
 assert.match(sql,/customer.phone.localizer/);
});
test('private contact table is never exposed on common deliveries table',()=>{
 const sql=read('docs/sql/driver-order-details-contact.sql');
 assert.match(sql,/drop column if exists customer_phone/);
 assert.match(sql,/drop column if exists customer_phone_localizer/);
 assert.match(sql,/drop column if exists customer_phone_expires_at/);
 const html=read('entregador/painel.html');
 assert.doesNotMatch(html,/customer_phone\s*:/);
});

test('order details controller loads and parses as a valid ES module',()=>{
 assert.equal(typeof createOrderDetailsController,'function');
});
