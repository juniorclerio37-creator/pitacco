// CI-only bridge: original quote handler, real disposable PostgreSQL, no external calls.
// Not a production runtime or generic RPC adapter.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire,stripTypeScriptTypes} from 'node:module';
import {runInNewContext} from 'node:vm';
import * as geometry from '../../supabase/functions/delivery-quote/coverage-geometry.mjs';
assert.equal(process.env.APP_ENV,'testing');
assert.equal(process.env.GITHUB_ACTIONS,'true');
const require=createRequire(new URL('../../web/tests/backend/package.json',import.meta.url));
const {Client}=require('pg');
const client=new Client({host:'127.0.0.1',port:5432,database:'postgres',user:'postgres',password:'isolated-ci-password',statement_timeout:3000});
const requestId=process.argv[2],service=process.argv[3];
assert.match(requestId,/^[0-9a-f-]{36}$/);
assert.ok(['standard','priority'].includes(service));
const storeId='20000000-0000-4000-8000-000000000001';
const slug='core-settings-fixture';
const address='Rua Fixture 789';
const rows={
 public_menu_settings:{key:'slug',value:slug,sql:"select to_jsonb(m) as data from (select store_id,enabled,delivery_enabled from public.public_menu_settings where slug=$1 and store_id=$2) m",args:[slug,storeId]},
 pitacco_delivery_pricing:{key:'store_id',value:storeId,sql:"select to_jsonb(p) as data from public.pitacco_delivery_pricing p where store_id=$1",args:[storeId]},
 stores:{key:'id',value:storeId,sql:"select to_jsonb(s) as data from (select latitude,longitude,address,address_number,neighborhood,city,state,postal_code from public.stores where id=$1) s",args:[storeId]}
};
let rateCalls=0;
const db={
 from(table){
  let key,value,payload;
  const q={
   select(){return q;},
   eq(k,v){key=k;value=v;return q;},
   insert(v){assert.equal(table,'pitacco_delivery_route_quotes');payload=v;return q;},
   async maybeSingle(){return q.single();},
   async single(){
    if(table==='pitacco_delivery_route_quotes'){
     assert.equal(payload.store_id,storeId);
     assert.equal(payload.request_id,requestId);
     assert.equal(payload.destination_address,address);
     assert.equal(payload.delivery_service,service);
     const keys=['store_id','request_id','destination_address','destination_latitude','destination_longitude','address_point_selected','distance_m','fee','pricing_updated_at','expires_at','delivery_min_minutes','delivery_max_minutes','delivery_region','delivery_service'];
     assert.deepEqual(Object.keys(payload).sort(),keys.slice().sort());
     const result=await client.query('insert into public.pitacco_delivery_route_quotes('+keys.join(',')+') values('+keys.map((_,i)=>'$'+(i+1)).join(',')+') returning id',keys.map(k=>payload[k]));
     return {data:result.rows[0],error:null};
    }
    const rule=rows[table];
    assert.ok(rule);
    assert.equal(key,rule.key);assert.equal(value,rule.value);
    const result=await client.query(rule.sql,rule.args);
    return {data:result.rows[0]?.data??null,error:null};
   }
  };
  return q;
 },
 // Rate/identity service simulation only: the real quote geometry and storage run.
 async rpc(name,args){
  assert.equal(name,'pitacco_service_delivery_quote_limit');
  assert.ok(args.p_scope.includes(storeId));
  assert.ok([10,500].includes(args.p_max));
  rateCalls++;
  return {data:true,error:null};
 }
};
const src=readFileSync(new URL('../../supabase/functions/delivery-quote/index.ts',import.meta.url),'utf8');
let handler;
const context={...geometry,createClient:()=>db,Deno:{serve:fn=>{handler=fn;},env:{get:k=>({SUPABASE_URL:'https://fixture.invalid',SUPABASE_SERVICE_ROLE_KEY:'fixture-only-secret'})[k]}},Request,Response,URL,TextEncoder,crypto,console,fetch:async()=>{throw Error('External network disabled');}};
await client.connect();
try{
 runInNewContext(stripTypeScriptTypes(src.replace(/^import .*;\r?\n/gm,''),{mode:'strip'}),context);
 const res=await handler(new Request('https://fixture.invalid/quote',{method:'POST',headers:{origin:'https://pitacco.com.br','Content-Type':'application/json'},body:JSON.stringify({slug,address,request_id:requestId,latitude:-22.915,longitude:-43.46,delivery_service:service})}));
 const result=await res.json();
 assert.equal(res.status,200,JSON.stringify(result));
 assert.equal(rateCalls,2);
 assert.equal(result.request_id,requestId);
 assert.equal(result.fee,service==='priority'?9:5);
 assert.equal(result.delivery_min_minutes,service==='priority'?20:40);
 assert.equal(result.delivery_max_minutes,service==='priority'?30:60);
 assert.ok(result.distance_m>500&&result.distance_m<620);
 process.stdout.write(JSON.stringify(result));
}finally{await client.end();}
