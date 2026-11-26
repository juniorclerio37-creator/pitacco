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
