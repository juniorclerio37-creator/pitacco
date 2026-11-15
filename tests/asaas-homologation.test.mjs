import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createAsaasHomologation} from '../supabase/functions/asaas-homologation/handler.mjs';

const store='20000000-0000-0000-0000-000000000001';
const config={supabaseUrl:'https://pitacco-fixture.supabase.invalid',publicKey:'public-test',sandboxKey:'sandbox-test'};
const payment='pay_test';
const call=({origin='https://admin.pitacco.com.br',token='Bearer fixture',payment_id=payment}={})=>new Request('https://test.example.invalid/function',{
 method:'POST',headers:{origin,authorization:token},body:JSON.stringify({store_id:store,payment_id})
});

test('only the authorized platform admin can cause a sandbox request',async()=>{
 const requests=[];
 const check=createAsaasHomologation({...config,fetcher:(url,options)=>{
  requests.push(url.href);
  assert.equal(options.headers.authorization,'Bearer fixture');
  return Promise.resolve(Response.json({message:'Acesso exclusivo'},{status:403}));
 }});
 assert.equal((await check(call())).status,403);
 assert.equal((await check(call({token:''}))).status,401);
 assert.equal((await check(call({origin:'https://app.pitacco.com.br'}))).status,403);
 assert.deepEqual(requests,[config.supabaseUrl+'/rest/v1/rpc/pitacco_admin_homologation_probe']);
});

test('checks sandbox by payment ID and verifies the binding and recorded confirmation in the store',async()=>{
 const requests=[];
 const check=createAsaasHomologation({...config,fetcher:(url,options)=>{
  requests.push({url,options});
  if(requests.length===1)return Promise.resolve(Response.json({menu_has_checkout:true}));
  if(requests.length===2)return Promise.resolve(Response.json({id:payment,subscription:'sub_test',value:59.90,status:'RECEIVED',customer:'customer-private'}));
  return Promise.resolve(Response.json({asaas_environment:'sandbox',sandbox_payment_linked:true,sandbox_payment_recorded:false}));
 }});
 const response=await check(call());
 assert.deepEqual(await response.json(),{outcome:'checked',confirmed:true,plan_amount:true,sandbox_enabled:true,linked:true,recorded:false});
 assert.equal(requests[1].url.href,'https://api-sandbox.asaas.com/v3/payments/'+payment);
 assert.equal(requests[1].options.headers.access_token,config.sandboxKey);
 assert.deepEqual(JSON.parse(requests[2].options.body),{p_store:store,p_subscription:'sub_test',p_payment:payment});
});

test('reports missing sandbox configuration after admin authorization',async()=>{
 let requests=0;
 const check=createAsaasHomologation({...config,sandboxKey:undefined,fetcher:()=>{
  requests++;
  return Promise.resolve(Response.json({}));
 }});
 assert.deepEqual(await (await check(call())).json(),{outcome:'sandbox_key_missing'});
 assert.equal(requests,1);
});
