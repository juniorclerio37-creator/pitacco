import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
const html=readFileSync(new URL('../marketing/cardapio.html',import.meta.url),'utf8');
const edge=readFileSync(new URL('../supabase/functions/pagbank-connect/index.ts',import.meta.url),'utf8');
test('sandbox checkout shares the storefront and never submits an operational order',()=>{
 assert.match(html,/PITACCO_PAGBANK_PREVIEW_V1/);
 assert.match(html,/if\(pagbankPreviewMode\)\{openPagBankPreview\(\);return;\}/);
 assert.match(html,/if\(pagbankPreviewMode&&checkout\)\{openPagBankPreview\(\);return;\}/);
 assert.match(html,/if\(pagbankPreviewMode\)return \{loyalty:null,best:null\}/);
 // Verify the sandbox still skips the operational storefront startup RPCs.
 const startup=html.match(/async function prepareMenuStartup\(\)\{([\s\S]*?)\n\}/)?.[0];
 assert.ok(startup);
 const calls=[];
 const sandboxStartup=new Function('pagbankPreviewMode','menuStartupRpc','slug',startup+';return prepareMenuStartup;')(true,(...args)=>{calls.push(args);throw Error('Sandbox must not query operational data');},'sandbox');
 assert.doesNotMatch(startup,/pitacco_public_store_region/);
 assert.match(html,/cartStoragePaused=true;menu.store.delivery_enabled=false/);
 assert.match(edge,/if\(!page.includes\('PITACCO_PAGBANK_PREVIEW_V1'\)/);
 assert.match(edge,/p_payload:\{items:d.items,fulfillment:'pickup'\}/);
 assert.match(edge,/order_released:false/);
 return sandboxStartup().then(result=>{assert.deepEqual(result,{loyalty:null,best:null});assert.deepEqual(calls,[]);});
});
test('the shared storefront module parses as JavaScript',()=>{
 const code=html.match(/<script type="module">([\s\S]*?)<\/script>/)?.[1];assert.ok(code);
 const check=spawnSync(process.execPath,['--input-type=module','--check'],{input:code,encoding:'utf8'});
 assert.equal(check.status,0,check.stderr);
});

test('V2 recovers the same sandbox cart and suppresses expired Pix codes',()=>{
 const extract=(start,end)=>{const a=html.indexOf(start),b=html.indexOf(end,a+1);assert.ok(a>=0&&b>a);return html.slice(a,b)};
 const expiry=extract('function pagbankPreviewUnexpired(','async function pagbankPreviewFetchQr(');
 const isUnexpired=new Function(expiry+';return pagbankPreviewUnexpired;')();
 const now=Date.parse('2026-01-01T00:00:00Z');
 assert.equal(isUnexpired({status:'WAITING',expires_at:'2026-01-01T00:00:01Z'},now),true);
 assert.equal(isUnexpired({status:'WAITING',expires_at:'2026-01-01T00:00:00Z'},now),false);
 assert.equal(isUnexpired({status:'WAITING',expires_at:'invalid'},now),false);
 assert.equal(isUnexpired({status:'PAID',expires_at:'2026-01-01T00:00:01Z'},now),false);
 const draftFunctions=extract('function pagbankPreviewDraftValid(','function pagbankPreviewUnexpired(');
 const state=new Map();const storage={setItem:(k,v)=>state.set(k,v),getItem:k=>state.get(k),removeItem:k=>state.delete(k)};
 const make=new Function('sessionStorage','pagbankPreviewToken','pagbankPreviewItems','const pagbankPreviewMode=true,pagbankPreviewDraftKey="sandbox-test";'+draftFunctions+';return {save:pagbankPreviewSaveDraft,restore:()=>{pagbankPreviewRestoreDraft();return pagbankPreviewItems}};');
 const items=[{product_id:'10000000-0000-0000-0000-000000000001',quantity:1,options:[],name:'Açaí',unit:13}];
 make(storage,'first',items).save();assert.deepEqual(make(storage,'first',null).restore(),items);
 assert.equal(make(storage,'other',null).restore(),null);
 assert.match(html,/pagbankPreviewSaveDraft\(\);\s*pagbankPreviewBusy=true/);
 assert.match(html,/group\.hidden=expired/);
 assert.match(html,/Retomar pagamento de teste/);
 assert.match(html,/else if\(v2Only\(\)\)await pagbankPreviewFetchQr\(\)/);
});
