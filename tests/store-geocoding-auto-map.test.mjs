import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {shopPoint,edgeErrorMessage,locateStoreByAddress} from '../revisions/0.12/web/mapOrigin.mjs';
const read=(path)=>readFileSync(new URL('../'+path,import.meta.url),'utf8');

test('shop map accepts saved coordinates only, never guesses missing fields',()=>{
 assert.deepEqual(shopPoint({latitude:-22.75,longitude:-43.47}),[-22.75,-43.47]);
 assert.equal(shopPoint({latitude:null,longitude:null}),null);
 assert.equal(shopPoint({latitude:'abc',longitude:0}),null);
});
test('shop location request passes the selected store and reports estimated point',async()=>{
 const invocations=[];
 const client={functions:{invoke:async(name,args)=>{
  invocations.push({name,args});
  return {data:{latitude:-22.765,longitude:-43.49,approximate:true},error:null};
 }}};
 const value=await locateStoreByAddress(client,'1481c0c6-5b87-4737-9d1a-96ae5c1615d9');
 assert.deepEqual(value,{point:[-22.765,-43.49],approximate:true});
 assert.deepEqual(invocations,[{name:'delivery-quote',args:{body:{
  action:'store-origin',store_id:'1481c0c6-5b87-4737-9d1a-96ae5c1615d9'
 }}}]);
});
test('non-2xx Supabase FunctionsHttpError surfaces readable server error',async()=>{
 const error={message:'Edge Function returned a non-2xx status code',
  context:{json:async()=>({error:'Endereço não localizado. Confira os dados.'})}};
 assert.equal(await edgeErrorMessage(error),'Endereço não localizado. Confira os dados.');
 const client={functions:{invoke:async()=>({data:null,error})}};
 await assert.rejects(()=>locateStoreByAddress(client,'fake'),/Endereço não localizado/);
});
test('profile automatically resolves address and still allows manual shop-pin correction',()=>{
 const profile=read('revisions/0.12/web/StoreProfile.jsx');
 assert.match(profile,/automaticLookup=useRef/);
 assert.match(profile,/void locate\(\{automatic:true\}\)/);
 assert.match(profile,/locateStoreByAddress\(client,store.id\)/);
 assert.match(profile,/Salvar ponto da loja/);
 assert.match(profile,/mountStorePointPicker/);
 assert.doesNotMatch(profile,/<input[^>]+(?:latitude|longitude)/i);
});
test('delivery area map always renders and polygon/circle inputs remain available before geocoding',()=>{
 const areas=read('revisions/0.12/web/StorefrontSettings.jsx');
 const map=read('revisions/0.12/web/deliveryMap.mjs');
 assert.match(areas,/locateStoreByAddress\(client,store.id\)/);
 assert.match(areas,/automaticPoint\?\.storeId===store.id\?automaticPoint.point:null/);
 assert.match(areas,/fieldset disabled=\{busy\}/);
 assert.match(areas,/<div ref=\{container\} className="storefront-map delivery-zone-map"/);
 assert.doesNotMatch(areas,/\{origin&&<div ref=\{container\}/);
 assert.match(areas,/setMode\('polygon'\)/);
 assert.match(areas,/setMode\('circle'\)/);
 assert.match(map,/if\(hasOrigin\)L.marker\(point/);
 assert.match(map,/if\(hasOrigin\)\{/);
 assert.match(map,/pitacco-polygon-handle/);
 assert.match(map,/draggable:true/);
});
test('Google key optional for shop origin only; fallback is throttled and address-scoped',()=>{
 const edge=read('supabase/functions/delivery-quote/index.ts');
 assert.match(edge,/pitacco-osm-geocode-global-minute/);
 assert.match(edge,/p_max:1,p_minutes:1/);
 assert.match(edge,/User-Agent':'Pitacco-delivery\/1\.0/);
 assert.match(edge,/nominatim\.openstreetmap\.org\/search/);
 assert.match(edge,/latitude:Number\(location.lat.toFixed\(6\)\)/);
 assert.match(edge,/approximate:Boolean\(location.approximate\)/);
 assert.doesNotMatch(edge,/if\(!key\)return problem\(503,'A localização automática/);
});
