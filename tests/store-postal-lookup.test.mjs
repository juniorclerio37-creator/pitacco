import test from 'node:test';
import assert from 'node:assert/strict';
import {postalDigits,formatPostal,lookupPostalAddress,mergePostalAddress} from '../revisions/0.12/web/storePostalLookup.mjs';
const sample={cep:'26070-293',logradouro:'Rua Exemplo',bairro:'Bairro Exemplo',localidade:'Nova Iguaçu',uf:'RJ'};
test('CEP masks and sends only eight digits to the provider',async()=>{
 assert.equal(postalDigits('26070-293'),'26070293');
 assert.equal(formatPostal('26070293'),'26070-293');
 let called=0;
 const found=await lookupPostalAddress('26070-293',{fetcher:async(url,options)=>{called++;assert.equal(url,'https://viacep.com.br/ws/26070293/json/');assert.equal(options.credentials,'omit');return {ok:true,json:async()=>sample}}});
 assert.equal(called,1);
 assert.deepEqual(found,{address:'Rua Exemplo',neighborhood:'Bairro Exemplo',city:'Nova Iguaçu',state:'RJ'});
 await assert.rejects(lookupPostalAddress('123',{fetcher:async()=>{throw Error('Must not call')}}),/oito dígitos/);
});
test('unknown CEP or wrong returned CEP does not populate fields',async()=>{
 for(const data of [{erro:true},{...sample,cep:'99999-999'},{...sample,localidade:''}]){
  await assert.rejects(lookupPostalAddress('26070293',{fetcher:async()=>({ok:true,json:async()=>data})}));
 }
});
test('manual number, complement and changes made during lookup remain intact',()=>{
 const original={postal_code:'26070-293',address:'',neighborhood:'',city:'',state:'',address_number:'23',address_complement:'Fundos'};
 const current={...original,address:'Rua informada manualmente',address_number:'25'};
 const result=mergePostalAddress(current,original,{address:'Rua Exemplo',neighborhood:'Centro',city:'Nova Iguaçu',state:'RJ'},'26070293');
 assert.equal(result.address,current.address);
 assert.equal(result.address_number,'25');assert.equal(result.address_complement,'Fundos');
 assert.equal(result.city,'Nova Iguaçu');
 const other={...current,postal_code:'26070-294'};
 assert.equal(mergePostalAddress(other,original,result,'26070293'),other);
});
test('partial city-wide CEP leaves missing fields editable and never fabricates address',async()=>{
 const found=await lookupPostalAddress('26070293',{fetcher:async()=>({ok:true,json:async()=>({...sample,logradouro:'',bairro:''})})});
 const original={postal_code:'26070-293',address:'',neighborhood:'',address_number:'42'};
 const result=mergePostalAddress(original,original,found,'26070293');
 assert.equal(result.address,'');assert.equal(result.neighborhood,'');assert.equal(result.city,'Nova Iguaçu');assert.equal(result.address_number,'42');
});
test('aborted lookup and network failure never return a fabricated address',async()=>{
 const controller=new AbortController();
 const pending=lookupPostalAddress('26070293',{signal:controller.signal,fetcher:async(_url,{signal})=>new Promise((resolve,reject)=>signal.addEventListener('abort',()=>reject(new Error('Aborted')),{once:true}))});
 controller.abort();await assert.rejects(pending,/Aborted/);
 await assert.rejects(lookupPostalAddress('26070293',{fetcher:async()=>({ok:false})}),/indisponível/);
});
