import {chromium} from '../web/node_modules/playwright/index.mjs';
const url='https://instadelivery.com.br/acaidolinho';
const browser=await chromium.launch({headless:true});
const context=await browser.newContext({viewport:{width:400,height:900},userAgent:'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36'});
const page=await context.newPage();
const events=[];
function keys(value,depth=0){
 if(depth>3)return typeof value;
 if(Array.isArray(value))return {type:'array',length:value.length,element:value.length?keys(value[0],depth+1):null};
 if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).slice(0,28).map(([k,v])=>[k,keys(v,depth+1)]));
 if(typeof value==='string')return '<string length '+value.length+'>';
 return value;
}
page.on('response',async r=>{
 const ct=r.headers()['content-type']||'';
 const u=new URL(r.url());
 if(!['fetch','xhr','document'].includes(r.request().resourceType())&&!ct.includes('json'))return;
 const event={url:u.origin+u.pathname,method:r.request().method(),status:r.status(),type:r.request().resourceType(),ct:ct.slice(0,75)};
 try{
  if(ct.includes('json')||ct.includes('javascript')){
   const text=await r.text();
   if(ct.includes('json')&&text.length<1800000){
    const data=JSON.parse(text);event.shape=keys(data);
    if(u.pathname.includes('by-slug')){
      console.log('STORE_KEYS',JSON.stringify(Object.keys(data)));
      for(const [name,v] of Object.entries(data)){
        if(/categor|product|group|item|menu|subgroup|complement/i.test(name))
          console.log('STORE_CATALOG_FIELD',name,JSON.stringify(keys(v)).slice(0,10000));
      }
    }
   }
   else event.bytes=text.length;
  }else event.bytes=(await r.body()).length;
 }catch(e){event.error=e.message.slice(0,90)}
 events.push(event);
 console.log('RESPONSE',JSON.stringify(event).slice(0,12000));
});
page.on('console',m=>{if(m.type()==='error')console.log('BROWSER_ERROR',m.text().slice(0,400))});
page.on('pageerror',e=>console.log('PAGE_ERROR',e.message.slice(0,400)));
try{
 await page.goto(url,{waitUntil:'domcontentloaded',timeout:45000});
 await page.waitForTimeout(6500);
 console.log('URL_FINAL',page.url());
 console.log('TITLE',await page.title());
 console.log('BODY_TEXT',(await page.locator('body').innerText().catch(()=>'' )).slice(0,6500));
 console.log('BUTTON_TEXTS',(await page.locator('button').allTextContents().catch(()=>[])).slice(0,50));
 console.log('PAGE_HTML_MARKERS',JSON.stringify({length:(await page.content()).length,hasPrice:(await page.content()).includes('R
 console.log('LS_KEYS',await page.evaluate(()=>Object.keys(localStorage)).catch(()=>[]));
 console.log('SCRIPTS',(await page.locator('script[src]').evaluateAll(nodes=>nodes.map(x=>x.src))).slice(0,50));
 const scripts=await page.locator('script[src]').evaluateAll(nodes=>nodes.map(x=>x.src));
 for(const jsUrl of scripts.filter(x=>!x.includes('googletagmanager')&&!x.includes('analytics')).slice(0,9)){
  try{
   const r=await page.request.get(jsUrl,{timeout:20000});
   const body=await r.text();
   const paths=[...new Set((body.match(/https?:\/\/[^"'\s\`\\]{10,120}|\/api\/[a-zA-Z0-9\-_/{}]{5,100}|\/v\d\/[a-zA-Z0-9\-_/{}]{5,100}/g)||[]))].slice(0,90);
   console.log('SCRIPT_SCAN',JSON.stringify({name:new URL(jsUrl).pathname.split('/').pop(),status:r.status(),bytes:body.length,paths}).slice(0,14000));
  }catch(e){console.log('SCRIPT_ERROR',e.message.slice(0,200))}
 }
}catch(err){console.log('PROBE_ERROR',err.message.slice(0,400))}
finally{await browser.close()}
),hasCategory:(await page.content()).includes('Categorias')}));
 await page.mouse.wheel(0,2400);await page.waitForTimeout(4000);console.log('BODY_AFTER_SCROLL',(await page.locator('body').innerText().catch(()=>'' )).slice(0,6500));
 console.log('LS_KEYS',await page.evaluate(()=>Object.keys(localStorage)).catch(()=>[]));
 console.log('SCRIPTS',(await page.locator('script[src]').evaluateAll(nodes=>nodes.map(x=>x.src))).slice(0,50));
 const scripts=await page.locator('script[src]').evaluateAll(nodes=>nodes.map(x=>x.src));
 for(const jsUrl of scripts.filter(x=>!x.includes('googletagmanager')&&!x.includes('analytics')).slice(0,9)){
  try{
   const r=await page.request.get(jsUrl,{timeout:20000});
   const body=await r.text();
   const paths=[...new Set((body.match(/https?:\/\/[^"'\s\`\\]{10,120}|\/api\/[a-zA-Z0-9\-_/{}]{5,100}|\/v\d\/[a-zA-Z0-9\-_/{}]{5,100}/g)||[]))].slice(0,90);
   console.log('SCRIPT_SCAN',JSON.stringify({name:new URL(jsUrl).pathname.split('/').pop(),status:r.status(),bytes:body.length,paths}).slice(0,14000));
  }catch(e){console.log('SCRIPT_ERROR',e.message.slice(0,200))}
 }
}catch(err){console.log('PROBE_ERROR',err.message.slice(0,400))}
finally{await browser.close()}
