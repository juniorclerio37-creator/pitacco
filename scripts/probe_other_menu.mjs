import {chromium} from '../web/node_modules/playwright/index.mjs';
const browser=await chromium.launch({headless:true});
const context=await browser.newContext({viewport:{width:375,height:900}});
for(const slug of ['acaidovinagre','acaidolinho']){
 const page=await context.newPage();
 console.log('COMPARE_START',slug);
 page.on('response',async r=>{
  const u=new URL(r.url());
  if(!u.hostname.endsWith('instadelivery.com.br')||!u.pathname.includes('/api/'))return;
  const ct=r.headers()['content-type']||'';
  const record={path:u.origin+u.pathname,status:r.status(),type:ct.slice(0,50)};
  if(ct.includes('json')){
   try{
    const d=await r.json();
    record.schema=Array.isArray(d)?{length:d.length,keys:Object.keys(d[0]||{})}:Object.keys(d||{});
    if(u.pathname.includes('/items')&&Array.isArray(d)){
     record.examples=d.slice(0,2).map(x=>({id:x.id,name:x.name,price:x.price,groups:Object.keys(x).filter(k=>/option|group|complement|custom/i.test(k))}));
    }
   }catch{}
  }
  console.log('COMPARE_API',slug,JSON.stringify(record).slice(0,4600));
 });
 try{
  await page.goto('https://instadelivery.com.br/'+slug,{waitUntil:'domcontentloaded',timeout:45000});
  await page.waitForTimeout(4500);
  console.log('COMPARE_BODY',slug,(await page.locator('body').innerText()).slice(0,2100));
  console.log('COMPARE_BUTTONS',slug,(await page.locator('button').allTextContents()).slice(0,50));
 }catch(e){console.log('COMPARE_ERROR',slug,e.message.slice(0,350))}
 await page.close();
}
await browser.close();
