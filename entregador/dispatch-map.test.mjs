import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {pointOf,freshGps} from './dispatch-map.mjs';
const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');

test('GPS and destination coordinates never accept missing or invalid points',()=>{
 assert.deepEqual(pointOf(-22.700497,-43.411763),[-22.700497,-43.411763]);
 assert.deepEqual(pointOf('-22.7','-43.4'),[-22.7,-43.4]);
 for(const pair of [[null,-43.4],['',-43.4],[0,0],[95,-43.4],[-22,190],['x',-43.4]]){
  assert.equal(pointOf(...pair),null,JSON.stringify(pair));
 }
});
test('only fresh and reasonably accurate OWN GPS is plotted',()=>{
 const now=Date.now();
 const good={latitude:-22.70,longitude:-43.41,accuracy_m:18,
  observed_at:new Date(now-1000).toISOString()};
 assert.equal(freshGps(good,now),true);
 assert.equal(freshGps({...good,accuracy_m:3000},now),false);
 assert.equal(freshGps({...good,observed_at:new Date(now-180000).toISOString()},now),false);
 assert.equal(freshGps({...good,latitude:null},now),false);
});
test('courier and merchant use the SAME orange storefront SVG and OSM base',()=>{
 const merchant=read('revisions/0.12/web/deliveryMap.mjs');
 const courier=read('entregador/dispatch-map.mjs');
 const marker=merchant.match(/const html = \`([\s\S]*?)\`;/);
 assert.ok(marker,'merchant illustration should exist');
 assert.ok(courier.includes(JSON.stringify(marker[1])),'no independent/different shop drawing');
 assert.match(merchant,/tile\.openstreetmap\.org/);
 assert.match(courier,/tile\.openstreetmap\.org/);
 assert.match(courier,/mountCourierSharedMap/);
 assert.match(courier,/courier-map-moto/);
 assert.match(courier,/courier-map-destination/);
});
test('map is in the new Routes tab, not the Pedidos home, and preserves operations',()=>{
 const page=read('entregador/painel.html');
 const css=read('entregador/painel.css');
 const auth=read('entregador/supabase-client.mjs');
 assert.match(page,/import \{mountCourierSharedMap,freshGps\} from "\.\/dispatch-map\.mjs"/);
 const home=page.slice(page.indexOf('id="viewPedidos"'),page.indexOf('id="viewRotas"'));
 const routes=page.slice(page.indexOf('id="viewRotas"'),page.indexOf('id="viewGanhos"'));
 assert.doesNotMatch(home,/id="courierMap"/);
 assert.match(routes,/id="courierMap"/);
 assert.match(page,/data-tab="rotas"/);
 assert.match(page,/id="courierMapGps"/);
 assert.match(page,/id="courierMapAll"/);
 assert.match(page,/sb\.rpc\("pitacco_driver_route_origins"\)/);
 assert.match(page,/sb\.from\('courier_positions'\)/);
 assert.match(page,/assignedDeliveries=current/);
 assert.match(page,/courierMapStatus\(\)/);
 assert.match(css,/\.courier-shared-map-canvas/);
 assert.match(auth,/\.in\('courier_id', courierIds\)/);
 assert.match(page,/pitacco_driver_collect/);
 assert.match(page,/pitacco_driver_depart/);
 assert.match(page,/PitaccoPush/);
});
test('authorized storefront origins never expose other shops',()=>{
 const sql=read('supabase/migrations/20261121002800_driver_map_authorized_stores_even_when_idle.sql');
 assert.match(sql,/c\.user_id=\(select auth\.uid\(\)\)/);
 assert.match(sql,/c\.store_id=s\.id or/);
 assert.match(sql,/public\.pitacco_courier_test_access\(c\.id,s\.id\)/);
 assert.match(sql,/pitacco_courier_session_ready\(\)/);
 assert.match(sql,/revoke all on function public\.pitacco_driver_route_origins/);
});

test('the rider has one orange illustrated motorcycle in courier, merchant and customer map',()=>{
 const merchant=read('revisions/0.12/web/deliveryMap.mjs');
 const courier=read('entregador/dispatch-map.mjs');
 const courierStyles=read('entregador/painel.css');
 const fleetStyles=read('revisions/0.12/web/fleet-tracking.css');
 const customer=read('marketing/acompanhar.html');
 const svg=merchant.match(/export const PITACCO_COURIER_SVG = \`([\s\S]*?)\`;/);
 assert.ok(svg,'illustrated courier artwork exists');
 assert.match(svg[1],/width="72" height="70"/);
 assert.match(svg[1],/fill="#ea580c"/);
 assert.match(svg[1],/fill="#29364a"/);
 assert.doesNotMatch(svg[1],/M36 2C18 2 3 16 3 34/,"balloon-shaped background cannot return");
 assert.match(svg[1],/ellipse cx="36" cy="64"/,"floating motorcycle shadow");
 assert.ok(courier.includes(JSON.stringify(svg[1])),'mobile and merchant SVG artwork must match exactly');
 assert.match(courier,/html:PITACCO_COURIER_SVG/);
 assert.match(merchant,/return illustratedCourierIcon\(L,\{stale:kind==='stale',selected:active\}\)/);
 assert.match(merchant,/illustratedCourierIcon\(L,\{customer:true\}\)/);
 assert.match(merchant,/iconAnchor:\[36,61\]/);
 assert.match(courier,/iconAnchor:\[36,61\]/);
 assert.match(courier,/zIndexOffset:2000/);
 assert.match(fleetStyles,/\.pitacco-courier-moto-stale svg/);
 assert.match(courierStyles,/\.courier-map-moto svg/);
 assert.match(customer,/\.pitacco-courier-moto-pin svg/);
 assert.doesNotMatch(courier,/html:'<span aria-hidden="true">🛵<\/span>'/);
});
test('public rider map remains scoped to own order tracking and rounds coordinates',()=>{
 const publicPage=read('marketing/acompanhar.html');
 const sharedMap=read('revisions/0.12/web/deliveryMap.mjs');
 assert.match(publicPage,/pitacco_track_public_order/);
 assert.match(publicPage,/new URLSearchParams\(location\.search\)\.get\('token'\)/);
 assert.match(sharedMap,/export async function mountCustomerTrackingMap/);
 assert.match(sharedMap,/Use ONLY the coordinates from pitacco_track_public_order/);
 assert.doesNotMatch(publicPage,/from\('courier_positions'\)/);
});
