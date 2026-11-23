import assert from 'node:assert/strict';
import {readFile,mkdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {build} from '../web/node_modules/esbuild/lib/main.js';
import {chromium} from '../web/node_modules/playwright/index.mjs';
const source=await readFile(new URL('../marketing/cardapio.html',import.meta.url),'utf8');
const browser=await chromium.launch({executablePath:process.env.PITACCO_CHROMIUM});
const origin='http://localhost:4191';
const templatePalettes={
 'pitacco-v2':{primary:'#ff7a08',hero:'#4b075e',background:'#faf7fd',paper:'#ffffff',foreground:'#261033'},
 essencial:{primary:'#217c5a',hero:'#174c39',background:'#f5f8f6',paper:'#ffffff',foreground:'#173a2d'},
 editorial:{primary:'#bc5435',hero:'#41271f',background:'#fbf7f0',paper:'#ffffff',foreground:'#38271f'},
 urbano:{primary:'#24364a',hero:'#172330',background:'#f4f6f8',paper:'#ffffff',foreground:'#172330'}
};
const rules={points_enabled:true,points_per_real:1,min_points_to_redeem:100,points_reward_cents:1000,orders_enabled:true,orders_required:3,orders_reward_cents:500,coupons_enabled:true,campaigns_enabled:true,cashback_enabled:true,cashback_percent:5,cashback_max_redeem_percent:50,referrals_enabled:true,referral_reward_cents:300,referral_welcome_cents:200,minimum_order_cents:0};
try{
 for(const template of ['pitacco-v2','essencial','editorial','urbano']) for(const width of [375,1440]){
  const page=await browser.newPage({viewport:{width,height:1000}}),errors=[],sent=[];
  page.on('pageerror',e=>errors.push(e.stack||e.message));
  await page.route('**/*',async route=>{
   const url=new URL(route.request().url()),name=url.pathname.split('/').pop();
   if(url.origin===origin&&url.pathname==='/loyalty-test')return route.fulfill({contentType:'text/html',body:source});
   if(url.origin==='https://esm.sh')return route.fulfill({contentType:'text/javascript',headers:{'access-control-allow-origin':'*'},body:`export function createClient(){return {rpc:async(name,payload)=>{const r=await fetch('/fixture/'+name,{method:'POST',body:JSON.stringify(payload)});const data=await r.json();return {data:r.ok?data:null,error:r.ok?null:data,status:r.status}}}}`});
   if(!url.pathname.startsWith('/fixture/'))return route.abort();
   const p=route.request().postDataJSON();
   if(name==='get_public_menu')return route.fulfill({json:{store:{appearance:{template,...templatePalettes[template]},name:'Loja Fideliza',delivery_enabled:false,pickup_enabled:true,payment_methods:['pix_manual'],opening_hours:{open:true,reason:'open'}},products:[{id:'p1',name:'Açaí',category:'Açaí',price:50,option_groups:[]},{id:'p2',name:'Creme de cupuaçu',category:'Açaí',price:50,option_groups:[]},{id:'p3',name:'Combo da casa',category:'Açaí',price:50,option_groups:[]}]}});
   if(name==='pitacco_public_store_open')return route.fulfill({json:{open:true,reason:'open'}});
   if(name==='pitacco_public_schedule_slots')return route.fulfill({json:[]});
   if(name==='pitacco_loyalty_program')return route.fulfill({json:{rules,campaigns:[{id:'campaign',title:'Oferta da semana',code:'SEMANA5',discount_type:'fixed',discount_value:5,minimum_order_cents:0}]}});
   if(name==='pitacco_loyalty_phone_wallet'){
    assert.equal(p.p_phone,'21999990001');
    return route.fulfill({json:{linked:true,points:120,orders:3,cashback_cents:500,rules,referral_code:'PESSOAL',offers:[],history:[]}});
   }
   if(name==='pitacco_loyalty_preview'){
    assert.equal(p.p_key,'21999990001','prévia usa telefone, não chave');
    const subtotal=p.p_items.reduce((sum,x)=>sum+5000*x.quantity,0),discount=p.p_reward==='points'?1000:500;
    return route.fulfill({json:{subtotal_cents:subtotal,discount_cents:discount,products_total_cents:subtotal-discount}});
   }
   if(name==='pitacco_loyalty_checkout'){
    sent.push(p);assert.equal(p.p_key,'INDICADOR');assert.equal(p.p_items[0].quantity,2);assert.equal(p.p_payment,'pix_manual');
    assert.equal(p.p_reward,width===375?'points':'');assert.equal(p.p_coupon,width===375?'':'SEMANA5');
    if(sent.length===1)return route.fulfill({status:503,json:{message:'Conexão interrompida'}});
    assert.deepEqual(sent[0],sent[1],'retry preserves request and reserved benefit');
    return route.fulfill({json:{order_id:'order-confirmed',total:width===375?90:95,payment_status:'pending'}});
   }
   return route.fulfill({status:404,json:{message:'Unexpected '+name}});
  });
  await page.goto(origin+'/loyalty-test?indicacao=INDICADOR');
  await page.waitForFunction(()=>document.body.dataset.menuSkin);
  await page.locator('.product-open').first().waitFor();
  assert.equal(await page.locator('body').getAttribute('data-menu-skin'),template==='pitacco-v2'?'principal':template);
  await mkdir('artifacts',{recursive:true});
  await page.screenshot({path:`artifacts/menu-${template}-${width}.png`,fullPage:true});
  await page.getByRole('button',{name:'Meu Fideliza+',exact:true}).click();
  assert.equal(await page.locator('#v2LoyaltyPage').isVisible(),true,'Fideliza+ usa tela exclusiva V2');
  await page.locator('#v2LoyaltyPhone').fill('21999990001');
  await page.locator('#v2PointsValue').filter({hasText:'120'}).waitFor();
  assert.equal(await page.locator('#loyaltyOtp, #loyaltyKey, #loyaltyJoin').count(),0,'nenhuma chave, SMS ou cadastro');
  assert.equal(await page.evaluate(()=>Object.keys(localStorage).some(k=>k.startsWith('pitacco-loyalty'))),false,'nenhum token pessoal armazenado');
  assert.match(await page.locator('#loyaltyShare').inputValue(),/indicacao=PESSOAL/);
  assert.equal(await page.locator('#v2PointsValue').innerText(),'120','Resumo do Fideliza+ mostra pontos');
  await page.getByRole('button',{name:'Cardápio',exact:true}).click();
  await page.getByRole('button',{name:'Personalizar Açaí',exact:true}).click();
  await page.getByRole('button',{name:/Adicionar à sacola/}).click();
  await page.locator('#openCart').click();await page.locator('#continueCheckout').click();
  await page.locator('#customer').fill('Cliente');
  if(width===375)await page.locator('#loyaltyReward').selectOption('points');
  else await page.getByRole('button',{name:'Usar SEMANA5',exact:true}).click();
  await page.locator('#loyaltyApply').click();await page.locator('#total').getByText('Desconto Fideliza+', {exact:true}).waitFor();
  await page.locator('#backToCart').click();await page.locator('#cart input').fill('2');await page.locator('#cart input').dispatchEvent('change');
  assert.equal(await page.locator('#total').getByText('Desconto Fideliza+', {exact:true}).count(),0,'cart edit invalidates quoted discount');
  await page.locator('#continueCheckout').click();await page.locator('#loyaltyApply').click();
  await page.locator('#total').getByText('Desconto Fideliza+', {exact:true}).waitFor();
  await page.locator('#send').click();await page.getByRole('button',{name:'Tentar novamente',exact:true}).waitFor();
  assert.equal(await page.locator('#loyaltyBox').evaluate(e=>e.inert),true);
  await page.locator('#send').click();await page.getByRole('heading',{name:'Pedido recebido!',exact:true}).waitFor();
  await page.locator('#closeCart').click();await page.getByRole('button',{name:'Meu Fideliza+',exact:true}).click();
  assert.equal(await page.locator('#send').isVisible(),false,'wallet remains accessible after ordering without reopening checkout');
  assert.equal(await page.locator('#v2LoyaltyPage').isVisible(),true);
  assert.equal(await page.locator('#v2PointsValue').isVisible(),true);
  assert.equal(sent.length,2);assert.deepEqual(errors,[]);
  console.log('PASS Fideliza customer wallet, campaign/reward, cart invalidation and retry',template,width);
  await page.close();
 }
 // Exercise the actual merchant component with deterministic API fixtures.
 const bundled=await build({stdin:{contents:`import React from 'react';import{createRoot}from'react-dom/client';import Fideliza from '../revisions/0.12/web/Fideliza.jsx';createRoot(document.getElementById('root')).render(<Fideliza client={window.fixtureClient} storeId="store" manager={true}/>);`,resolveDir:fileURLToPath(new URL('../web/',import.meta.url)),loader:'jsx'},nodePaths:[fileURLToPath(new URL('../web/node_modules/',import.meta.url))],bundle:true,write:false,outfile:'merchant.js',format:'iife'});
 for(const width of [375,1440]){
  const page=await browser.newPage({viewport:{width,height:1000}}),errors=[];page.on('pageerror',e=>errors.push(e.stack||e.message));
  await page.addInitScript(()=>{
   window.fixtureProgram=null;window.fixtureCoupons=[];
   window.fixtureClient={rpc:async(name,p)=>({data:name==='pitacco_loyalty_customers'?[{id:'customer',name:'Cliente',phone:'21999990001',points:120,orders:3,cashback_cents:500}]:'b'.repeat(64),error:null}),from(table){
    let mode='select',data,filters={};const q={select(){return q},eq(k,v){filters[k]=v;return q},neq(){return q},order(){return q},maybeSingle(){return Promise.resolve({data:table==='public_menu_settings'?{slug:'loja-teste',enabled:true}:window.fixtureProgram,error:null})},upsert(d){mode='save';data=d;return q},insert(d){mode='insert';data=d;return q},update(d){mode='update';data=d;return q},delete(){mode='delete';return q},then(resolve,reject){
     if(mode==='save')window.fixtureProgram=data;
     if(mode==='insert')window.fixtureCoupons.push({...data,id:'coupon-'+window.fixtureCoupons.length,uses:0,active:true});
     if(mode==='update')window.fixtureCoupons=window.fixtureCoupons.map(x=>x.id===filters.id?{...x,...data}:x);
     return Promise.resolve({data:table==='loyalty_coupons'?window.fixtureCoupons:window.fixtureProgram,count:table==='loyalty_coupon_redemptions'?7:0,error:null}).then(resolve,reject);
    }};return q;}};
  });
  await page.route('**/*',route=>{
   const path=new URL(route.request().url()).pathname;
   if(path==='/merchant.js')return route.fulfill({contentType:'text/javascript',body:bundled.outputFiles.find(x=>x.path.endsWith('.js')).text});
   if(path==='/merchant.css')return route.fulfill({contentType:'text/css',body:bundled.outputFiles.find(x=>x.path.endsWith('.css')).text});
   return route.fulfill({contentType:'text/html',body:'<meta name="viewport" content="width=device-width, initial-scale=1"><style>body{margin:0;background:#f7f8fa}#root{max-width:1140px;margin:auto;padding:24px 20px}</style><link rel="stylesheet" href="/merchant.css"><div id="root"></div><script src="/merchant.js"></script>'});
  });
  await page.goto(origin+'/merchant');
  const configure=name=>page.getByRole('article',{name,exact:true}).getByRole('button',{name:'Configurar',exact:true}).click();
  await page.getByRole('button',{name:'Ver clientes',exact:true}).waitFor();
  await page.waitForFunction(()=>!document.querySelector('[aria-label="Fideliza+"]').getAttribute('aria-busy')||document.querySelector('[aria-label="Fideliza+"]').getAttribute('aria-busy')==='false');
  assert.equal(await page.locator('.fl-benefit').count(),6);
  assert.match(await page.locator('.fl-metrics').innerText(),/Clientes participantes\s+1/);
  assert.match(await page.locator('.fl-metrics').innerText(),/Benefícios utilizados\s+7/);
  assert.match(await page.locator('.fl-metrics').innerText(),/R\$\s*5,00/);
  assert.equal(await page.getByRole('link',{name:'Ver no cardápio',exact:true}).getAttribute('href'),'https://pitacco.com.br/loja-teste');
  await mkdir('artifacts',{recursive:true});
  await page.screenshot({path:`artifacts/fideliza-overview-${width}.png`,fullPage:true});
  await page.getByLabel('Filtrar benefícios').selectOption('Inativos');assert.equal(await page.locator('.fl-benefit').count(),4);
  await page.getByLabel('Filtrar benefícios').selectOption('Todos');
  await configure('Pontos e recompensas');
  assert.equal(await page.getByRole('dialog').getByRole('heading',{name:'Acúmulo de pontos',exact:true}).count(),1);
  assert.equal(await page.getByRole('dialog').getByRole('heading',{name:'Criar cupom',exact:true}).count(),0);
  assert.equal(await page.getByRole('dialog').getByLabel('Ativar cashback',{exact:true}).count(),0);
  await page.getByLabel('Ativar pontos',{exact:true}).check();
  page.once('dialog',dialog=>dialog.accept());await page.getByRole('button',{name:'Fechar configuração',exact:true}).click();
  assert.equal(await page.getByRole('switch',{name:'Ativar Pontos e recompensas',exact:true}).getAttribute('aria-checked'),'false');
  await configure('Pontos e recompensas');await page.screenshot({path:`artifacts/fideliza-drawer-${width}.png`,fullPage:true});await page.getByLabel('Ativar pontos',{exact:true}).check();await page.getByLabel('Ativar recompensa por quantidade de pedidos',{exact:true}).check();
  await page.getByRole('button',{name:'Salvar regras de pontos',exact:true}).click();
  await page.waitForFunction(()=>window.fixtureProgram?.points_enabled===true&&window.fixtureProgram.orders_enabled===true);
  await configure('Cashback');await page.getByLabel('Ativar cashback',{exact:true}).check();
  await page.getByLabel('Percentual sobre produtos pagos, após descontos (%)',{exact:true}).fill('5');await page.getByRole('button',{name:'Salvar cashback',exact:true}).click();
  await page.waitForFunction(()=>window.fixtureProgram?.cashback_percent===5);
  await configure('Indique e ganhe');await page.getByLabel('Ativar indicações',{exact:true}).check();
  await page.getByLabel('Crédito para quem indica (R$)',{exact:true}).fill('3');await page.getByRole('button',{name:'Salvar indicações',exact:true}).click();
  await page.waitForFunction(()=>window.fixtureProgram?.referrals_enabled===true&&window.fixtureProgram.referral_reward_cents===300);
  await configure('Campanhas');
  assert.equal(await page.getByRole('dialog').getByRole('heading',{name:'Criar campanha',exact:true}).count(),1);
  assert.equal(await page.getByRole('dialog').getByRole('heading',{name:'Criar cupom',exact:true}).count(),0);
  await page.getByLabel('Ativar campanhas no cardápio',{exact:true}).check();await page.getByRole('button',{name:'Salvar ativação',exact:true}).click();
  await page.getByLabel('Nome da oferta',{exact:true}).fill('Semana de ofertas');await page.getByLabel('Código',{exact:true}).fill('SEMANA5');await page.getByLabel('Desconto',{exact:true}).fill('5');
  await page.getByRole('button',{name:'Cadastrar oferta',exact:true}).click();await page.waitForFunction(()=>window.fixtureCoupons.some(x=>x.kind==='campaign'&&x.code==='SEMANA5'));
  await page.getByRole('button',{name:'Fechar configuração',exact:true}).click();
  await configure('Cupons');
  assert.equal(await page.getByRole('dialog').getByRole('heading',{name:'Criar cupom',exact:true}).count(),1);
  assert.equal(await page.getByRole('dialog').getByRole('heading',{name:'Criar campanha',exact:true}).count(),0);
  await page.getByLabel('Código',{exact:true}).fill('PESSOAL10');await page.getByLabel('Desconto',{exact:true}).fill('10');
  await page.getByLabel('Cliente exclusivo',{exact:true}).selectOption('customer');await page.getByLabel('Limite por cliente (exige acesso à carteira)',{exact:true}).fill('1');
  await page.getByRole('button',{name:'Cadastrar oferta',exact:true}).click();await page.waitForFunction(()=>window.fixtureCoupons.some(x=>x.code==='PESSOAL10'&&x.target_customer_id==='customer'&&x.per_customer_limit===1));
  await page.getByRole('button',{name:'Fechar configuração',exact:true}).click();
  await page.getByRole('button',{name:'Ver clientes',exact:true}).click();assert.equal(await page.getByRole('button',{name:'Recuperar acesso',exact:true}).count(),0);await page.getByLabel('Buscar cliente',{exact:true}).fill('inexistente');
  await page.keyboard.press('Escape');assert.equal(await page.getByRole('dialog').count(),0);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'no horizontal overflow');
  assert.deepEqual(errors,[]);console.log('PASS Fideliza merchant configuration for all modalities',width);await page.close();
 }
}finally{await browser.close()}
