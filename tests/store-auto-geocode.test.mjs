import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {locateStoreByAddress,edgeErrorMessage} from '../revisions/0.12/web/mapOrigin.mjs';

const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
const storeId='20000000-0000-0000-0000-000000000001';
const invoke=(payload,error)=>({
 functions:{invoke:async(name,options)=>{
  assert.equal(name,'delivery-quote');
  assert.deepEqual(options.body,{action:'store-origin',store_id:storeId});
  return {data:payload,error};
 }}
});

test('saved address resolves automatically through the authenticated store Edge function',async()=>{
 const p=await locateStoreByAddress(invoke({latitude:-22.766,longitude:-43.454,approximate:true},null),storeId);
 assert.deepEqual(p,{point:[-22.766,-43.454],approximate:true});
});

test('invalid or missing geocoding never produces a fake default marker',async()=>{
 await assert.rejects(
  locateStoreByAddress(invoke({latitude:null,longitude:null},null),storeId),
  /Endereço não localizado/);
});

test('HTTP errors show the actual safe backend message and have bounded retry metadata',async()=>{
 const reply=msg=>({status:503,json:async()=>({error:msg})});
 const error={message:'Edge Function returned a non-2xx status code',
  context:reply('O provedor de localização não respondeu.')};
 assert.equal(await edgeErrorMessage(error),'O provedor de localização não respondeu.');
 await assert.rejects(locateStoreByAddress(invoke(null,error),storeId),e=>
   e.message==='O provedor de localização não respondeu.'&&e.retryable&&e.status===503);
 for(const [status,expected] of [[429,true],[422,false],[403,false]]){
  const e={message:'Edge Function returned a non-2xx status code',
   context:{status,json:async()=>({error:'Falha na localização.'})}};
  await assert.rejects(locateStoreByAddress(invoke(null,e),storeId),failure=>
    failure.status===status&&failure.retryable===expected);
 }
});

test('store address is geocoded on opening and again after a saved address change',()=>{
 const form=read('revisions/0.12/web/StoreProfile.jsx');
 const edge=read('supabase/functions/delivery-quote/index.ts');
 const fleet=read('revisions/0.12/web/FleetTracking.jsx');
 assert.match(form,/void locate\(\{automatic:true\}\)/);
 assert.match(form,/\[store\?\.id,addressSignature,point,manager,savedAddress,addressDirty,retryAttempt,deviceBusy\]/);
 assert.match(form,/manualProposal\.current\|\|deviceBusy\)return/);
 assert.match(form,/automaticLookup\.current/);
 assert.match(form,/retryTimer\.current=setTimeout/);
 assert.match(form,/75_000/);
 assert.match(form,/currentAddressRef\.current/);
 assert.match(form,/selectionVersion\.current/);
 assert.match(form,/Tentar localizar novamente/);
 assert.doesNotMatch(form,/>Localizar pelo endereço</);
 assert.match(form,/onSaved\?\.\(\)/);
 assert.match(edge,/body\.action==='store-origin'/);
 assert.match(edge,/db\.auth\.getUser\(token\)/);
 assert.match(edge,/pitacco_can_manage_courier_store/);
 assert.match(edge,/A localização automática está ocupada/);
 assert.match(edge,/O provedor de localização não respondeu/);
 assert.match(edge,/location\.lat\.toFixed\(6\)/);
 assert.match(fleet,/action:'store-origin'/);
});
