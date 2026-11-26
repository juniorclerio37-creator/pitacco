import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const file=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
const cashSql=file('supabase/migrations/20261124003000_cash_change_structured_checkout.sql');
const menu=file('marketing/cardapio.html');
const details=file('entregador/order-details.mjs');
const reminder=file('entregador/pickup-reminder.mjs');
const receipt=file('revisions/0.12/web/approvedReceipt.mjs');

test('troco considera o total incluindo entrega e descontos, não o subtotal',()=>{
 assert.match(menu,/function v2TotalToPay\(\)/);
 assert.match(menu,/subtotal\+fee-benefit\+paymentPriceAdjustment\(/);
 assert.match(menu,/const benefit=loyaltyDiscount\(\)/);
 assert.match(menu,/Number\(input\)\*100\)<Math\.round\(v2TotalToPay\(\)\*100\)/);
 assert.doesNotMatch(menu,/valor informado para troco precisa cobrir pelo menos os produtos/);
 assert.match(menu,/Cliente pagará com:/);
 assert.match(menu,/Troco a devolver:/);
});
test('backend grava change_for e change_due e mantém observações reais',()=>{
 assert.match(cashSql,/attach_cash_change_at_checkout/);
 assert.match(cashSql,/before insert on public\.orders/);
 assert.match(cashSql,/jsonb_set\(new\.receipt,'\{change_for\}'/);
 assert.match(cashSql,/jsonb_set\(new\.receipt,'\{change_due\}'/);
 assert.match(cashSql,/pg_catalog\.jsonb_set\(new\.receipt,'\{notes\}'/);
 assert.match(cashSql,/new\.gross/);
 assert.match(cashSql,/payment/);
});
test('pedidos antigos com notas Troco para R$ 50 são interpretados somente em dinheiro',()=>{
 assert.match(cashSql,/cash_change_for\(p_receipt jsonb,p_total numeric\)/);
 assert.match(cashSql,/if method not in \('dinheiro','cash','cod'\) then return null/);
 assert.match(cashSql,/coalesce\(r->>'notes',''\)/);
 assert.match(cashSql,/changeto:=pitacco_private\.cash_change_for\(r,amount\)/);
});
test('lembrete e detalhes do entregador mostram os valores reais',()=>{
 assert.match(reminder,/payment\.change_for!=null\?money\(payment\.change_for\)/);
 assert.match(reminder,/money\(payment\.change_due\)/);
 assert.match(details,/Cliente pagará com/);
 assert.match(details,/Troco a devolver/);
 assert.match(details,/p\.state==='collect'\|\|p\.state==='paid'/);
});
test('cupom separa o troco do total e das observações',()=>{
 assert.match(receipt,/change_for\?\?r\.cash_given\?\?r\.troco_para/);
 assert.match(receipt,/Troco para:/);
 assert.match(receipt,/TROCO:/);
});
