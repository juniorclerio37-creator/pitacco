// Original V2 selector functions, minimal DOM, disposable Laravel API only.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {chromium} from '../../web/node_modules/playwright/index.mjs';
const original=readFileSync(new URL('../../marketing/cardapio.html',import.meta.url),'utf8');
const start=original.indexOf('function renderScheduleChoices(){');
const end=original.indexOf("$('schedule').addEventListener('change'",start);
assert.ok(start>=0&&end>start);
const selector=original.slice(start,end);
assert.ok(selector.includes("client.rpc('pitacco_public_schedule_slots'"));
const format=original.match(/^const scheduleFormat=.*;$/m)?.[0];
assert.ok(format);
const base='http://127.0.0.1:8081';
const browser=await chromium.launch({headless:true});
try{
 const page=await browser.newPage();
 const external=[];
 await page.route('**/*',async route=>{
   if(!route.request().url().startsWith(base+'/')){external.push(route.request().url());await route.abort();return;}
   await route.continue();
 });
 const script="\nimport {readCoreScheduleRpc} from '/core-homologacao/storefront.mjs';\nconst slug='core-checkout-fixture';\nconst $=id=>document.getElementById(id);\nconst el=(tag,text,cls)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;if(cls)n.className=cls;return n;};\nconst button=(text,cls)=>el('button',text,cls);\nconst client={rpc:(name,args)=>{if(name!=='pitacco_public_schedule_slots')throw Error('Unexpected RPC');return readCoreScheduleRpc(args);}};\nlet scheduleRequest=0,storeOpening={open:true};\nfunction renderCart(){document.body.dataset.rendered=String(Number(document.body.dataset.rendered||0)+1);}\n"+format+'\n'+selector+"\n$('schedule').addEventListener('change',()=>{renderScheduleChoices();renderCart();});\nwindow.refreshSchedule=loadSchedule;\nwindow.setOpen=v=>{storeOpening.open=v;};\n";
 await page.route(base+'/v2-schedule-fixture',r=>r.fulfill({contentType:'text/html',body:'<!doctype html><html lang="pt-BR"><body><select id="fulfillment"><option value="pickup">Retirada</option><option value="delivery">Entrega</option></select><section id="scheduleBlock" hidden><select id="schedule"></select><div id="scheduleChoices" hidden></div></section><script type="module" src="/v2-schedule-fixture.mjs"></script></body></html>'}));
 await page.route(base+'/v2-schedule-fixture.mjs',r=>r.fulfill({contentType:'text/javascript',body:script}));
 await page.goto(base+'/v2-schedule-fixture');
 await page.waitForFunction(()=>typeof window.refreshSchedule==='function');
 await page.evaluate(()=>window.refreshSchedule());
 await page.locator('#scheduleBlock').waitFor({state:'visible'});
 const slots=await page.locator('#schedule option').evaluateAll(opts=>opts.slice(1).map(o=>o.value));
 assert.ok(slots.length);
 assert.ok(slots.every(s=>s.endsWith('-03:00')));
 const first=page.locator('#scheduleChoices .schedule-time').filter({hasText:/^\d{2}:\d{2}$/}).first();
 await first.click();
 const selected=await page.locator('#schedule').inputValue();
 assert.equal(selected,slots[0]);
 await page.evaluate(()=>window.refreshSchedule());
 assert.equal(await page.locator('#schedule').inputValue(),selected);
 await page.getByRole('button',{name:'Pedir agora',exact:true}).click();
 assert.equal(await page.locator('#schedule').inputValue(),'');
 await page.locator('#fulfillment').selectOption('delivery');
 await page.evaluate(()=>window.refreshSchedule());
 assert.ok(await page.locator('#schedule option').count()>1);
 await page.evaluate(()=>{window.setOpen(false);return window.refreshSchedule();});
 assert.equal(await page.getByRole('button',{name:'Pedir agora',exact:true}).count(),0);
 for(const status of [503,200]){
  const pattern='**/schedule-slots?fulfillment=delivery';
  await page.route(pattern,r=>r.fulfill({status,contentType:'application/json',body:JSON.stringify(status===200?{data:{timezone:'America/Sao_Paulo',slots:[]}}:{error:'temporarily_unavailable'})}));
  await page.evaluate(()=>window.refreshSchedule());
  assert.equal(await page.locator('#scheduleBlock').isVisible(),false);
  assert.equal(await page.locator('#schedule option').count(),1);
  await page.unroute(pattern);
 }
 assert.deepEqual(external,[]);
 console.log('PASS: original V2 schedule selector with Laravel, pickup/delivery, preserved choice, closed store, empty/error response, no external requests');
}finally{await browser.close();}
