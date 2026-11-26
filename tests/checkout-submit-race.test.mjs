import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const html=readFileSync(new URL('../marketing/cardapio.html',import.meta.url),'utf8');
const start=html.indexOf("$('checkout').onsubmit=async event=>{");
const end=html.indexOf('\n\n\n// V2 checkout:',start);
assert.ok(start>=0&&end>start);

test('double submit during opening lookup reserves only one checkout and releases failed validation',async()=>{
 const elements=new Map();
 const messages=[];
 let release,lookups=0;
 const opening=new Promise(resolve=>{release=resolve});
 const context=vm.createContext({
  pagbankPreviewMode:false,completed:false,submitting:false,checkoutPreparing:false,
  cartRecoveryId:null,pendingRequest:null,cart:[{product_id:'fixture',quantity:1,options:[]}],
  $:id=>{if(!elements.has(id))elements.set(id,{value:''});return elements.get(id)},
  msg:value=>messages.push(value),
  refreshStoreOpening:async()=>{lookups++;await opening;return {open:true}},
 });
 vm.runInContext(html.slice(start,end),context);
 const submit=()=>elements.get('checkout').onsubmit({preventDefault(){}});
 const first=submit();
 await submit();
 assert.equal(lookups,1,'Second click cannot start another asynchronous preflight');
 assert.equal(context.checkoutPreparing,true);
 release();await first;
 assert.equal(context.checkoutPreparing,false,'Validation return releases the reservation');
 assert.equal(context.pendingRequest,null,'Invalid checkout never creates a request');
 assert.match(messages[0],/configurar atendimento e pagamento/);
 await submit();
 assert.equal(lookups,2,'Customer may correct validation and submit again');
 context.refreshStoreOpening=async()=>{throw Error('Horário indisponível')};
 await submit();
 assert.equal(context.checkoutPreparing,false,'Communication failure also releases preflight');
 assert.equal(messages.at(-1),'Horário indisponível');
});
