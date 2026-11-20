import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');

test('merchant map includes authorized shared couriers and their positions',()=>{
 const source=read('revisions/0.12/web/FleetTracking.jsx');
 assert.match(source,/rpc\('pitacco_store_couriers',\s*\{p_store:\s*storeId\}\)/);
 assert.doesNotMatch(source,/from\('couriers'\)\.select\('id,name,active,available'\)\.eq\('store_id'/);
 assert.match(source,/from\('courier_positions'\)/);
 assert.match(source,/\.in\('courier_id', ids\)/);
 assert.match(source,/gpsStatus\(c, position\)/);
 assert.match(source,/10000/);
 assert.match(source,/body:\s*\{action:'store-origin',\s*store_id:storeId\}/);
 assert.match(source,/originStatus==='missing-address'/);
 assert.doesNotMatch(source,/Sem coordenadas para exibir/);
});
test('shop origin is centered and all currently online couriers are visible',()=>{
 const map=read('revisions/0.12/web/deliveryMap.mjs');
 assert.match(map,/export async function mountFleetMap/);
 assert.match(map,/fittedShop/);
 assert.match(map,/const shopBounds = \[point\(store\),\.\.\.visibleOnline\.map/);
 assert.match(map,/map\.fitBounds\(shopBounds/);
 assert.match(map,/map\.setView\(shopBounds\[0\], 16\)/);
 assert.match(map,/lastOnlineIds = onlineIds/);
});
test('store address form provides a draggable shop pin without coordinate fields',()=>{
 const form=read('revisions/0.12/web/StoreProfile.jsx');
 const map=read('revisions/0.12/web/deliveryMap.mjs');
 const css=read('revisions/0.12/web/store-profile-modern.css');
 assert.match(form,/<StorePointPicker client=\{client\}/);
 assert.match(form,/Localizar pelo endereço/);
 assert.match(form,/Salvar ponto da loja/);
 assert.match(form,/action:'store-point'/);
 assert.match(form,/action:'store-origin'/);
 assert.match(form,/rpc\('pitacco_update_store_identity'/);
 assert.match(form,/addressDirty/);
 assert.match(map,/export async function mountStorePointPicker/);
 assert.match(map,/draggable:true/);
 assert.match(map,/marker\.on\('dragend'/);
 assert.match(css,/\.store-point-map/);
 assert.doesNotMatch(form,/<input[^>]+(?:latitude|longitude)/i);
});
test('store location backend checks store membership before writes',()=>{
 const edge=read('supabase/functions/delivery-quote/index.ts');
 const migration=read('supabase/migrations/20261120120000_invalidate_store_pin_on_address_update.sql');
 assert.match(edge,/body\.action==='store-origin'\|\|body\.action==='store-point'/);
 assert.match(edge,/db\.auth\.getUser\(token\)/);
 assert.match(edge,/pitacco_can_manage_courier_store/);
 assert.match(edge,/allowed!==true/);
 assert.match(edge,/p_scope:'store-map-point-hour-'/);
 assert.match(edge,/typeof lat!=='number'/);
 assert.match(edge,/action==='store-point'/);
 assert.match(migration,/is distinct from/);
 assert.match(migration,/new\.latitude := null/);
 assert.match(migration,/new\.longitude := null/);
});
