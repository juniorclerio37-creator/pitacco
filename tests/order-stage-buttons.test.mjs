import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {columns,orderStage} from '../updates/0.11.1/web/orderBoard.mjs';

const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
const own=(status,preparation_status)=>({status,preparation_status,source:'proprio',receipt:{logistics:'loja'}});

test('five operational stages progress in order without jumping delivery',()=>{
 assert.deepEqual(columns.map(([id])=>id),['analysis','preparing','ready','delivery']);
 assert.equal(columns[0][1],'Novo');
 assert.equal(orderStage(own('pending','preparing'),null),'analysis');
 assert.equal(orderStage(own('accepted','preparing'),null),'preparing');
 assert.equal(orderStage(own('accepted','ready'),{status:'pendente'}),'ready');
 assert.equal(orderStage(own('accepted','ready'),{status:'atribuida'}),'ready');
 assert.equal(orderStage(own('accepted','ready'),{status:'retirada'}),'delivery');
 assert.equal(orderStage(own('accepted','ready'),{status:'entregue'}),'completed');
 assert.equal(orderStage(own('accepted','completed'),null),'completed');
});

test('site and Windows provide stage-specific actions without early dispatch',()=>{
 const site=read('revisions/0.12/web/Pedidos.jsx');
 const win=read('revisions/0.12/web/Operations.jsx');
 const dialog=read('revisions/0.12/web/DeliveryDialog.jsx');
 const mount=read('revisions/0.12/mount_orders_045.py');
 for(const label of ['Marcar pedido pronto','Selecionar entregador','Confirmar retirada','Acompanhar entrega']){
  assert.ok(site.includes(label),'missing site '+label);
  assert.ok(win.includes(label),'missing Windows '+label);
 }
 assert.match(site,/order\.preparation_status==='ready'&&delivery\?\.logistics_provider==='loja'/);
 assert.match(dialog,/prepared&&delivery\?\.logistics_provider==='loja'/);
 assert.match(dialog,/Confirmar despacho/);
 assert.match(mount,/onPickup=\{id=>act\(\(\)=>rpc\('set_order_preparation'/);
 assert.doesNotMatch(site,/>Despachar<\/button>/);
});

test('server enforces ready state for assignment and local completion only for own pickup',()=>{
 const migration=read('supabase/migrations/20261118194500_order_stage_progression_and_dispatch_gate.sql');
 assert.match(migration,/o\.status='accepted'/);
 assert.match(migration,/o\.preparation_status='ready'/);
 assert.match(migration,/FOR SHARE|for share/);
 assert.match(migration,/o\.source='proprio'/);
 assert.match(migration,/o\.receipt->>'logistics'='retirada'/);
 assert.match(migration,/Marque o pedido como pronto/);
});
