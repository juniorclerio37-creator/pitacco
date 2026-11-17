import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {approvedReceipt} from '../approvedReceipt.mjs';

test('Windows keeps every merchant menu and never redirects to Pedidos',()=>{
 const source=readFileSync(new URL('../src.jsx',import.meta.url),'utf8');
 assert.doesNotMatch(source,/desktopOperationalTabs/);
 assert.doesNotMatch(source,/!nativeAvailable\(\)\|\|\['Visão Geral','Pedidos','Motoboys'/);
 for(const menu of ['Visão Geral','Pedidos','Motoboys','Meu Cardápio','Estoque','Integrações','Fideliza+','Clientes','Administrar Loja','Financeiro','Relatórios','Caixa']){
   assert.ok(source.includes("'"+menu+"'"),menu);
 }
 for(const target of ["tab==='Alertas'","tab==='Relatórios'","tab==='Estoque'","tab==='Minha Loja'","tab==='Horário de funcionamento'","tab==='Aparência do cardápio'"]){
   assert.ok(source.includes(target),'screen target absent: '+target);
 }
});

test('native print preview uses actual thermal receipt renderer',()=>{
 const operations=readFileSync(new URL('../Operations.jsx',import.meta.url),'utf8');
 assert.match(operations,/WindowsReceiptPreview/);
 const preview=readFileSync(new URL('../WindowsReceiptPreview.jsx',import.meta.url),'utf8');
 assert.match(preview,/approvedReceipt\(/);
 assert.match(preview,/savePrintPreference/);
 assert.match(preview,/58 mm/);
 assert.match(preview,/80 mm/);
});

test('iFood object modifiers render by name and quantity on 80mm and 58mm notes',()=>{
 const receipt={store_name:'Açaí do Linho',display_number:'3497',
  customer_name:'Cliente Teste',phone:'(21) 90000-0000',address:'Rua Teste, 100',
  payment_status:'paid',payment_method:'Cartão',total:27,notes:'Campainha',
  items:[{name:'Açaí combo',quantity:1,modifiers:[
   {name:'Leite em pó',quantity:2},{name:'Nutella',quantity:1}],notes:'Sem gelo'}]};
 for(const width of [58,80]){
  const text=approvedReceipt({receipt},width,{phone:false,address:false,notes:false,complements:true});
  assert.match(text,/2x Leite em pó/);
  assert.match(text,/1x Nutella/);
  assert.doesNotMatch(text,/\[object Object\]/);
  assert.doesNotMatch(text,/Rua Teste/);
  assert.doesNotMatch(text,/Campainha/);
  assert.match(text,/PAGO - NAO COBRAR/);
 }
});
