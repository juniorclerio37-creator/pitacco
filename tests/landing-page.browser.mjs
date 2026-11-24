import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {chromium} from '../web/node_modules/playwright/index.mjs';
const html=await readFile(new URL('../web/dist/index.html',import.meta.url),'utf8');
const browser=await chromium.launch({headless:true});
try{
 for(const width of [320,390,510,640,768,900,1024,1440]){
  const page=await browser.newPage({viewport:{width,height:900},reducedMotion:'reduce'});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.setContent(html,{waitUntil:'domcontentloaded'});
  assert.equal(await page.locator('.demo-choice').count(),6);
  assert.equal(await page.locator('.partner-logo').count(),10);
  assert.equal(await page.locator('.partner-logo img[src^="https:"]').count(),0,'production logos must not fetch external URLs');
  const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1);
  if(overflow){const offenders=await page.evaluate(()=>[...document.querySelectorAll('body *')].filter(e=>{const r=e.getBoundingClientRect();return r.width>0&&r.right>innerWidth+1}).slice(0,12).map(e=>({tag:e.tagName,class:String(e.className),right:e.getBoundingClientRect().right,text:e.textContent.slice(0,65)})));console.error('Overflow elements',width,offenders)}
  assert.equal(overflow,false,'page horizontal overflow at '+width);
  const headerOverflow=await page.locator('.nav').evaluate(el=>el.scrollWidth>el.clientWidth+1);
  assert.equal(headerOverflow,false,'header overflow at '+width);
  for(const view of ['vendas','pedidos','entregas','cardapio','fideliza','financeiro']){
   await page.locator('.demo-choice[data-view="'+view+'"]').click();
   assert.equal(await page.locator('[data-panel]:visible').count(),1);
   assert.equal(await page.locator('[data-panel="'+view+'"]').isVisible(),true);
   const overflowing=await page.locator('[data-panel="'+view+'"] .kpi').evaluateAll(els=>els.filter(e=>e.scrollWidth>e.clientWidth+1).map(e=>e.textContent));
   assert.deepEqual(overflowing,[],'KPI overflow at '+width+' '+view);
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false,'panel overflow at '+width+' '+view);
  }
  await page.locator('[data-demo-link="fideliza"]').click();
  assert.equal(await page.locator('[data-panel="fideliza"]').isVisible(),true);
  if(width<=1040){await page.locator('.menu-toggle').click();assert.equal(await page.locator('#siteMenu').isVisible(),true);await page.keyboard.press('Escape');assert.equal(await page.locator('#siteMenu').isVisible(),false)}
  await page.locator('#sales').evaluate(e=>{e.value='2000';e.dispatchEvent(new Event('input',{bubbles:true}))});
  assert.match(await page.locator('#flexCost').textContent(),/40,00/);
  assert.match(await page.locator('#calcHint').textContent(),/Flex.*19,90/);
  assert.equal(errors.length,0,errors.join('\n'));
  await page.close();
  console.log('PASS landing mobile/desktop interactions and dimensions: '+width+'px');
 }
}finally{await browser.close()}
