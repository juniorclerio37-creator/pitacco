import test from 'node:test';
import assert from 'node:assert/strict';
import {handleSalesCoach,salesContext} from '../cloudflare/sales-coach.mjs';
const id='20000000-0000-0000-0000-000000000081';
const data={sales:{orders:3,gross:75,complete_costs:0,known_contribution:null,customer:'CUSTOMER_SECRET'},catalog:[{id:'PRIVATE_ID',name:'Açaí',price:20,orders:3,recorded_cost:8,private:'SECRET'}],weekdays:[],combo_candidates:[],period_start:'2026-10-29',period_end:'2026-11-25'};
const req=(origin='https://admin.pitacco.com.br',token='Bearer test-token-123456')=>new Request('https://admin.pitacco.com.br/api/intelligence/sales',{method:'POST',headers:{origin,authorization:token,'content-type':'application/json'},body:JSON.stringify({storeId:id,question:'Como vender mais? Bearer SECRET_TOKEN'})});
test('minimal commercial context excludes private fields and preserves missing cost',()=>{const d=salesContext(data);assert.equal(d.vendas.contribuicao_conhecida,null);assert.equal(d.produtos[0].nome,'Açaí');assert.doesNotMatch(JSON.stringify(d),/PRIVATE_ID|CUSTOMER_SECRET|recorded_cost|SECRET/);});
test('admin coach validates origin, authorization, quota and RPC before inference',async()=>{
 const original=globalThis.fetch;let denied=false,isOwner=true,quota=true,model=0,requests=[];
 try{
  globalThis.fetch=async(url,opts)=>{requests.push(url);if(url.endsWith('/auth/v1/user'))return Response.json({id});if(url.endsWith('/rpc/pitacco_is_platform_owner'))return Response.json(isOwner);assert.match(url,/pitacco_business_insights$/);assert.equal(JSON.parse(opts.body).p_store,id);return denied?Response.json({error:'forbidden'},{status:403}):Response.json(data);};
  const env={PITACCO_SUPABASE_URL:'https://fixture.supabase.co',PITACCO_SUPABASE_PUBLISHABLE_KEY:'fixture',SALES_COACH_LIMIT:{limit:async()=>({success:quota})},AI:{run:async(_,args)=>{model++;assert.doesNotMatch(JSON.stringify(args),/SECRET_TOKEN|PRIVATE_ID|CUSTOMER_SECRET/);return {response:'Teste um combo e confira a margem.'};}}};
  assert.equal((await handleSalesCoach(req('https://other.invalid'),env)).status,403);
  assert.equal((await handleSalesCoach(req('https://admin.pitacco.com.br',''),env)).status,401);
  assert.equal((await handleSalesCoach(req('https://app.pitacco.com.br'),env)).status,403);assert.equal(requests.length,0);isOwner=false;assert.equal((await handleSalesCoach(req(),env)).status,403);assert.equal(model,0);isOwner=true;quota=false;assert.equal((await handleSalesCoach(req(),env)).status,429);assert.equal(model,0);quota=true;
  denied=true;assert.equal((await handleSalesCoach(req(),env)).status,403);assert.equal(model,0);
  denied=false;const response=await handleSalesCoach(req(),env);assert.equal(response.status,200);assert.equal(model,1);assert.match((await response.json()).answer,/combo/);assert.equal(response.headers.get('cache-control'),'no-store, private');
 }finally{globalThis.fetch=original;}
});
