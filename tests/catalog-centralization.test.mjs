import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const migration=readFileSync(new URL('../supabase/migrations/20261124001000_linho_test_centralize_complements.sql',import.meta.url),'utf8');
const ui=readFileSync(new URL('../revisions/0.12/web/CentralComplementLibrary.jsx',import.meta.url),'utf8');

test('consolidação usa loja específica e agrupa somente configurações equivalentes',()=>{
 assert.match(migration,/1481c0c6-5b87-4737-9d1a-96ae5c1615d9/);
 assert.match(migration,/v_variants<>18/);
 assert.match(migration,/options_signature/);
 assert.match(migration,/min_select=v_variant\.min_select/);
 assert.match(migration,/max_select=v_variant\.max_select/);
 assert.match(migration,/options_signature=v_variant\.options_signature/);
});

test('migração preserva IDs e opções originais e executa conferência do cardápio público',()=>{
 assert.match(migration,/menu_centralization_backups/);
 assert.match(migration,/v_saved_groups<>142/);
 assert.match(migration,/v_saved_options<>1216/);
 assert.match(migration,/v_before_detail is distinct from v_after_detail/);
 assert.match(migration,/v_before_menu is distinct from public\.get_public_menu/);
 assert.doesNotMatch(migration,/delete from public\.product_option_groups|delete from public\.product_options|truncate\s+public\./i);
});

test('diferencia nomes iguais em variações sem modificar o nome visível ao consumidor',()=>{
 assert.match(ui,/const variants=templates\.filter\(group=>group\.name===t\.name\)/);
 assert.match(ui,/Variação/);
 assert.match(ui,/linkedProducts/);
 assert.match(ui,/option\.price/);
 assert.match(ui,/onClick=\{\(\)=>openTemplate\(t\)\}/);
});
