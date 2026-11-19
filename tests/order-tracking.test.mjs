import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const html=readFileSync(new URL('../marketing/acompanhar.html',import.meta.url),'utf8');
test('tracking token requires canonical UUID format',()=>{
 assert.match(html,/\^\[0-9a-f\]\{8\}-\[0-9a-f\]\{4\}/);
 assert.match(html,/Link de acompanhamento inválido/);
});
test('rejected and cancelled orders do not show progress timeline',()=>{
 assert.match(html,/rejected=\['rejected','recusado','recusada'\]/);
 assert.match(html,/if\(!cancelled\)\{for\(let i=0;i<labels\.length/);
 assert.match(html,/Pedido recusado/);
 assert.match(html,/Pedido cancelado/);
});
test('pickup completed only after explicit collection',()=>{
 assert.match(html,/const collected=prep==='completed'/);
 assert.match(html,/current=collected\?4:/);
});
test('tracking refresh avoids overlapping requests and has a timer',()=>{
 assert.match(html,/if\(working\)return;working=true/);
 assert.match(html,/finally\{working=false\}/);
 assert.match(html,/setInterval\(refresh,15000\)/);
});
test('notification feature is guarded by browser support',()=>{
 assert.match(html,/'Notification'in window/);
 assert.match(html,/'serviceWorker'in navigator/);
});


const mapModule=readFileSync(new URL('../revisions/0.12/web/deliveryMap.mjs',import.meta.url),'utf8');
const nativeGps=readFileSync(new URL('../entregador/android-app/app/src/main/java/br/com/pitacco/entregador/CourierLocationService.java',import.meta.url),'utf8');
const privacySql=readFileSync(new URL('../supabase/migrations/20261114234147_pitacco_private_delivery_tracking.sql',import.meta.url),'utf8');
test('courier app, merchant and customer share one GPS backend without a public courier list',()=>{
 assert.match(nativeGps,/rpc\/pitacco_courier_background_gps_update/);
 assert.match(privacySql,/public\.courier_positions gps/);
 assert.match(privacySql,/delivery\.order_id=p_order/);
 assert.match(privacySql,/delivery\.status='retirada'/);
 assert.match(privacySql,/multiple_stops/);
 assert.match(privacySql,/round\(gps\.latitude::numeric,3\)/);
 assert.match(html,/client\.rpc\('pitacco_track_public_order',\{p_token:token\}\)/);
 assert.doesNotMatch(html,/\.from\(['"]courier_positions['"]\)/);
});
test('customer tracking mounts the same Leaflet module as the merchant and hides stale positions',()=>{
 assert.match(mapModule,/export async function mountCustomerTrackingMap\(container\)/);
 assert.match(mapModule,/L\.tileLayer\('https:\/\/tile\.openstreetmap\.org/);
 assert.match(html,/import\('\/assets\/delivery-map\.mjs'\)/);
 assert.match(html,/id="courierLiveMap"/);
 assert.match(html,/Date\.now\(\)-lastTime<=90000/);
 assert.match(html,/showCourierMap\(null\)/);
 assert.match(html,/position\?\.state==='multiple_stops'/);
 assert.match(html,/renderLocation\(d\.courier_position\)/);
 assert.match(html,/if\(document\.visibilityState==='visible'\)/);
});
