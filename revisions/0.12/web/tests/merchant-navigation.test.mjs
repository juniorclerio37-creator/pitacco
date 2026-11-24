import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {groups,routes,resolveMenuRoute,menuAllowed,searchMenu,fallbackMenuItems} from '../merchantNavigation.mjs';
test('approved groups, unique routes, existing sections',()=>{
 assert.deepEqual(groups.map(g=>g.name),['Operação','Cardápio','Entregas','Clientes','Fideliza+','Financeiro','Integrações','Configurações']);
 assert.equal(new Set(routes.map(r=>r.id)).size,routes.length);
 for(const [id,tab,section] of [['Complementos','Produtos','Complementos'],['Categorias','Produtos','Categorias'],['Cashback','Fideliza+','Cashback'],['Cupons de desconto','Fideliza+','Cupons'],['Contas a receber','Fiado / Caderneta','pedidos'],['Alertas e sons','Configurações','Alertas e aplicativo'],['Pagamento de motoboys','Entregadores','Pagamentos']]){const r=resolveMenuRoute(id);assert.equal(r.tab,tab);assert.equal(r.section,section)}
});
test('tenant and module restrictions, legacy fallback and search',()=>{
 const ctx={allowed:()=>true,manager:false,active:true};
 assert.equal(menuAllowed(resolveMenuRoute('Fiado / Caderneta'),ctx),false);
 assert.equal(menuAllowed(resolveMenuRoute('Fiado / Caderneta'),{...ctx,manager:true}),true);
 assert.equal(menuAllowed(resolveMenuRoute('Estoque do cardápio'),{...ctx,manager:true,featureSettings:{estoque:false}}),false);
 assert.equal(menuAllowed(resolveMenuRoute('Pedidos'),{...ctx,driver:true}),false);
 assert.equal(menuAllowed(resolveMenuRoute('Entregas'),{...ctx,driver:true}),true);
 assert.equal(searchMenu(resolveMenuRoute('Configurações'),'impressao'),true);
 assert.deepEqual(fallbackMenuItems([['Pedidos'],['Exemplo']],{},{}).map(r=>r.id),['Exemplo']);
});
test('final application keeps real components and stable route URLs',()=>{
 const app=readFileSync(new URL('../src.jsx',import.meta.url),'utf8');
 for(const name of ['MerchantNavigation','MerchantMobileBar','NavigationFleetTracking','MenuStudio','FiadoCaderneta','CourierWorkspace','FinancialReport','Operations','AppDownloads'])assert.ok(app.includes('<'+name),name);
 assert.match(app,/location.searchParams.set\('aba',navigationRoute\)/);
 assert.match(app,/initialSection=\{route.section/);
 assert.match(app,/initialTab=\{route.section/);
 assert.match(app,/<Operations navigationSection=\{route.section\} navigationKey=\{navigationKey\} key=\{selected\}/);
});
