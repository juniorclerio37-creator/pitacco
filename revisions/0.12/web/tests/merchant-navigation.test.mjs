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

test('all menu groups start closed, only manual expansion or search opens them',()=>{
 const source=readFileSync(new URL('../MerchantNavigation.jsx',import.meta.url),'utf8');
 assert.match(source,/\[open,setOpen\]=useState\(\[\]\)/);
 assert.match(source,/setFavorites\(read\(key\+':favorites',\[\]\)\);setOpen\(\[\]\)/);
 assert.doesNotMatch(source,/key\+':open'/);
 assert.doesNotMatch(source,/\},\[routeId,key\]\)/);
 assert.match(source,/expanded=!!query\|\|open\.includes\(g\.name\)/);
});

test('mobile merchant menu opens only from the bottom More button and remains accessible',()=>{
 const source=readFileSync(new URL('../MerchantNavigation.jsx',import.meta.url),'utf8');
 const css=readFileSync(new URL('../merchant-navigation.css',import.meta.url),'utf8');
 assert.match(source,/aria-controls="pitacco-store-navigation" aria-expanded=\{menuOpen\}/);
 assert.match(css,/\.pitacco-mobile-top\.mn-redundant-top\{display:none!important\}/);
});

test('incident center is a visible delivery shortcut and precedes the other workspaces',()=>{const route=resolveMenuRoute('Ocorrências');assert.equal(route.label,'Central de Ocorrências');assert.equal(route.tab,'Entregas');assert.equal(route.section,'occurrences');const source=readFileSync(new URL('../src.jsx',import.meta.url),'utf8');assert.ok(source.indexOf('<IncidentCenter')<source.indexOf('<StorefrontShare'));assert.match(source,/showShortcut=\{tab==='Entregas'\|\|tab==='Ocorrências'\}/);assert.match(source,/tab=route.section==='occurrences'\?'Ocorrências':route.tab/);assert.match(source,/!allowed\(route.tab\)/);});
