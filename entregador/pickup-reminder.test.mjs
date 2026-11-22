import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {pickupReminderType} from "./pickup-reminder.mjs";
const html=readFileSync(new URL("./painel.html",import.meta.url),"utf8");
const css=readFileSync(new URL("./painel.css",import.meta.url),"utf8");
const moduleCode=readFileSync(new URL("./pickup-reminder.mjs",import.meta.url),"utf8");
test("apenas cobranças na entrega em dinheiro ou cartão mostram o pop-up",()=>{
 assert.equal(pickupReminderType({state:"collect",method:"Dinheiro"}),"cash");
 assert.equal(pickupReminderType({state:"collect",method:"Cartão na entrega"}),"card");
 assert.equal(pickupReminderType({state:"collect",method:"Cartão de crédito"}),"card");
 assert.equal(pickupReminderType({state:"collect",method:"Pix"}),null);
 assert.equal(pickupReminderType({state:"paid",method:"Cartão na entrega"}),null);
 assert.equal(pickupReminderType({state:"unknown",method:"Dinheiro"}),null);
 assert.equal(pickupReminderType(undefined),null);
});
test("o modal mantém textos e ações EXATOS do esboço",()=>{
 for(const text of ["Leve a maquininha","Estou com a maquininha","Leve o troco",
  "Troco conferido","Troco para:","Troco necessário:","Valor a cobrar:",
  "Este pedido será pago no cartão na entrega.","Este pedido será pago em dinheiro na entrega."]) {
  assert.ok(moduleCode.includes(text),text);
 }
 assert.match(moduleCode,/showModal\(\)/);
 assert.match(moduleCode,/dialog\.addEventListener\("cancel"/);
 assert.match(moduleCode,/onConfirm\(\)/);
 assert.match(moduleCode,/if\(\(await onConfirm\(\)\)===true\)/);
 assert.match(css,/\.pitacco-pickup-modal::backdrop/);
});
test("não registra coleta antes do consentimento no modal; mantém RPC do lojista",()=>{
 assert.match(html,/showPickupReminder/);
 assert.match(html,/requestCourierPickup\(d\)/);
 assert.match(html,/collectCourierOrder\(d\)/);
 assert.match(html,/pitacco_driver_collect/);
 assert.match(html,/ifoodDriverAction\(d\.id,"dispatch"\)/);
 assert.match(html,/if\(collecting\)actions\.append\(createAction\("Coletar pedido","primary",\(\)=>requestCourierPickup\(d\)\)\)/);
});
