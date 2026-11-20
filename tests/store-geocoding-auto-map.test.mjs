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
 assert.match(areas,/automaticPoint\?\.storeId===store.id&&\!automaticPoint.approximate\?automaticPoint.point:null/);
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
 assert.match(edge,/p_max:12,p_minutes:1/);
 assert.match(edge,/pitacco_service_nominatim_second_slot/);
 assert.match(edge,/store\.postal_code,'Brasil'/);
 assert.match(edge,/User-Agent':'Pitacco-delivery\/1\.0/);
 assert.match(edge,/nominatim\.openstreetmap\.org\/search/);
 assert.match(edge,/latitude:Number\(location.lat.toFixed\(6\)\)/);
 assert.match(edge,/approximate:Boolean\(location.approximate\)/);
 assert.doesNotMatch(edge,/if\(!key\)return problem\(503,'A localização automática/);
});

test('the shop marker is a consistent illustrated storefront (no emoji marker)',()=>{
 const map=read('revisions/0.12/web/deliveryMap.mjs');
 assert.match(map,/export function illustratedShopIcon\(L\)/);
 assert.match(map,/<svg[^>]+viewBox="0 0 58 68"/);
 assert.match(map,/const icon=illustratedShopIcon\(L\)/);
 assert.match(map,/const shopIcon=illustratedShopIcon\(L\)/);
 assert.match(map,/if\(kind==='store'\)return illustratedShopIcon\(L\)/);
 assert.doesNotMatch(map,/html:'<span aria-hidden="true">🏪<\/span>'/);
});

test('deduplicates concurrent merchant origin requests',async()=>{
 let release;
 const waiting=new Promise(resolve=>{release=resolve;});
 let requests=0;
 const client={functions:{invoke:async()=>{
  requests++;
  await waiting;
  return {data:{latitude:-22.74,longitude:-43.47,approximate:true},error:null};
 }}};
 const a=locateStoreByAddress(client,'same-store');
 const b=locateStoreByAddress(client,'same-store');
 release();
 assert.deepEqual(await a,await b);
 assert.equal(requests,1);
 await locateStoreByAddress(client,'same-store');
 assert.equal(requests,2);
});

test('street and postal code patterns are real regex tokens, not literal backslashes',()=>{
 const edge=read('supabase/functions/delivery-quote/index.ts');
 assert.ok(edge.includes(String.raw`/^(rua|r\.?|avenida|av\.?|travessa|tv\.?)\s+/`));
 assert.ok(edge.includes(String.raw`replace(/\D/g,'')`));
 assert.ok(!edge.includes(String.raw`replace(/\\D/g,'')`));
});
test('approximate map coordinates require merchant approval before use as freight origin',()=>{
 const edge=read('supabase/functions/delivery-quote/index.ts');
 const profile=read('revisions/0.12/web/StoreProfile.jsx');
 assert.match(edge,/if\(location\.approximate\)\{/);
 assert.match(edge,/requires_confirmation:true/);
 assert.match(profile,/Usar localização do celular ou computador/);
 assert.match(profile,/setSuggestedPoint\(p\)/);
 assert.match(profile,/currentDeviceLocation\(\)/);
});

test('Geoapify runs only with its server-side key and rejects unclear coordinates',()=>{
 const edge=read('supabase/functions/delivery-quote/index.ts');
 assert.match(edge,/Deno\.env\.get\('PITACCO_GEOAPIFY_API_KEY'\)/);
 assert.match(edge,/api\.geoapify\.com\/v1\/geocode\/search/);
 assert.match(edge,/if\(geoapifyKey\)\{/);
 assert.match(edge,/sameRoad\(item.street,store.address\)/);
 assert.match(edge,/samePostal\(item.postcode,store.postal_code\)/);
 assert.match(edge,/\['building','amenity','house'\]\.includes\(type\)/);
 assert.match(edge,/requires_confirmation:true,provider/);
 assert.doesNotMatch(edge,/await geocode\(address,key\)/);
});
test('device location stays available on both phone and computer with accuracy validation',()=>{
 const map=read('revisions/0.12/web/deliveryMap.mjs');
 const profile=read('revisions/0.12/web/StoreProfile.jsx');
 const areas=read('revisions/0.12/web/StorefrontSettings.jsx');
 assert.match(map,/export function currentDeviceLocation\(\)/);
 assert.match(map,/navigator\.geolocation\.getCurrentPosition/);
 assert.match(map,/accuracyMeters/);
 assert.match(profile,/Usar localização do celular ou computador/);
 assert.match(profile,/if\(needsDeviceAdjustment\)throw Error/);
 assert.match(profile,/setNeedsDeviceAdjustment\(false\)/);
 assert.match(areas,/!automaticPoint\.approximate/);
});
