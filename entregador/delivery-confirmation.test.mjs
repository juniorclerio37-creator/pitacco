import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const html=readFileSync(new URL("./painel.html",import.meta.url),"utf8");
const src=readFileSync(new URL("./delivery-confirmation.mjs",import.meta.url),"utf8");
const css=readFileSync(new URL("./painel.css",import.meta.url),"utf8");
test("approved flow: compact Concluir opens modal, not inline code on the card",()=>{
 assert.match(html,/createAction\("Concluir","primary compact-finish",\(\)=>openDeliveryFinish\(d\)\)/);
 assert.match(html,/showDeliveryFinish/);
 assert.doesNotMatch(html,/stageExtras\.append\(verify\)/);
 assert.match(src,/showModal\(\)/);
 assert.match(src,/delivery-sheet-pin-cells/);
 assert.match(src,/Finalizar entrega/);
 assert.match(css,/\.pitacco-delivery-sheet::backdrop/);
});
test("COD must be declared received before any code request",()=>{
 assert.match(src,/if\(payment\?\.state==="collect"\)paymentStep\(ctx,delivery,payment,args\)/);
 assert.match(src,/result\?\.state!=="paid"\|\|result\?\.received_by_courier!==true/);
 assert.match(src,/codeStep\(ctx,delivery,result/);
 assert.match(html,/pitacco_driver_confirm_payment/);
 assert.match(html,/pitacco_driver_verify_own_code/);
});
test("arrival requires explicit confirmation and no automatic completion",()=>{
 assert.match(html,/showArrivalConfirmation/);
 assert.match(src,/Confirmar chegada/);
 assert.match(html,/pitacco_driver_arrive/);
 assert.match(src,/modalBase/);
 assert.match(src,/pitacco-delivery-sheet/);
 assert.match(src,/A entrega não será concluída manualmente/);
});
test("real code validates on the server, with official iFood fallback",()=>{
 assert.match(html,/ifoodDriverAction\(d.id,"verify",digits\)/);
 assert.match(src,/confirmacao-entrega-propria\.ifood\.com\.br/);
 assert.match(src,/window\.location\.assign\(officialUrl\)/);
 assert.match(src,/navigator\.clipboard\.writeText\(officialUrl\)/);
 assert.match(src,/Código não confirmado/);
 assert.doesNotMatch(src,/payment_status\s*=\s*"paid"/);
});
