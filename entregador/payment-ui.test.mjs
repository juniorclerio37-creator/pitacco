import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {money} from "./payment-ui.mjs";
const source=readFileSync(new URL("./payment-ui.mjs",import.meta.url),"utf8");
const page=readFileSync(new URL("./painel.html",import.meta.url),"utf8");
const sql=readFileSync(new URL("../supabase/migrations/20261122174000_courier_payment_receipt_collection.sql",import.meta.url),"utf8");
test("payment card always shows real payment state, amount and method",()=>{
 assert.equal(money(12.50),"R$ 12,50");
 assert.match(source,/Pagamento a verificar/);
 assert.match(source,/Cobrar na entrega/);
 assert.match(source,/PAGO/);
 assert.match(source,/A COBRAR/);
 assert.match(source,/CONFERIR/);
 assert.match(source,/Troco para/);
 assert.doesNotMatch(page,/Cobrança: a confirmar com a loja/);
 assert.match(page,/pitacco_driver_payment_cards/);
});
test("courier-only collection goes before code, never adds a merchant order stage",()=>{
 assert.match(page,/courierCollectStep\(payment,\(\)=>confirmCourierCollection\(d\)\)/);
 assert.match(page,/pitacco_driver_confirm_payment/);
 assert.match(source,/Cobrar pagamento/);
 assert.match(source,/Confirmar pagamento recebido/);
 assert.match(sql,/if d\.status<>'retirada' or d\.arrived_at is null/);
 assert.match(sql,/d\.logistics_provider='loja'/);
 assert.match(sql,/courier_payment_received/);
 assert.match(sql,/guard_own_delivery_cod/);
 assert.doesNotMatch(sql,/update public\.deliveries set status='paid'/);
});
