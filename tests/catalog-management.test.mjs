import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const root=new URL('../revisions/0.12/web/',import.meta.url);
const source=name=>readFileSync(new URL(name,root),'utf8');
const menu=source('MenuStudio.jsx'),central=source('CentralComplementLibrary.jsx');
const complements=source('ProductComplements.jsx'),design=source('StoreDesignStudio.jsx');
const stock=source('CatalogFinishedStock.jsx'),inventory=source('Inventory.jsx');
const mount=readFileSync(new URL('../revisions/0.12/mount_universal_menu_import.py',import.meta.url),'utf8');
const sql=readFileSync(new URL('../supabase/migrations/20261123225500_catalog_studio_shared_groups_stock.sql',import.meta.url),'utf8');
const publicMenu=readFileSync(new URL('../marketing/cardapio.html',import.meta.url),'utf8');

test('aba Produtos apresenta fotos e permite editar a mesma imagem já importada',()=>{
 assert.match(menu,/catalog-product-cover/);
 assert.match(menu,/p\.image_url\?<img src=\{p\.image_url\}/);
 assert.match(menu,/objectFit:'contain'/);
 assert.match(menu,/uploadStoreImage\(client,storeId,photo,'products'\)/);
});
test('cinco áreas reais substituem placeholders no cardápio',()=>{
 for(const name of ['CentralComplementLibrary','StoreDesignStudio','CatalogFinishedStock','Inventory'])
  assert.match(menu,new RegExp(name));
 assert.doesNotMatch(menu,/A gestão completa desta seção ainda depende/);
 assert.doesNotMatch(menu,/Abra um produto para cadastrar e editar seus complementos/);
 assert.match(mount,/store=\{active\} manager=\{manager\}/);
});
test('complementos têm biblioteca independente, fotos e seleção de produtos',()=>{
 assert.match(central,/pitacco_complement_templates/);
 assert.match(central,/pitacco_complement_template_save/);
 assert.match(central,/p_product_ids:draft\.assigned/);
 assert.match(central,/Editar aqui/);
 assert.match(central,/image_url/);
 assert.match(complements,/pitacco_set_option_photo/);
 assert.match(complements,/name="photo"/);
 assert.match(sql,/alter table public\.product_options add column if not exists image_url/);
 assert.match(sql,/library_template_id/);
 assert.match(publicMenu,/option-thumbnail/);
});
test('banners usam o estúdio e publicam a mesma versão do cardápio',()=>{
 assert.match(menu,/focus="banners"/);
 assert.match(design,/focus!=='banners'/);
 assert.match(design,/pitacco_storefront_save_publish/);
 assert.match(design,/Salvar e publicar/);
});
test('estoque e insumos usam tabelas reais com controles separados',()=>{
 assert.match(stock,/pitacco_finished_product_stock/);
 assert.match(stock,/onConflict:'store_id,product_id'/);
 assert.match(stock,/não desconta automaticamente pedidos já feitos/);
 assert.match(inventory,/pitacco_ingredients/);
 assert.match(inventory,/pitacco_recipe_lines/);
 assert.match(inventory,/pitacco_stock_movements/);
 assert.match(inventory,/initialView='Insumos'/);
});
test('proteger histórico e RLS de cada loja nos grupos compartilhados',()=>{
 assert.match(sql,/pitacco_private\.can_edit_catalog\(p_store\)/);
 assert.match(sql,/update public\.product_options set available=false/);
 assert.doesNotMatch(sql,/delete from public\.product_options/);
 assert.match(sql,/product_id=v_product and library_template_id=v_id/);
});
