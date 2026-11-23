import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {parsePublicMenu} from '../supabase/functions/menu-import/parser.mjs';

test('leitura genérica de dados estruturados sem plataforma específica',()=>{
 const markup='<html><script type="application/ld+json">'+JSON.stringify({
  "@context":"https://schema.org","@type":"Product","name":"Suco natural",
  "category":"Bebidas","description":"500 ml",
  "image":"https://foto.exemplo.com/suco.webp",
  "offers":{"@type":"Offer","price":"12.50","priceCurrency":"BRL"}
 })+'</script></html>';
 const out=parsePublicMenu(markup,'https://cardapio.exemplo.com/');
 assert.equal(out.products.length,1);
 assert.equal(out.products[0].name,'Suco natural');
 assert.equal(out.products[0].price,12.5);
 assert.equal(out.products[0].category,'Bebidas');
 assert.equal(out.products[0].image_url,'https://foto.exemplo.com/suco.webp');
});
test('JSON público com produtos, grupos e limites obrigatórios',()=>{
 const data={products:[{name:'Combo da casa',price:32.9,category:'Combos',
  groups:[{name:'Bebida',min:1,max:1,options:[{name:'Suco',price:0},{name:'Água',price:3.5}]}]}]};
 const out=parsePublicMenu(JSON.stringify(data),'https://loja.exemplo.com/','application/json');
 assert.equal(out.products.length,1);
 assert.equal(out.products[0].groups[0].options[1].price,3.5);
 assert.equal(out.counts.groups,1);assert.equal(out.counts.options,2);
});
test('JSON em lista simples',()=>{
 const out=parsePublicMenu(JSON.stringify([{name:'Água 500 ml',price:'5,50'}]),'https://loja.exemplo.com/','application/json');
 assert.equal(out.products[0].price,5.5);
});
test('Nuxt devalue genérico com preços em centavos e grupos',()=>{
 const payload=[
  null,{data:2},{catalog:3},{categories:4,productsByCategory:5},[6],{cat1:7},
  {id:8,name:9},[10],'cat1','Bebidas',
  {name:11,price:12,customs:13,active:14},'Suco natural',1990,[15],true,
  {title:16,type:17,required:14,choices:18},'Tamanho','unique',[19,20],
  {title:21,extraPrice:22,active:14}, {title:23,extraPrice:24,active:14},
  '300ml',0,'500ml',300
 ];
 const html='<script id="__NUXT_DATA__" type="application/json">'+JSON.stringify(payload)+'</script>';
 const result=parsePublicMenu(html,'https://loja.exemplo.com/');
 assert.equal(result.products.length,1);
 assert.equal(result.products[0].price,19.9);
 assert.equal(result.products[0].groups.length,1);
 assert.equal(result.products[0].groups[0].options[1].price,3);
});
test('página sem dados não inventa itens',()=>{
 const result=parsePublicMenu('<html><h1>Cardápio</h1></html>','https://loja.exemplo.com/');
 assert.deepEqual(result.products,[]);assert.ok(result.warnings.length);
});
test('não carregar fontes remotas não relacionadas na compilação',()=>{
 const source=readFileSync(new URL('../revisions/0.12/web/UniversalMenuImporter.jsx',import.meta.url),'utf8');
 assert.match(source,/client\.functions\.invoke\('menu-import'/);
 assert.match(source,/pitacco_menu_import_apply/);
 assert.match(source,/Substituir o cardápio publicado/);
 assert.match(source,/Nenhuma alteração será publicada antes da confirmação/);
 assert.doesNotMatch(source,/Brendi|brendi/i);
});
