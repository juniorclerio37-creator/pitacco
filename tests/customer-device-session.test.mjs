import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
const html=readFileSync(new URL('../marketing/cardapio.html',import.meta.url),'utf8');
test('persistent session is server checked and isolated from sandbox and editor',()=>{
 assert.match(html,/if\(pagbankPreviewMode\|\|studioPreviewActive\|\|customerSessionBusy\|\|!menu\)return/);
 assert.match(html,/menuStartupRpc\('pitacco_customer_device_session',\{p_slug:slug,p_device:device,p_action:'resume'\}\)/);
 assert.match(html,/p_action:'logout'/);
 assert.match(html,/device!==rememberedDevice\(\)/);
 assert.match(html,/customerSessionActive&&Date\.now\(\)<customerSessionExpiry\?'address':'identify'/);
 assert.match(html,/\$\('menuStartup'\)\.hidden=true;\s*void restoreCustomerSession\(\)/);
});
test('history requires device and confirmed order tracking proof',()=>{
 assert.match(html,/p_action:'link',p_tracking:token/);
 assert.match(html,/p_action:'list'/);
 assert.match(html,/if\(!data\?\.order_id\)throw Error[^;]+;\s*void rememberConfirmedOrder\(data\)/);
});
test('repeat order reconciles current catalog without submitting checkout',()=>{
 const a=html.indexOf('function repeatCustomerOrder('),b=html.indexOf('async function showCustomerOrders()',a);
 assert.ok(a>=0&&b>a);const fn=html.slice(a,b);
 assert.match(fn,/reconcileCartDraft\(order.items,menu.products\)/);
 assert.match(fn,/Substituir a sacola atual/);
 assert.match(fn,/cart=restored.items/);assert.match(fn,/cartStep\(false\)/);
 assert.match(fn,/fiadoPin'\)\.value=''/);
 assert.doesNotMatch(fn,/\.rpc\(|\.submit\(|requestSubmit\(/);
});
test('storefront module parses',()=>{
 const code=html.match(/<script type="module">([\s\S]*?)<\/script>/)?.[1];assert.ok(code);
 const r=spawnSync(process.execPath,['--input-type=module','--check'],{input:code,encoding:'utf8'});
 assert.equal(r.status,0,r.stderr);
});

test('saved address restores the confirmed coordinates before requesting a fresh price',()=>{
 const fill=html.slice(html.indexOf('function v2FillAddress('),html.indexOf('function v2SelectSavedAddress('));
 assert.match(fill,/composeDeliveryAddress\(\);[\s\S]*data\.location\?\.latitude[\s\S]*selectDeliveryPoint\(point\)/);
 assert.match(html,/address\.quote_id=deliveryQuote\.id/);
 assert.match(html,/const savedPoint=Boolean\(v2SelectedAddress&&!v2AddressEditing&&deliveryPoint\)/);
});

test('account shortcuts stay in the hero and history opens outside the banner',()=>{
 const hero=html.slice(html.indexOf('<header class="hero"'),html.indexOf('</header>'));
 assert.match(hero,/id="customerSessionBar"[^>]*hidden/);
 assert.match(hero,/id="customerSessionOrders"[^>]*aria-controls="customerSessionHistory"/);
 assert.match(hero,/id="customerSessionLogout"/);
 assert.doesNotMatch(hero,/id="customerSessionHistory"/);
 assert.match(html,/<section id="customerSessionHistory"[^>]*hidden/);
 assert.doesNotMatch(html,/Cadastro lembrado neste aparelho/);
 assert.match(html,/\$\('customerSessionBar'\)\.hidden=!active/);
 assert.match(html,/\$\('customerSessionLogout'\)\.onclick=\$\('customerSessionChange'\)\.onclick=\(\)=>void customerLogout\(\)/);
});
