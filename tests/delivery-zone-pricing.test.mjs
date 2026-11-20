import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {directDistance,finiteBrazil,polygonValid,withinPolygon} from '../supabase/functions/delivery-quote/coverage-geometry.mjs';

const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const square=[
 [-22.920,-43.450],
 [-22.920,-43.440],
 [-22.910,-43.440],
 [-22.910,-43.450]
];

test('straight-line radius meters are measured from store location',()=>{
 assert.equal(directDistance([-22.92,-43.45],[-22.92,-43.45]),0);
 const nearby=directDistance([-22.92,-43.45],[-22.915,-43.45]);
 assert.ok(nearby>500&&nearby<620, 'a .005 latitude separation is about 556m');
 assert.equal(finiteBrazil(-22.92,-43.45),true);
 assert.equal(finiteBrazil(48.85,2.35),false);
 assert.equal(finiteBrazil(NaN,-43.45),false);
});
test('polygon includes internal points and its boundary, but excludes outside',()=>{
 assert.equal(polygonValid(square),true);
 assert.equal(withinPolygon([-22.915,-43.445],square),true);
 assert.equal(withinPolygon([-22.915,-43.450],square),true);
 assert.equal(withinPolygon([-22.9,-43.445],square),false);
});
test('polygons crossing themselves, degenerate, too many or foreign coordinates are rejected',()=>{
 assert.equal(polygonValid([square[0],square[2],square[1],square[3]]),false);
 assert.equal(polygonValid([[0,0],[0,0],[0,0]]),false);
 assert.equal(polygonValid([square[0],square[1]]),false);
 assert.equal(polygonValid(Array(31).fill(square[0])),false);
 assert.equal(polygonValid([[44,2],[44,3],[45,3]]),false);
});
test('fees are configured exclusively inside delivery area, not Payment or onboarding',()=>{
 const settings=read('revisions/0.12/web/StorefrontSettings.jsx');
 const setup=read('marketing/configuracao.html');
 assert.doesNotMatch(settings,/<label>Taxa de entrega \(R\$\)/);
 assert.match(settings,/p_delivery_fee:0/);
 assert.match(settings,/pitacco_save_delivery_zone/);
 assert.match(settings,/mode==='circle'/);
 assert.match(settings,/mode==='polygon'/);
 assert.match(settings,/Salvar e ativar área de entrega/);
 assert.match(setup,/p_delivery_fee:0/);
 assert.doesNotMatch(setup,/id="fee"/);
});
test('merchant config shares pinned store origin and visual coverage with customer map',()=>{
 const settings=read('revisions/0.12/web/StorefrontSettings.jsx');
 const map=read('revisions/0.12/web/deliveryMap.mjs');
 assert.match(settings,/mountDeliveryCoverageMap/);
 assert.match(settings,/shopPoint\(store\)/);
 assert.match(settings,/locateStoreByAddress\(client,store.id\)/);
 assert.match(read('revisions/0.12/web/mapOrigin.mjs'),/longitude/);
 assert.match(settings,/onVerticesChange/);
 assert.match(map,/export async function mountDeliveryCoverageMap/);
 assert.match(map,/L\.circle\(point/);
 assert.match(map,/L\.polygon\(polygon/);
 assert.match(map,/draggable:true/);
 assert.match(map,/export async function mountDeliveryMap/);
 assert.match(map,/mode==='polygon'/);
});
test('server calculates delivery fee using authorized shape and saves destination',()=>{
 const edge=read('supabase/functions/delivery-quote/index.ts');
 const menu=read('marketing/cardapio.html');
 const base=read('supabase/migrations/20261120143000_visual_delivery_zone_pricing.sql');
 const publicMenu=read('supabase/migrations/20261120143500_checkout_delivery_quote_and_public_menu.sql');
 assert.match(edge,/withinPolygon\(to,polygon\)/);
 assert.match(edge,/directDistance\(from,to\)/);
 assert.match(edge,/rules\.distance_fees\?\.\[bracket-1\]/);
 assert.match(edge,/destination_latitude:Number\(to\[0\]/);
 assert.match(edge,/distance_type:mode==='road'\?'road':'straight'/);
 assert.match(menu,/quotePoint=needsPoint/);
 assert.match(menu,/routeQuoteStatus/);
 assert.match(menu,/menu\.store\.route_pricing\?\.mode/);
 assert.doesNotMatch(menu,/Number\(menu\.store\.delivery_fee\)/);
 assert.match(base,/not found or not rules\.enabled then/);
 assert.doesNotMatch(base,/then return p_fallback/);
 assert.match(publicMenu,/pitacco_delivery_quote_point/);
 assert.match(publicMenu,/pitacco\.checkout_delivery_point/);
 assert.match(publicMenu,/route_pricing/);
});
