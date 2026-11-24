import test from 'node:test';
import assert from 'node:assert/strict';
import {approvedReceipt} from '../approvedReceipt.mjs';
const job={order_id:'542007',receipt:{store_name:'Acai do Linho',number:'542007',customer_name:'Cliente Teste',items:[{quantity:1,name:'Acai 770ml',options:[{quantity:2,name:'Leite em po'}]}],total:34.99,payment:'Dinheiro',change_for:50}};
test('cash on delivery shows change, repeated additions and approved footer',()=>{
 const s=approvedReceipt(job,80);
 assert.match(s,/2x Leite em po/);assert.match(s,/TROCO:\s+R\$\s?15,01/);
 assert.match(s,/COBRAR NA ENTREGA/);assert.doesNotMatch(s,/Previsao de entrega/);
 assert.match(s,/Impresso por Pitacco/);
});
test('confirmed payment never requests collection or change',()=>{
 const s=approvedReceipt({...job,receipt:{...job.receipt,payment_confirmed:true}},58);
 assert.match(s,/NAO COBRAR NA ENTREGA/);assert.doesNotMatch(s,/\*\*\* COBRAR NA ENTREGA \*\*\*/);
 assert.doesNotMatch(s,/TROCO:/);
});
test('unconfirmed pix is not marked paid',()=>{
 const s=approvedReceipt({...job,receipt:{...job.receipt,payment:'Pix',change_for:null}},80);
 assert.match(s,/PAGAMENTO A CONFERIR/);assert.doesNotMatch(s,/PAGO ONLINE/);
});


test('99Food original order, contact, locator, address and card-on-delivery amount',()=>{
 const s=approvedReceipt({receipt:{store_name:'Açaí do Linho',source:'99food',display_number:'R-100',external_order_number:'542012',
  localizer:'K8Q2',customer_name:'Ana',customer_phone:'(21) 90000-0000',
  delivery_address:{street:'Rua das Flores',number:'18',neighborhood:'Centro',city:'Nova Iguaçu',state:'RJ'},
  items:[{name:'Açaí 770ml',quantity:1,total:21.05}],total:21.05,payment_method:'Crédito na entrega',payment_on_delivery:true}},80);
 assert.match(s,/99Food Nº 542012/);
 assert.match(s,/Localizador: K8Q2/);
 assert.match(s,/Telefone: \(21\) 90000-0000/);
 assert.match(s,/Endereco: Rua das Flores, 18/);
 assert.match(s,/COBRAR NA ENTREGA/);
 assert.match(s,/Valor a cobrar:.*21,05/);
 assert.match(s,/Forma de pagamento: Crédito na entrega/);
 assert.doesNotMatch(s,/PAGO ONLINE/);
});
test('iFood, own storefront and Keeta show source-prefixed order numbers',()=>{
 for(const [source,number,expected] of [['ifood','45678','iFood Nº 45678'],['cardapio','D-52','Loja Nº D-52'],['keeta','K-88','Keeta Nº K-88']]){
  const s=approvedReceipt({receipt:{source,display_number:number,items:[],total:10,payment_method:'Cartão',payment_status:'paid'}},58);
  assert.match(s,new RegExp(expected));
  assert.ok(s.split('\n').every(line=>line.length<=30));
 }
});
test('cash on delivery identifies collectible value, cash tender and change',()=>{
 const s=approvedReceipt({receipt:{source:'proprio',display_number:'D-85',items:[],total:21.05,payment_method:'dinheiro',change_for:30}},80);
 assert.match(s,/Loja Nº D-85/);
 assert.match(s,/Valor a cobrar:.*21,05/);
 assert.match(s,/Troco para:.*30,00/);
 assert.match(s,/TROCO:.*8,95/);
});
test('unverified card payments never claim paid or auto-collect',()=>{
 const s=approvedReceipt({receipt:{source:'ifood',display_number:'123',items:[],total:22,payment_method:'Cartão',payment_status:'pending'}},80);
 assert.match(s,/PAGAMENTO A CONFERIR/);
 assert.doesNotMatch(s,/PAGO ONLINE/);
});
test('confirmed payment never generates collect instruction even for cash',()=>{
 const s=approvedReceipt({receipt:{source:'99food',display_number:'888',items:[],total:22,payment_method:'Dinheiro',payment_confirmed:true,change_for:30}},80);
 assert.match(s,/NAO COBRAR NA ENTREGA/);
 assert.doesNotMatch(s,/Troco para/);
 assert.doesNotMatch(s,/Valor a cobrar/);
});

test('print PAGO ONLINE only for verified online payments',()=>{
 const base={source:'99food',display_number:'542012',items:[],total:27,payment_method:'Crédito',payment_confirmed:true};
 const regular=approvedReceipt({receipt:base},80);
 assert.match(regular,/PEDIDO PAGO/);
 assert.doesNotMatch(regular,/PAGO ONLINE/);
 const online=approvedReceipt({receipt:{...base,payment_online:true}},80);
 assert.match(online,/PAGO ONLINE/);
 assert.match(online,/NAO COBRAR NA ENTREGA/);
});

test('pizza receipt identifies size, portions, dough and crust and total on both paper sizes',()=>{
 const job={receipt:{source:'proprio',items:[{name:'Pizza',quantity:2,unit_total:59.95,modifiers:[{group:'Tamanho',name:'Grande',price:5.05},{group:'Sabor',name:'Calabresa',numerator:1,denominator:2,price:0},{group:'Sabor',name:'Frango',numerator:1,denominator:2,price:0},{group:'Borda',name:'Catupiry',price:5},{group:'Massa',name:'Fina',price:0}]}],total:119.90,payment:'Pix'}};
 for(const width of [58,80]){const s=approvedReceipt(job,width);assert.match(s,/Tamanho: Grande/);assert.match(s,/Sabor 1\/2: Calabresa/);assert.match(s,/Sabor 1\/2: Frango/);assert.match(s,/Borda: Catupiry/);assert.match(s,/Massa: Fina/);assert.match(s,/2 x Pizza.*119,90/);assert.ok(s.split('\n').every(line=>line.length<=(width===58?30:44)));}
});
