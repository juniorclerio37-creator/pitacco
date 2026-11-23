import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const file=(path)=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
const frontend=file('revisions/0.12/web/MenuStudio.jsx');
const options=file('revisions/0.12/web/ProductComplements.jsx');
const central=file('revisions/0.12/web/CentralComplementLibrary.jsx');
const icon=file('revisions/0.12/web/CategoryIcons.jsx');
const publicMenu=file('marketing/cardapio.html');
const migration=file('supabase/migrations/20261123235500_menu_catalog_order.sql');
const sync=file('supabase/migrations/20261123235600_sync_shared_template_option_order.sql');

test('o ícone Açaís é um copo preenchido com coberturas tanto no painel quanto no cardápio público',()=>{
 assert.match(icon,/function AcaiCup\(\)/);
 assert.match(icon,/else if\(key==='acai'\)body=<AcaiCup\/>/);
 assert.match(icon,/fill="#7A248C"/);
 assert.match(icon,/F8CD66/);
 assert.match(publicMenu,/function pitaccoAcaiCup\(\)/);
 assert.match(publicMenu,/else if\(safe==='acai'\)root\.append\(pitaccoAcaiCup\(\)\)/);
 assert.doesNotMatch(icon,/acai:'🥣'/);
 assert.doesNotMatch(publicMenu,/acai:'🥣'/);
});

test('a loja pode ordenar categorias e produtos sem alterar seus dados',()=>{
 assert.match(frontend,/moveCategory\(name,direction\)/);
 assert.match(frontend,/moveProduct\(product,direction\)/);
 assert.match(frontend,/pitacco_catalog_reorder/);
 assert.match(frontend,/Mover categoria/);
 assert.match(frontend,/Mover produto/);
 assert.match(frontend,/categoryRanks/);
 assert.match(frontend,/Number\(a\.sort_order\)/);
 assert.match(migration,/alter table public\.products add column if not exists sort_order/);
 assert.match(migration,/create table if not exists public\.pitacco_menu_category_order/);
 assert.match(migration,/p_kind='products'/);
 assert.match(migration,/p_kind='categories'/);
});

test('grupos e opções podem ser reordenados diretamente na aba Complementos',()=>{
 assert.match(options,/moveItems\('groups',product\.id/);
 assert.match(options,/moveItems\('options',group\.id/);
 assert.match(options,/Subir grupo/);
 assert.match(options,/Descer complemento/);
 assert.match(central,/moveTemplate\(index,direction\)/);
 assert.match(central,/moveDraftOption\(index,direction\)/);
 assert.match(central,/p_kind:'templates'/);
 assert.match(sync,/sort_order=v_option_sort/);
});

test('a API pública ordena categorias, produtos, grupos e complementos pela ordem persistida',()=>{
 assert.match(migration,/pitacco_menu_category_order co/);
 assert.match(migration,/p\.sort_order,p\.name,p\.id/);
 assert.match(migration,/order by g\.sort_order,g\.name/);
 assert.match(migration,/order by o\.sort_order,o\.name/);
 assert.match(publicMenu,/new Set\(menu\.products\.map\(categoryOf\)\)/);
 assert.match(publicMenu,/for\(const product of products\)/);
});

test('a rotina valida loja, categoria e propriedade dos IDs antes de reordenar',()=>{
 assert.match(migration,/pitacco_private\.can_edit_catalog\(p_store\)/);
 assert.match(migration,/cardinality\(v_ids\)/);
 assert.match(migration,/where p\.store_id=p_store and p\.id=any\(v_ids\)/);
 assert.match(migration,/where g\.store_id=p_store and g\.product_id=p_parent/);
 assert.match(migration,/where o\.store_id=p_store and o\.group_id=p_parent/);
 assert.doesNotMatch(migration,/delete from public\.products|delete from public\.product_option_groups/i);
});
