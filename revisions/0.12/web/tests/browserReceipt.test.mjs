import test from 'node:test';
import assert from 'node:assert/strict';
import {browserReceiptText,browserReceiptHtml,openBrowserPrint} from '../browserReceipt.mjs';

const order={
 id:'c0000000-0000-0000-0000-000000000001',source:'proprio',gross:25,
 created_at:'2026-11-17T16:00:00Z',status:'accepted',
 receipt:{customer_name:'Cliente <script>alert(1)</script>',
  items:[{quantity:1,name:'Açaí 500ml',options:[{quantity:2,name:'Banana'}]}],
  payment_method:'dinheiro',payment_confirmed:false,total:25}
};
test('browser receipt preserves actual items without falsely claiming paid',()=>{
 const text=browserReceiptText(order,'D-52','Pitacco Loja');
 assert.match(text,/PEDIDO D-52/);
 assert.match(text,/Açaí 500ml/);
 assert.match(text,/2x Banana/);
 assert.doesNotMatch(text,/PAGO - NAO COBRAR/);
 assert.match(text,/COBRAR NA ENTREGA/);
});
test('browser receipt HTML escapes customer content; no active HTML from orders',()=>{
 const html=browserReceiptHtml(browserReceiptText(order,'D-52'));
 assert.doesNotMatch(html,/<script>/);
 assert.match(html,/&lt;script&gt;/);
 assert.match(html,/<pre>/);
});
test('explicit user click opens browser print dialog, not a backend print job',()=>{
 let written='',printed=0,closed=0,delay=0,focused=false;
 const windowStub={
  document:{open(){},write(x){written=x},close(){}},
  focus(){focused=true},
  setTimeout(fn,ms){delay=ms;fn()},
  print(){printed++},
  close(){closed++}
 };
 assert.equal(openBrowserPrint(order,'D-52','Pitacco Loja',()=>windowStub),true);
 assert.equal(printed,1);
 assert.equal(closed,0);
 assert.equal(delay,200);
 assert.equal(focused,true);
 assert.match(written,/PEDIDO D-52/);
});
test('blocked browser popup reports actionable error',()=>{
 assert.throws(()=>openBrowserPrint(order,'D-52','',()=>null),/bloqueou/);
});
