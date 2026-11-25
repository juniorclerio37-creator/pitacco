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
 assert.match(html,/if\(pagbankPreviewMode\)return \{loyalty:null,best:null,region:null\}/);
 assert.match(html,/cartStoragePaused=true;menu.store.delivery_enabled=false/);
 assert.match(edge,/if\(!page.includes\('PITACCO_PAGBANK_PREVIEW_V1'\)/);
 assert.match(edge,/p_payload:\{items:d.items,fulfillment:'pickup'\}/);
 assert.match(edge,/order_released:false/);
});
test('the shared storefront module parses as JavaScript',()=>{
 const code=html.match(/<script type="module">([\s\S]*?)<\/script>/)?.[1];assert.ok(code);
 const check=spawnSync(process.execPath,['--input-type=module','--check'],{input:code,encoding:'utf8'});
 assert.equal(check.status,0,check.stderr);
});
