import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {deliveryBucket,paymentChipInfo,safeFinishedToday,isNotificationDiagnostic} from "./compact-dashboard.mjs";

test("courier dashboard tabs reflect actual assigned delivery stages",()=>{
 const d={source:"proprio",logistics_provider:"loja"};
 assert.equal(deliveryBucket({...d,status:"atribuida"}),"coleta");
 assert.equal(deliveryBucket({...d,status:"aceita"}),"coleta");
 assert.equal(deliveryBucket({...d,status:"aceita",collected_at:"2026-11-22T10:00:00-03:00"}),"andamento");
 assert.equal(deliveryBucket({...d,status:"retirada"}),"andamento");
 assert.equal(deliveryBucket({...d,status:"entregue"}),"terminal");
 assert.equal(deliveryBucket({...d,status:"cancelada"}),"terminal");
});
test("payment badges are factual; collection popup types stay separate",()=>{
 assert.equal(paymentChipInfo({state:"paid",method:"Online",amount:28.9}).tone,"paid");
 const card=paymentChipInfo({state:"collect",method:"Cartão na entrega",amount:42.50});
 assert.equal(card.hint,"Leve a maquininha");
 assert.equal(card.label,"Cartão na entrega");
 const cash=paymentChipInfo({state:"collect",method:"Dinheiro",amount:35});
 assert.equal(cash.hint,"Leve o troco");
 assert.equal(paymentChipInfo({state:"unknown",method:"Dinheiro"}).tone,"unknown");
});
test("concluded tab can only reuse sanitized, local-day deliveries",()=>{
 const today="2026-11-22";
 assert.ok(safeFinishedToday({status:"entregue",finished_at:"2026-11-22T14:30:00Z"},today));
 assert.equal(safeFinishedToday({status:"cancelada",finished_at:"2026-11-22T14:30:00Z"},today),false);
 assert.equal(safeFinishedToday({status:"entregue",finished_at:"2026-11-21T14:30:00Z"},today),false);
});
test("approved white dashboard retains actual earnings and courier RPC actions",()=>{
 const page=readFileSync(new URL("./painel.html",import.meta.url),"utf8");
 const css=readFileSync(new URL("./painel.css",import.meta.url),"utf8");
 for(const label of ["Saldo do dia","Entregas hoje","Ganhos no mês","Aguardando coleta",
 "Entregas em andamento","Entregas concluídas"]){
  assert.ok(page.includes(label),label);
 }
 assert.match(page,/id="homeTodayBalance"/);
 assert.match(page,/id="homeTodayCount"/);
 assert.match(page,/id="homeMonthBalance"/);
 assert.match(page,/pitacco_driver_earnings/);
 assert.match(page,/pitacco_driver_history/);
 assert.match(page,/pitacco_driver_collect/);
 assert.match(page,/requestCourierPickup\(d\)/);
 assert.match(page,/showPickupReminder/);
 assert.match(page,/pitacco_driver_confirm_payment/);
 assert.match(page,/pitacco_driver_verify_own_code/);
 assert.match(page,/ifoodDriverAction\(d.id,"verify",digits\)/);
 assert.match(page,/data-order-bucket="coleta"/);
 assert.match(page,/data-order-bucket="andamento"/);
 assert.match(page,/data-order-bucket="concluidas"/);
 assert.match(css,/\.courier-dashboard-balances/);
 assert.match(css,/\.compact-delivery-layout/);
});

test("synthetic notification delivery is never a real order or a code-confirmation task",()=>{
 const synthetic={
  id:"e430bd54-f71d-4b06-9407-d1b8f4db8f9a",
  source:"proprio",order_id:null,status:"retirada",
  customer_name:"TESTE INTERNO PITACCO — NÃO É CLIENTE",
  address:"SEM DESTINO — TESTE DE NOTIFICAÇÃO. NÃO REALIZAR ENTREGA",
  notes:"PITACCO_FCM_DIAG_20261121_1551"
 };
 assert.equal(isNotificationDiagnostic(synthetic),true);
 for(const other of [
  {...synthetic,order_id:"real-order-id"},
  {...synthetic,notes:"Pedido de cliente"},
  {...synthetic,address:"Rua do Cliente, 42"},
  {...synthetic,customer_name:"Cliente real"},
  {...synthetic,source:"ifood"},
  {...synthetic,notes:"PITACCO_FCM_DIAG_20261121_1551_EXTRA"}
 ])assert.equal(isNotificationDiagnostic(other),false,"Real deliveries must never be hidden");
 const page=readFileSync(new URL("./painel.html",import.meta.url),"utf8");
 assert.match(page,/list\.filter\(d=>!\["entregue","cancelada"\]\.includes\(d\.status\)&&!isNotificationDiagnostic\(d\)\)/);
 assert.match(page,/if\(isNotificationDiagnostic\(d\)\)/);
 assert.match(page,/Este registro é apenas um teste interno de notificação/);
 assert.match(page,/Este pedido não possui código de entrega gerado/);
 assert.match(page,/pitacco_driver_own_code_lengths/);
 assert.match(page,/pitacco_driver_verify_own_code/);
 assert.match(page,/ifoodDriverAction\(d.id,"verify",digits\)/);
});
