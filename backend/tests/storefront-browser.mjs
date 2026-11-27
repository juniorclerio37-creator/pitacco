import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {chromium} from '../../web/node_modules/playwright/index.mjs';
const browser=await chromium.launch({headless:true});
try{
  const page=await browser.newPage({viewport:{width:390,height:844}});
  const external=[];
  page.on('request',r=>{if(!r.url().startsWith('http://127.0.0.1:8081/'))external.push(r.url());});
  await page.goto('http://127.0.0.1:8081/core-homologacao');
  await page.getByText('Cardápio carregado.',{exact:true}).waitFor();
  await page.locator('#review').click();
  let writes=0;
  await page.route('**/api/v1/public/menus/core-checkout-fixture/checkout',async route=>{
    writes++;
    const response=await route.fetch();
    assert.equal(response.status(),200);
    await route.abort('failed');
  });
  await page.locator('#submit').click();
  await page.locator('#recover').waitFor({state:'visible'});
  await page.locator('#recover').click();
  await page.getByRole('heading',{name:'Pedido confirmado!'}).waitFor();
  assert.match(await page.locator('#receipt').innerText(),/25,00/);
  await page.locator('#track').click();
  await page.getByText('Status: accepted',{exact:true}).waitFor();
  assert.equal(writes,1);
  await page.unroute('**/api/v1/public/menus/core-checkout-fixture/checkout');
  // Legacy storage key is populated before the Laravel adapter is first used.
  const device=await page.evaluate(async()=>{
    const device=crypto.randomUUID();
    const slug='core-checkout-fixture';
    const {customerProfileRpc}=await import('/core-homologacao/customer-session.mjs');
    const r=await customerProfileRpc('pitacco_v2_customer_profile',{p_slug:slug,p_phone:'21988887777',p_device:device,p_action:'save',p_name:'Cliente Sessao Fixture',p_addresses:[{label:'Casa',street:'Rua Fixture',number:'10',neighborhood:'Centro',city:'Cidade Fixture',state:'RJ',is_default:true}]});
    if(r.error||!r.data?.session_active)throw Error('Synthetic profile creation failed');
    localStorage.setItem('pitacco-v2-customer-device:'+slug,device);
    return device;
  });
  await page.reload();
  const resumed=await page.evaluate(async()=>{const {customerSession}=await import('/core-homologacao/customer-session.mjs');return customerSession('core-checkout-fixture').resume()});
  assert.equal(resumed.state,'active');
  assert.equal(resumed.data.name,'Cliente Sessao Fixture');
  assert.equal(resumed.data.addresses[0].street,'Rua Fixture');
  const legacy=await page.evaluate(async(device)=>{
    const {customerProfileRpc}=await import('/core-homologacao/customer-session.mjs');
    const base={p_slug:'core-checkout-fixture',p_device:device};
    const session=await customerProfileRpc('pitacco_customer_device_session',{...base,p_action:'resume'});
    const history=await customerProfileRpc('pitacco_customer_device_orders',{...base,p_action:'list'});
    return {session,history};
  },device);
  assert.equal(legacy.session.error,null);
  assert.equal(legacy.session.data.name,'Cliente Sessao Fixture');
  assert.equal(legacy.history.error,null);
  assert.deepEqual(legacy.history.data.orders,[]);
  await page.route('**/profile/session',r=>r.abort('failed'));
  assert.equal(await page.evaluate(async()=>{const {customerSession}=await import('/core-homologacao/customer-session.mjs');return (await customerSession('core-checkout-fixture').resume()).state}),'retry');
  assert.equal(await page.evaluate(()=>localStorage.getItem('pitacco-v2-customer-device:core-checkout-fixture')),device);
  const lost=await page.evaluate(async(device)=>{
    const {customerProfileRpc}=await import('/core-homologacao/customer-session.mjs');
    return customerProfileRpc('pitacco_customer_device_session',{p_slug:'core-checkout-fixture',p_device:device,p_action:'resume'});
  },device);
  assert.equal(lost.status,503);
  assert.equal(lost.data,null);
  assert.equal(await page.evaluate(()=>localStorage.getItem('pitacco-v2-customer-device:core-checkout-fixture')),device);
  await page.unroute('**/profile/session');
  assert.equal(await page.evaluate(async()=>{const {customerSession}=await import('/core-homologacao/customer-session.mjs');return (await customerSession('core-checkout-fixture').logout()).state}),'inactive');
  assert.equal(await page.evaluate(()=>localStorage.getItem('pitacco-v2-customer-device:core-checkout-fixture')),null);
  await page.getByText('Cardápio carregado.',{exact:true}).waitFor();
  await page.locator('#load-schedule').click();
  await page.getByText('Horários disponíveis.',{exact:true}).waitFor();
  const slot=await page.locator('#schedule option').nth(1).getAttribute('value');
  assert.match(slot,/-03:00$/);
  await page.locator('#schedule').selectOption(slot);
  await page.locator('#review').click();
  const responsePromise=page.waitForResponse(r=>r.url().endsWith('/checkout')&&r.request().method()==='POST');
  await page.locator('#submit').click();
  const response=await responsePromise;
  assert.equal(response.status(),200);
  assert.equal(response.request().postDataJSON().scheduled_for,slot);
  const scheduledReceipt=(await response.json()).data;
  assert.equal(scheduledReceipt.status,'pending');
  await page.getByRole('heading',{name:'Pedido agendado enviado com sucesso'}).waitFor();
  assert.equal(await page.locator('#scheduled-notice').isVisible(),true);
  // Original tracking refresh, unchanged, uses a minimal DOM and real API.
  const original=readFileSync(new URL('../../marketing/acompanhar.html',import.meta.url),'utf8');
  const refresh=original.split('\n').find(line=>line.startsWith('async function refresh(){if(working)return;'));
  assert.ok(refresh);
  const base='http://127.0.0.1:8081';
  const trackingPage=await page.context().newPage();
  trackingPage.on('request',r=>{if(!r.url().startsWith(base+'/'))external.push(r.url());});
  const script="import {readCoreTrackingRpc} from '/core-homologacao/tracking.mjs';\n"+
    "let working=false,token="+JSON.stringify(scheduledReceipt.tracking_token)+";\n"+
    "const $=id=>document.getElementById(id); const client={rpc:(name,args)=>{if(name!=='pitacco_track_public_order')throw Error('unexpected RPC');return readCoreTrackingRpc(args);}};\n"+
    "function renderLocation(p){document.body.dataset.location=p?'shown':'cleared';} function render(d){$('content').hidden=false;document.body.dataset.status=d.status;document.body.dataset.order=d.order_id;renderLocation(d.courier_position);$('message').textContent='updated';}\n"+
    refresh+"\nwindow.refreshTracking=refresh;";
  await trackingPage.route(base+'/core-tracking-fixture',r=>r.fulfill({contentType:'text/html',body:'<!doctype html><html><body><div id="content" hidden></div><a id="storeWhatsApp" href="#contact"></a><p id="message"></p><script type="module" src="/core-tracking-fixture.mjs"></script></body></html>'}));
  await trackingPage.route(base+'/core-tracking-fixture.mjs',r=>r.fulfill({contentType:'text/javascript',body:script}));
  await trackingPage.goto(base+'/core-tracking-fixture');
  await trackingPage.waitForFunction(()=>typeof window.refreshTracking==='function');
  await trackingPage.evaluate(()=>window.refreshTracking());
  assert.equal(await trackingPage.locator('body').getAttribute('data-order'),scheduledReceipt.order_id);
  assert.equal(await trackingPage.locator('body').getAttribute('data-status'),'pending');
  assert.equal(await trackingPage.locator('body').getAttribute('data-location'),'cleared');
  // Failed refresh clears a previously visible map; does not classify an outage as expired.
  const pattern='**/api/v1/public/orders/tracking';
  await trackingPage.evaluate(()=>{document.body.dataset.location='shown';});
  await trackingPage.route(pattern,r=>r.fulfill({status:503,contentType:'application/json',body:'{}'}));
  await trackingPage.evaluate(()=>window.refreshTracking());
  assert.equal(await trackingPage.locator('body').getAttribute('data-location'),'cleared');
  assert.match(await trackingPage.locator('#message').innerText(),/Não foi possível atualizar/);
  await trackingPage.unroute(pattern);
  await trackingPage.route(pattern,r=>r.fulfill({status:404,contentType:'application/json',body:'{}'}));
  await trackingPage.evaluate(()=>window.refreshTracking());
  assert.equal(await trackingPage.locator('#content').isVisible(),false);
  assert.equal(await trackingPage.locator('#storeWhatsApp').getAttribute('href'),null);
  assert.equal(await trackingPage.locator('#message').innerText(),'Link inválido ou expirado.');
  await trackingPage.close();
  assert.deepEqual(external,[]);
  await page.screenshot({path:'/tmp/core-storefront-homologation.png',fullPage:true});
  console.log('PASS: Chromium storefront, actual Laravel checkout, lost response recovery, tracking, no external requests');
}finally{await browser.close();}
