import test from 'node:test';
import assert from 'node:assert/strict';
import {resolvePostalAddress} from '../supabase/functions/store-postal-lookup/postal-provider.mjs';
import {lookupStorePostalAddress} from '../revisions/0.12/web/storePostalLookup.mjs';
import {instagramHandle,instagramProfileUrl,deviceProposalAllowed} from '../revisions/0.12/web/storeRegistrationFields.mjs';
const cep='26070293',address={address:'Rua de teste',neighborhood:'Bairro de teste',city:'Nova Iguaçu',state:'RJ'};
const response=(status,data)=>({status,ok:status>=200&&status<300,json:async()=>data});
test('CEP: fallback to BrasilAPI on provider outage, correct CEP required',async()=>{
 const urls=[];
 const result=await resolvePostalAddress(cep,{fetcher:async url=>{urls.push(url);if(url.includes('viacep'))throw Error('offline');return response(200,{cep,street:address.address,neighborhood:address.neighborhood,city:address.city,state:address.state})}});
 assert.equal(result.status,200);assert.deepEqual(result.address,address);assert.equal(result.provider,'brasilapi');assert.equal(urls.length,2);
});
test('CEP: provider mismatch never fills fields; not found distinct from outage',async()=>{
 assert.equal((await resolvePostalAddress(cep,{fetcher:async url=>url.includes('viacep')?response(200,{erro:true}):response(404,{})})).status,404);
 assert.equal((await resolvePostalAddress(cep,{fetcher:async()=>response(200,{cep:'12345678',city:'Wrong',state:'RJ'})})).status,503);
 assert.equal((await resolvePostalAddress(cep,{fetcher:async()=>{throw Error('offline')}})).status,503);
});
test('CEP: authenticated endpoint; rejects stale or mismatched result',async()=>{
 const client={functions:{invoke:async(name,args)=>{assert.equal(name,'store-postal-lookup');assert.deepEqual(args.body,{cep,store_id:'store-fixture'});return {data:{cep,address},error:null}}}};
 assert.deepEqual(await lookupStorePostalAddress(client,'store-fixture','26070-293'),address);
 const abort=new AbortController();abort.abort();
 await assert.rejects(lookupStorePostalAddress(client,'store-fixture',cep,{signal:abort.signal}),/cancelada/);
 await assert.rejects(lookupStorePostalAddress({functions:{invoke:async()=>({data:{cep:'12345678',address}})}},'store-fixture',cep),/incorreto/);
});
test('Instagram displays @ and persists canonical URL',()=>{
 assert.equal(instagramHandle('https://www.instagram.com/loja.teste/'),'@loja.teste');
 assert.equal(instagramProfileUrl('@loja.teste'),'https://www.instagram.com/loja.teste/');
 assert.equal(instagramProfileUrl('loja_teste'),'https://www.instagram.com/loja_teste/');
 assert.equal(instagramProfileUrl(''),'');
 assert.throws(()=>instagramProfileUrl('https://evil.example/loja'));
});
test('GPS cannot displace a verified store pin with another city or invalid coordinates',()=>{
 assert.equal(deviceProposalAllowed([-22.7501,-43.4701],[-22.75,-43.47]),true);
 assert.equal(deviceProposalAllowed([-22.90,-43.20],[-22.75,-43.47]),false);
 assert.equal(deviceProposalAllowed([40,-73],null),false);
 assert.equal(deviceProposalAllowed([-22.75,-43.47],null),true);
});
