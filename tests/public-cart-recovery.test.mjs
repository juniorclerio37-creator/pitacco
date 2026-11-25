import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const html=readFileSync(new URL('../marketing/cardapio.html',import.meta.url),'utf8');
const helpers=html.slice(html.indexOf("const cartStorageKey='pitacco-cart:'"),html.indexOf("window.addEventListener('storage'"));
const products=[{id:'p',name:'Atual',price:25,option_groups:[{min:1,max:1,options:[{id:'o',name:'Extra atual',price:3},{id:'gone',available:false,price:0}]}]}];
function fixture(){
 const elements=new Map(),storage=new Map();
 const context=vm.createContext({slug:'loja-a',menu:{products},cart:[],completed:false,pendingRequest:null,
  localStorage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)},
  $:id=>{if(!elements.has(id))elements.set(id,{});return elements.get(id)},renderCart(){},rememberConfirmedOrder:async()=>{},client:{rpc:async()=>({data:{confirmed:false}})}});
 vm.runInContext(helpers,context);
 return {context,storage,elements,run:s=>vm.runInContext(s,context)};
}
const line={product_id:'p',quantity:2,options:['o']};
test('restored variants use current catalog prices, names and constraints',()=>{
 const f=fixture();f.context.saved=[line,{...line,options:['gone']},{...line,options:[]},{...line,product_id:'removed'},{...line,options:['o','o']}];
 const r=f.run('reconcileCartDraft(saved,menu.products)');
 assert.equal(r.items.length,1);assert.equal(r.items[0].unit,28);assert.equal(r.items[0].name,'Atual');assert.equal(r.items[0].quantity,2);assert.equal(r.changed,true);
});
test('draft is store-scoped and contains only choices and request capability',()=>{
 const f=fixture();f.context.cart=[{...line,unit:1,name:'Old',phone:'private',pin:'123456'}];f.run('persistCartDraft()');
 assert.equal(f.storage.has('pitacco-cart:loja-b'),false);
 const draft=JSON.parse(f.storage.get('pitacco-cart:loja-a'));
 assert.deepEqual(draft.items,[line]);assert.equal(draft.pending_request,null);
 f.context.cart=[];f.run('restoreCartDraft()');assert.equal(f.context.cart[0].unit,28);
 f.context.completed=true;f.run('persistCartDraft()');assert.equal(f.storage.size,0);
});
test('invalid storage does not crash and failed storage has a visible notice',()=>{
 const f=fixture();f.storage.set('pitacco-cart:loja-a','broken');assert.equal(f.run('readCartDraft()'),null);
 f.context.cart=[line];f.context.localStorage.setItem=()=>{throw Error('blocked')};f.run('persistCartDraft()');
 assert.match(f.elements.get('cartDraftText').textContent,/não permitiu salvar/);
});
test('ambiguous checkout survives reload and only read-only confirmation clears it',async()=>{
 const f=fixture(),key='60000000-0000-4000-8000-000000000001';
 f.context.cart=[line];f.context.pendingRequest={p_request:key,p_phone:'private',p_code:'private'};f.run('persistCartDraft()');
 f.context.pendingRequest=null;f.run('restoreCartDraft()');
 let calls=0;f.context.client.rpc=async(name,args)=>{calls++;assert.equal(name,'pitacco_public_checkout_recovery');assert.equal(args.p_request,key);assert.equal(args.p_slug,'loja-a');return {data:{confirmed:false}}};
 await f.run('checkPendingCart()');assert.equal(f.storage.size,1);assert.equal(f.run('cartRecoveryId'),key);
 let linked=0;f.context.rememberConfirmedOrder=async data=>{linked++;assert.equal(data.tracking_token,'token');throw Error('history offline')};
 f.context.client.rpc=async()=>({data:{confirmed:true,order_id:'order',tracking_token:'token'}});
 await f.run('checkPendingCart()');assert.equal(linked,1);assert.equal(f.context.cart.length,0);assert.equal(f.storage.size,0);assert.equal(calls,1);
 assert.equal(f.elements.get('recoveredOrderLink').href,'/acompanhar/?token=token');
});
test('freight reads the domain error from the Edge HTTP response',async()=>{
 const source=html.slice(html.indexOf('async function quoteFailureMessage('),html.indexOf('\nfunction selectDeliveryPoint'));
 const context=vm.createContext({Response});vm.runInContext(source,context);
 context.error={message:'Edge Function returned a non-2xx status code',context:new Response(JSON.stringify({error:'Existe uma região poligonal inválida. Corrija em Área de Entrega.'}))};
 assert.match(await vm.runInContext('quoteFailureMessage(error)',context),/loja precisa revisar/);
 context.error={message:'Failed to fetch'};assert.match(await vm.runInContext('quoteFailureMessage(error)',context),/conexão/);
 context.error={context:new Response(JSON.stringify({error:'O endereço está fora da área de entrega.'}))};
 assert.match(await vm.runInContext('quoteFailureMessage(error)',context),/fora da área/);
});
