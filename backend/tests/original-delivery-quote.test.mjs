// Runs the existing Edge handler unchanged in a VM with disposable dependencies.
// Never contacts Supabase, a real routing provider or an external address.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {stripTypeScriptTypes} from 'node:module';
import {runInNewContext} from 'node:vm';
import * as geometry from '../../supabase/functions/delivery-quote/coverage-geometry.mjs';

const source=readFileSync(new URL('../../supabase/functions/delivery-quote/index.ts',import.meta.url),'utf8');
const code=stripTypeScriptTypes(source.replace(/^import .*;\r?\n/gm,''),{mode:'strip'});
const storeId='71000000-0000-4000-8000-000000000001';
const requestId='71000000-0000-4000-8000-000000000002';
const quoteId='71000000-0000-4000-8000-000000000003';
const base={slug:'fixture-store',address:'Rua Teste, 10, Centro, Cidade, RJ',request_id:requestId,latitude:-22.915,longitude:-43.45};
const origin='https://pitacco.com.br';
const eta={min_minutes:40,max_minutes:60,priority:{enabled:true,fee:9,min_minutes:20,max_minutes:30}};
function setup(options={}){
 const inserts=[],calls=[];
 let handler;
 const store={latitude:-22.92,longitude:-43.45,address:'Rua Fixture',city:'Cidade',state:'RJ'};
 const rules={enabled:true,coverage_type:'circle',max_radius_km:1,distance_fees:[5],distance_times:[eta],updated_at:'2026-01-01T00:00:00Z',...options.rules};
 const rows={public_menu_settings:{store_id:storeId,enabled:true,delivery_enabled:true,...options.menu},pitacco_delivery_pricing:rules,stores:{...store,...options.store}};
 const db={
  from(table){
   const q={
    select(){return q;},eq(){return q;},
    maybeSingle:async()=>({data:rows[table]??null,error:null}),
    single:async()=>({data:table==='pitacco_delivery_route_quotes'?{id:quoteId}:rows[table],error:null}),
    insert(value){assert.equal(table,'pitacco_delivery_route_quotes');inserts.push(value);return q;}
   };
   return q;
  },
  rpc:async(name,args)=>{
   calls.push({name,args});
   if(name==='pitacco_service_delivery_quote_limit')return {data:!options.limited,error:null};
   if(name==='pitacco_can_manage_courier_store')return {data:options.manager===true,error:null};
   throw Error('Unexpected RPC: '+name);
  },
  auth:{getUser:async()=>({data:{user:{id:'fixture-manager'}},error:null})}
 };
 const context={...geometry,createClient:()=>db,
  Deno:{serve:fn=>{handler=fn;},env:{get:key=>({SUPABASE_URL:'https://fixture.invalid',SUPABASE_SERVICE_ROLE_KEY:'fixture-only-secret'})[key]}},
  Request,Response,URL,TextEncoder,crypto,console,fetch:async()=>{throw Error('External network is disabled in this test');}};
 runInNewContext(code,context,{filename:'original-delivery-quote.js'});
 assert.equal(typeof handler,'function');
 const call=async(body=base,headers={})=>{
  const response=await handler(new Request('https://fixture.invalid/delivery-quote',{method:'POST',headers:{origin,'Content-Type':'application/json',...headers},body:JSON.stringify(body)}));
  return {status:response.status,body:await response.json(),cache:response.headers.get('Cache-Control')};
 };
 return {call,inserts,calls};
}
test('original circle service computes fee and ETA, stores the bound quote and expiry',async()=>{
 const x=setup();
 const res=await x.call();
 assert.equal(res.status,200);
 assert.equal(res.cache,'no-store');
 assert.equal(res.body.fee,5);
 assert.equal(res.body.delivery_min_minutes,40);
 assert.equal(res.body.delivery_max_minutes,60);
 assert.equal(res.body.delivery_options.priority.fee,9);
 assert.equal(res.body.request_id,requestId);
 assert.equal(res.body.quote_id,quoteId);
 assert.ok(res.body.distance_m>500&&res.body.distance_m<620);
 assert.equal(x.inserts.length,1);
 const q=x.inserts[0];
 assert.equal(q.store_id,storeId);
 assert.equal(q.request_id,requestId);
 assert.equal(q.destination_address,base.address);
 assert.equal(q.pricing_updated_at,'2026-01-01T00:00:00Z');
 assert.equal(q.address_point_selected,true);
 assert.ok(Date.parse(q.expires_at)>Date.now()&&Date.parse(q.expires_at)<=Date.now()+301000);
 assert.equal(x.calls.filter(c=>c.name==='pitacco_service_delivery_quote_limit').length,2);
});
test('priority uses original additional fee and shorter delivery time',async()=>{
 const x=setup();
 const r=await x.call({...base,delivery_service:'priority'});
 assert.equal(r.status,200);
 assert.equal(r.body.fee,9);
 assert.equal(r.body.delivery_min_minutes,20);
 assert.equal(r.body.delivery_max_minutes,30);
 assert.equal(x.inserts[0].delivery_service,'priority');
});
test('no quote when point is outside, invalid, or priority is unavailable',async()=>{
 for(const [opts,body,status] of [
  [{},{...base,latitude:-22.8},422],
  [{},{...base,latitude:48},422],
  [{rules:{distance_times:[{...eta,priority:{enabled:false}}]}},{...base,delivery_service:'priority'},409],
  [{rules:{distance_fees:[-5]}},base,409],
  [{store:{latitude:null}},base,409],
  [{menu:{delivery_enabled:false}},base,404],
  [{limited:true},base,429]
 ]){
  const x=setup(opts);
  assert.equal((await x.call(body)).status,status);
  assert.equal(x.inserts.length,0);
 }
});
test('original polygons choose the first matching region, not summed fees',async()=>{
 const vertices=[[-22.925,-43.455],[-22.925,-43.44],[-22.91,-43.44],[-22.91,-43.455]];
 const x=setup({rules:{coverage_type:'polygons',polygons:[{name:'Primeira',vertices,fee:6,...eta},{name:'Segunda',vertices,fee:8,...eta}]}});
 const r=await x.call();
 assert.equal(r.status,200);
 assert.equal(r.body.region_name,'Primeira');
 assert.equal(r.body.fee,6);
 assert.equal(x.inserts[0].delivery_region,'Primeira');
});
test('desktop quote requires current store manager and disallows foreign origins',async()=>{
 const x=setup();
 assert.equal((await x.call(base,{origin:'http://tauri.localhost'})).status,401);
 assert.equal((await x.call(base,{origin:'http://tauri.localhost',authorization:'Bearer fixture'})).status,403);
 assert.equal((await x.call(base,{origin:'https://foreign.invalid'})).status,403);
 assert.equal(x.inserts.length,0);
 const authorized=setup({manager:true});
 assert.equal((await authorized.call(base,{origin:'http://tauri.localhost',authorization:'Bearer fixture'})).status,200);
});
