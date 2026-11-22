import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const read=path=>readFileSync(new URL("../"+path,import.meta.url),"utf8");

test("Pitacco mobile shell has exactly four functional navigation views",()=>{
 const html=read("entregador/painel.html");
 const tabs=[...html.matchAll(/data-tab="(pedidos|ganhos|perfil|config)"/g)].map(m=>m[1]);
 const views=[...html.matchAll(/data-view="(pedidos|ganhos|perfil|config)"/g)].map(m=>m[1]);
 assert.deepEqual(tabs,["pedidos","ganhos","perfil","config"]);
 assert.deepEqual(views,["pedidos","ganhos","perfil","config"]);
 assert.match(html,/class="bottom-nav"/);
 assert.match(html,/switchView\(b\.dataset\.tab\)/);
 assert.match(html,/\.app-view/);
 assert.match(html,/href="\.\/painel\.css"/);
 const css=read("entregador/painel.css");
 assert.match(css,/padding:[^;]*env\(safe-area-inset-bottom\)/);
 assert.match(css,/\.bottom-nav/);
 assert.match(css,/@media\(max-width:440px\)/);
});

test("courier's earnings drilldown is backed by stored completed deliveries",()=>{
 const html=read("entregador/painel.html");
 const sql=read("docs/sql/driver-earnings-dashboard.sql");
 assert.match(html,/id="earnDailyRows"/);
 assert.match(html,/id="earnWorkedDays"/);
 assert.match(html,/id="earnSelectedAmount"/);
 assert.match(html,/day_breakdown/);
 assert.match(html,/worked_days/);
 assert.match(html,/pitacco_driver_earnings/);
 assert.match(sql,/'day_breakdown'/);
 assert.match(sql,/'worked_days'/);
 assert.match(sql,/d\.courier_payment as valor/);
 assert.match(sql,/d\.status = 'entregue'/);
 assert.match(sql,/security definer/);
});

test("navigation uses Google Maps or Waze and never auto-accepts a delivery",()=>{
 const html=read("entregador/painel.html");
 const client=read("entregador/supabase-client.mjs");
 const navigation=read("entregador/navigation.mjs");
 assert.match(navigation,/google\.com\/maps\/dir/);
 assert.match(navigation,/waze\.com\/ul/);
 assert.match(html,/route\.href=routeUrl/);
 assert.match(html,/localStorage\.setItem\("pitacco:driver:navigator"/);
 assert.match(navigation,/mode === 'coords'/);
 assert.match(client,/batch_id,latitude,longitude/);
 assert.match(html,/pitacco_driver_collect/);
 assert.match(html,/pitacco_driver_depart/);
 assert.doesNotMatch(html,/pitacco_driver_accept|set_delivery_status/);
});

test("store name is only returned after authentication of the courier",()=>{
 const edge=read("supabase/functions/pitacco-courier-access/index.ts");
 const html=read("entregador/painel.html");
 assert.match(edge,/if \(!courier \|\| !courier\.active\)/);
 assert.match(edge,/\.eq\("id",courier\.store_id\)/);
 assert.match(edge,/storeName:store\?\.name/);
 assert.match(html,/status\?\.courier\?\.storeName/);
});

test("no duplicate Maps tab or navigation settings inside profile",()=>{
 const html=read("entregador/painel.html");
 assert.doesNotMatch(html,/data-tab="mapa"|data-view="mapa"|id="viewMapa"/);
 assert.doesNotMatch(html,/id="profileMapChange"|id="profileNav"|id="mapPreference"/);
 assert.doesNotMatch(html,/renderRoutes\(|routesList/);
 assert.match(html,/data-tab="pedidos"/);
 assert.match(html,/data-tab="ganhos"/);
 assert.match(html,/data-tab="perfil"/);
 assert.match(html,/data-tab="config"/);
 assert.match(html,/buildNavigationUrl\(d,navProvider,navMode\)/);
 assert.match(html,/data-nav-choice="google"/);
 assert.match(html,/data-nav-choice="waze"/);
 assert.match(html,/data-tab="rotas"/);
 assert.match(html,/const validViews=\["pedidos","rotas","ganhos","perfil","config"\]/);
});
