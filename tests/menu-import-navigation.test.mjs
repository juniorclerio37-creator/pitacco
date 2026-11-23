import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const studio=readFileSync(new URL('../revisions/0.12/web/MenuStudio.jsx',import.meta.url),'utf8');
const route=readFileSync(new URL('../revisions/0.12/mount_universal_menu_import.py',import.meta.url),'utf8');
const importer=readFileSync(new URL('../revisions/0.12/web/UniversalMenuImporter.jsx',import.meta.url),'utf8');

test('botão antigo é substituído pelo acesso único ao importador',()=>{
 assert.doesNotMatch(studio,/Importar do iFood/);
 assert.doesNotMatch(studio,/Importação direta do iFood aguardando/);
 assert.match(studio,/onClick=\{onImport\}>Importar cardápio/);
 assert.match(route,/onImport=\{\(\)=>setTab\('Importar cardápio'\)\}/);
});

test('Importar cardápio deve estar no submenu visível de Meu Cardápio',()=>{
 assert.match(route,/submenu_old="'Meu Cardápio':\[\['Produtos','Editor de cardápio'\]\]"/);
 assert.match(route,/submenu_new="'Meu Cardápio':\[\['Produtos','Editor de cardápio'\],\['Importar cardápio','Importar cardápio'\]\]"/);
 assert.match(route,/\{tab==='Importar cardápio'&&active/);
});

test('uma única página recebe links públicos e arquivos, sem exibir marcas',()=>{
 assert.match(importer,/Link do cardápio digital/);
 assert.match(importer,/Analisar cardápio/);
 assert.match(importer,/CSV, JSON ou ZIP/);
 assert.match(importer,/pitacco_menu_import_apply/);
 assert.doesNotMatch(importer,/Brendi|brendi|Importar do iFood/i);
});
