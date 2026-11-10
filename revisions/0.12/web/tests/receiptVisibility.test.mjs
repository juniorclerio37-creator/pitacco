import test from 'node:test';
import assert from 'node:assert/strict';
import {approvedReceipt} from '../approvedReceipt.mjs';
const job={order_id:'abc',receipt:{display_number:'D-1001',customer_name:'Maria',phone:'21999999999',address:'Rua Exemplo, 10',notes:'Sem gelo',items:[{quantity:1,name:'Açaí',notes:'Sem açúcar',complements:[{name:'Leite em pó',quantity:2}]}],total:30}};
test('receipt respects privacy toggles per store',()=>{
 const hidden=approvedReceipt(job,80,{phone:false,address:false,notes:false,complements:false});
 assert(!hidden.includes('21999999999'));assert(!hidden.includes('Rua Exemplo'));assert(!hidden.includes('Sem gelo'));assert(!hidden.includes('Leite em pó'));assert(hidden.includes('D-1001'));
 const full=approvedReceipt(job,80,{});
 assert(full.includes('21999999999'));assert(full.includes('Rua Exemplo'));assert(full.includes('Leite em pó'));
});
test('58 and 80 millimeter layouts remain readable',()=>{
 for(const width of [58,80]){const out=approvedReceipt(job,width,{});assert(out.includes('PEDIDO D-1001'));assert(out.split('\n').every(line=>line.length<=(width===58?30:44)))}
});
