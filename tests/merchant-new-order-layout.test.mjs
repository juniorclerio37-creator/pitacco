import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const view=readFileSync(new URL('../revisions/0.12/web/MerchantNewOrder.jsx',import.meta.url),'utf8');
const css=readFileSync(new URL('../revisions/0.12/web/merchant-navigation.css',import.meta.url),'utf8');
test('modern POS retains real catalog, own customer lookup and secure checkout',()=>{
 for(const expected of ['get_public_menu','pitacco_merchant_customers','pitacco_merchant_channel_checkout','pitacco_fiado_balcao_discount','delivery-quote','quotePizzaSelection','PizzaBuilder','p_items:items','p_coupon:','p_quote:','p_sale_mode:type'])assert.ok(view.includes(expected),expected);
 for(const expected of ['Tipo de atendimento','Produtos do cardápio','Resumo do pedido','Finalizar Pedido','p.image_url','changeLine','Categorias','Ver itens do pedido'])assert.ok(view.includes(expected),expected);
 assert.ok(view.includes('Agendamento de venda direta ainda indisponível'));
 assert.match(css,/\.mn-pos-v2 \.mn-pos-grid\{grid-template-columns:minmax/);
 assert.match(css,/@media\(max-width:850px\)/);
});

import {composeAddress,currentQuote} from '../revisions/0.12/web/merchantDeliveryAddress.mjs';
test('merchant freight requires complete structured address, current quote and exact confirmed point',()=>{
 const a={street:'Rua Teste',number:'123',neighborhood:'Centro',city:'Nova Iguaçu',state:'rj',postal:'26000-000',extra:'Casa 2'};
 const address=composeAddress(a);assert.equal(address,'Rua Teste, 123, Centro, Nova Iguaçu, RJ, CEP 26000000, Casa 2');assert.equal(composeAddress({...a,number:''}),'');
 const now=Date.now(),point=[-22.7,-43.4],q={quote_id:'test',address,pointKey:JSON.stringify(point),fee:0,expires_at:new Date(now+60000).toISOString()};
 assert.equal(currentQuote(q,address,point,now),true);assert.equal(currentQuote(q,address,null,now),false);assert.equal(currentQuote(q,address+' changed',point,now),false);assert.equal(currentQuote(q,address,point,now+60001),false);
 assert.match(view,/requestId=id\(\)/);assert.match(view,/request\.current=requestId/);assert.match(view,/latitude:point\[0\],longitude:point\[1\]/);assert.match(view,/delivery&&!quoteCurrent/);assert.match(view,/aria-pressed=\{received\}/);
});
