import assert from 'node:assert/strict';
import { readFile, mkdir } from 'node:fs/promises';
import { chromium } from '../web/node_modules/playwright/index.mjs';

// Verifica o enquadramento responsivo sem acessar o banco ou mudar outra loja.
const html=await readFile(new URL('../marketing/cardapio.html',import.meta.url),'utf8');
const origin='http://localhost:4179';
const square='https://photos.pitacco.test/square.svg';
const portrait='https://photos.pitacco.test/portrait.svg';
const sample={
 store:{name:'Açaí do Linho - Loja de Testes',appearance:{template:'pitacco-v2'},pickup_enabled:true,delivery_enabled:false,
  payment_methods:['dinheiro'],opening_hours:{open:true,reason:'open',next_open_at:null}},
 products:[
  {id:'square',name:'Açaí Quadrado',category:'Açaí Tradicional',price:15,description:'Foto quadrada',image_url:square,option_groups:[]},
  {id:'portrait',name:'Açaí Retrato',category:'Premium',price:25,description:'Foto vertical',image_url:portrait,option_groups:[]}
 ]
};
const moduleStub=`export function createClient(){return {
 rpc:async name=>{
  if(name==='get_public_menu')return {data:${JSON.stringify(sample)},error:null};
  if(name==='pitacco_public_top_sellers')return {data:['square','portrait'],error:null};
  if(name==='pitacco_public_store_region')return {data:'Miguel Couto',error:null};
  if(name==='pitacco_public_store_open')return {data:{open:true,reason:'open'},error:null};
  return {data:null,error:{message:'not enabled in photo preview'}};
 },
 functions:{invoke:async()=>({data:null,error:null})}
}}`;
const browser=await chromium.launch({executablePath:process.env.PITACCO_CHROMIUM});
try{
 for(const conf of [
  {slug:'acai-do-linho-demo',template:'pitacco-v2',width:375,pilot:true},
  {slug:'acai-do-linho-demo',template:'pitacco-v2',width:1280,pilot:true},
  {slug:'loja-teste',template:'pitacco-v2',width:375,pilot:false},
  {slug:'acai-do-linho-demo',template:'editorial',width:375,pilot:false}
 ]){
  const page=await browser.newPage({viewport:{width:conf.width,height:900}});
  page.setDefaultTimeout(20000);
  const errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/*',async route=>{
   const url=new URL(route.request().url());
   if(url.origin===origin && (url.pathname==='/'+conf.slug || url.pathname==='/cardapio/'))
    return route.fulfill({contentType:'text/html',body:html});
   if(url.origin==='https://esm.sh')
    return route.fulfill({contentType:'text/javascript',headers:{'access-control-allow-origin':'*'},
     body:moduleStub.replace('"template":"pitacco-v2"',`"template":"${conf.template}"`)});
   if(url.origin==='https://photos.pitacco.test'){
    const isPortrait=url.pathname.includes('portrait');
    return route.fulfill({contentType:'image/svg+xml',body:isPortrait
      ?'<svg xmlns="http://www.w3.org/2000/svg" width="400" height="700"><rect width="400" height="700" fill="#b184ac"/><circle cx="200" cy="350" r="135" fill="#7b247d"/></svg>'
      :'<svg xmlns="http://www.w3.org/2000/svg" width="600" height="600"><rect width="600" height="600" fill="#b184ac"/><circle cx="300" cy="300" r="235" fill="#7b247d"/></svg>'});
   }
   return route.abort();
  });
  await page.goto(origin+'/'+conf.slug);
  await page.locator('#menuStartup').waitFor({state:'hidden'});
  const marker=await page.locator('body').getAttribute('data-menu-photo-pilot');
  assert.equal(marker,conf.slug==='acai-do-linho-demo'?'brendi-linho':null);
  await page.waitForFunction(()=>document.querySelectorAll('.v2-top-photo img').length===2);
  const imgs=page.locator('.v2-top-photo img');
  await page.waitForFunction(()=>[...document.querySelectorAll('.v2-top-photo img')].every(img=>img.complete&&img.naturalWidth>0));
  const top=await imgs.evaluateAll(images=>images.map(img=>({
   fit:getComputedStyle(img).objectFit,flag:img.dataset.photoFit||null,
   width:img.parentElement.getBoundingClientRect().width,
   height:img.parentElement.getBoundingClientRect().height
  })));
  if(conf.pilot){
   assert.equal(top[0].fit,'cover');
   assert.equal(top[0].flag,'cover');
   assert.equal(top[1].fit,'contain');
   assert.equal(top[1].flag,'contain');
   if(conf.width===375)assert.ok(top.every(p=>Math.abs(p.width-p.height)<2),'Fotos em destaque devem ser quadradas no celular');
  }else{
   assert.deepEqual(top.map(p=>p.fit),['cover','cover'],'Outras lojas e templates mantêm o enquadramento antigo');
  }
  await page.locator('[data-v2-nav="cardapio"]').first().click();
  const products=page.locator('.category-grid .product-visual img');
  await products.first().waitFor({state:'visible'});
  await page.waitForFunction(()=>[...document.querySelectorAll('.category-grid .product-visual img')].every(img=>img.complete&&img.naturalWidth>0));
  const cards=await products.evaluateAll(images=>images.map(img=>({
   fit:getComputedStyle(img).objectFit,flag:img.dataset.photoFit||null,
   width:img.parentElement.getBoundingClientRect().width,
   height:img.parentElement.getBoundingClientRect().height
  })));
  if(conf.pilot){
   assert.deepEqual(cards.map(x=>x.fit),['cover','contain']);
   if(conf.width===375)assert.ok(cards.every(p=>Math.abs(p.width-p.height)<2),'Cards devem manter área quadrada no celular');
   await page.getByRole('button',{name:'Personalizar Açaí Quadrado'}).click();
   const detail=page.locator('.product-intro img');
   await detail.waitFor({state:'visible'});
   assert.equal(await detail.evaluate(img=>getComputedStyle(img).objectFit),'contain','Detalhes não podem cortar foto');
  }else assert.deepEqual(cards.map(x=>x.fit),['cover','cover']);
  assert.deepEqual(errors,[],'Nenhum erro no console do navegador');
  if(conf.pilot){
   await mkdir('artifacts',{recursive:true});
   await page.screenshot({path:`artifacts/menu-fotos-${conf.width}.png`,fullPage:false});
  }
  console.log('PASS foto responsiva',conf.slug,conf.template,conf.width,JSON.stringify({top,cards}));
  await page.close();
 }
}finally{await browser.close()}
