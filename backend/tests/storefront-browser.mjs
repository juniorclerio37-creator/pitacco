import assert from 'node:assert/strict';
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
  assert.deepEqual(external,[]);
  await page.screenshot({path:'/tmp/core-storefront-homologation.png',fullPage:true});
  console.log('PASS: Chromium storefront, actual Laravel checkout, lost response recovery, tracking, no external requests');
}finally{await browser.close();}
