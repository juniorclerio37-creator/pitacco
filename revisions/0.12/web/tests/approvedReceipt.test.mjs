import test from 'node:test';
import assert from 'node:assert/strict';
import {approvedReceipt} from '../approvedReceipt.mjs';
const job={order_id:'542007',receipt:{store_name:'Acai do Linho',number:'542007',customer_name:'Cliente Teste',items:[{quantity:1,name:'Acai 770ml',options:[{quantity:2,name:'Leite em po'}]}],total:34.99,payment:'Dinheiro',change_for:50}};
test('cash on delivery shows change, repeated additions and approved footer',()=>{
 const s=approvedReceipt(job,80);
 assert.match(s,/2x Leite em po/);assert.match(s,/TROCO: R\$\s?15,01/);
 assert.match(s,/COBRAR NA ENTREGA/);assert.doesNotMatch(s,/Previsao de entrega/);
 assert.match(s,/Impresso por Pitacco Gestao de Delivery/);
});
test('confirmed payment never requests collection or change',()=>{
 const s=approvedReceipt({...job,receipt:{...job.receipt,payment_confirmed:true}},58);
 assert.match(s,/PAGO - NAO COBRAR/);assert.doesNotMatch(s,/COBRAR NA ENTREGA/);
 assert.doesNotMatch(s,/TROCO:/);
});
test('unconfirmed pix is not marked paid',()=>{
 const s=approvedReceipt({...job,receipt:{...job.receipt,payment:'Pix',change_for:null}},80);
 assert.match(s,/COBRAR NA ENTREGA/);assert.doesNotMatch(s,/PAGO - NAO COBRAR/);
});
