import assert from 'node:assert/strict';
import { readFile, mkdir } from 'node:fs/promises';
import { chromium } from '../web/node_modules/playwright/index.mjs';

const [menuPage, trackingPage] = await Promise.all(
  ['cardapio', 'acompanhar'].map(name => readFile(new URL(`../marketing/${name}.html`, import.meta.url), 'utf8'))
);
const deliveryMapScript = await readFile(new URL('../revisions/0.12/web/deliveryMap.mjs',import.meta.url),'utf8');
assert.match(deliveryMapScript,/export async function mountCustomerTrackingMap/);
const mapFixture = `
 export async function mountDeliveryMap(container,{onSelect,showCoverage}) {
  container.dataset.showCoverage=String(showCoverage);
  return {setArea(){},setPoint(){},clearPoint(){},showPoint(point){onSelect(point)},resize(){},remove(){}};
 }
 export function currentLocation(){
  return new Promise((resolve,reject)=>navigator.geolocation.getCurrentPosition(
   ({coords})=>resolve([Number(coords.latitude.toFixed(6)),Number(coords.longitude.toFixed(6))]),reject));
 }
 export async function mountCustomerTrackingMap(container){
  container.dataset.initialized='true';
  return {update(point){container.dataset.latitude=String(point.latitude);
   container.dataset.longitude=String(point.longitude)},resize(){},remove(){}};
 }`;
const browser = await chromium.launch({ executablePath: process.env.PITACCO_CHROMIUM });
const origin = 'http://localhost:4179';
// Exercise the real production build, not only the fixture that masks bare imports.
const bundledMap=await readFile(new URL('../web/dist/assets/delivery-map.mjs',import.meta.url),'utf8');
const bundledMapCss=await readFile(new URL('../web/dist/assets/delivery-map.css',import.meta.url),'utf8');
const orderId = '10000000-0000-0000-0000-000000000001';
const token = '20000000-0000-0000-0000-000000000001';

try {
  const mapPage=await browser.newPage({viewport:{width:375,height:800}});
  await mapPage.route('**/*',async route=>{
   const url=new URL(route.request().url());
   if(url.origin===origin&&url.pathname==='/map-smoke')return route.fulfill({contentType:'text/html',body:'<link rel="stylesheet" href="/assets/delivery-map.css"><div id="map" style="width:340px;height:260px"></div><script type="module">import {mountDeliveryMap} from "/assets/delivery-map.mjs";const map=await mountDeliveryMap(document.getElementById("map"),{center:[-22.71,-43.4],showCoverage:false,onSelect:p=>window.selected=p});map.showPoint([-22.71,-43.4]);window.mapReady=true;</script>'});
   if(url.origin===origin&&url.pathname==='/assets/delivery-map.mjs')return route.fulfill({contentType:'text/javascript',body:bundledMap});
   if(url.origin===origin&&url.pathname==='/assets/delivery-map.css')return route.fulfill({contentType:'text/css',body:bundledMapCss});
   if(url.hostname==='tile.openstreetmap.org')return route.fulfill({contentType:'image/png',body:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jE1sAAAAASUVORK5CYII=','base64')});
   return route.abort();
  });
  await mapPage.goto(origin+'/map-smoke');
  await mapPage.waitForFunction(()=>window.mapReady===true);
  await mapPage.locator('.leaflet-container .pitacco-delivery-address-pin').waitFor({state:'visible'});
  await mapPage.locator('#map').click({position:{x:90,y:100}});
  await mapPage.waitForFunction(()=>Array.isArray(window.selected));
  await mapPage.close();
  console.log('PASS real bundled public Leaflet map and click selection');
  for(const template of ['pitacco-v2','essencial','editorial','urbano','classic']) for (const width of [375, 768, 1440]) {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    page.setDefaultTimeout(30000);
    page.setDefaultNavigationTimeout(30000);
    console.log('RUN public-flow',template,width);
    const tracking = {
      375: { status: 'accepted', delivery_status: 'cancelada', fulfillment: 'delivery', label: 'Pedido cancelado' },
      768: { status: 'accepted', delivery_status: 'retirada', preparation_status: 'ready', fulfillment: 'delivery', label: 'Saiu para entrega' },
      1440: { status: 'accepted', delivery_status: 'entregue', preparation_status: 'completed', fulfillment: 'delivery', label: 'Entregue' }
    }[width];
    const pricedScenario=template==='pitacco-v2'&&width===1440;
    const scheduled = width === 768 ? new Date(Date.now()+3*3600000).toISOString() : null;
    const area = {latitude:-22.7,longitude:-43.4,radius_m:3000,coverage_type:'circle',polygon:[]};
    await page.context().grantPermissions(['geolocation']);
    await page.context().setGeolocation({latitude:-22.71,longitude:-43.4});
    let identityName='Loja de teste';
    let publicBlocked=template==='pitacco-v2'&&width===375;
    let rejectPriorityOnce=false;
    const openingFixture=()=>publicBlocked?{open:false,reason:'paused',paused:true,next_open_at:null,scheduling_available:false}:{open:true,reason:'open',next_open_at:null,timezone:'America/Sao_Paulo',scheduling_available:Boolean(scheduled),paused:false};
    let polls=0,quoteAttempts=0,recoveryConfirmed=false;
    let savedProfile=null;
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    const requests = [];
    const recordedOrders = new Map();
    const quotes = new Map();
    let releaseResponse;
    const responseGate = new Promise(resolve => { releaseResponse = resolve; });
    await page.route('**/*', async route => {
      const { pathname, origin: routeOrigin } = new URL(route.request().url());
      if (routeOrigin === origin && ['/cardapio/', '/loja-teste'].includes(pathname)) {
        return route.fulfill({ contentType: 'text/html', body: menuPage });
      }
      if (routeOrigin === origin && pathname === '/assets/delivery-map.mjs') {
        return route.fulfill({contentType:'text/javascript',body:mapFixture});
      }
      if (routeOrigin === origin && pathname === '/acompanhar/') {
        return route.fulfill({ contentType: 'text/html', body: trackingPage });
      }
      if (routeOrigin === 'https://esm.sh') {
        return route.fulfill({
          contentType: 'text/javascript',
          headers: { 'access-control-allow-origin': '*' },
          body: `export function createClient(){
            const invoke=async (name,payload)=>{
              const response=await fetch('/fixture/' + name,{method:'POST',body:JSON.stringify(payload)});
              const data=await response.json();
              return {status:response.status,data:response.ok?data:null,error:response.ok?null:{message:'Edge Function returned a non-2xx status code',context:new Response(JSON.stringify(data))}};
            };
            return {rpc:invoke,functions:{invoke:async (name,options)=>invoke(name,options.body)}};
          }`
        });
      }
      if (routeOrigin !== origin || !pathname.startsWith('/fixture/')) return route.abort();

      if (pathname.endsWith('/get_public_menu')) {
        assert.equal(route.request().postDataJSON().p_slug,'loja-teste');
        return route.fulfill({ json: {
          store: { appearance:{template,primary:'#217c5a'}, primary_color:'#e04020', name: identityName, delivery_enabled: true, pickup_enabled: true,
            delivery_fee: 0, route_pricing:{enabled:true,mode:'circle',max_radius_km:3},
            delivery_area:area, payment_methods: width===1440?['pix_manual','dinheiro','cartao_entrega','pix_maquininha','voucher_alelo','voucher_pluxee','voucher_vr','voucher_ticket']:['pix_manual'],
            payment_price_rules:width===1440?{cartao_credito:{adjustment_bps:300,revision:1},pix_maquininha:{adjustment_bps:-500,revision:1},...(pricedScenario?{pix_manual:{adjustment_bps:-500,revision:2}}:{})}:{},
            opening_hours:openingFixture() },
          products: [{ id: 'acai', name: 'Açaí', category: 'Açaís', price: 20, option_groups: [{
            id: 'adicionais', name: 'Adicionais', min: 1, max: 1,
            options: [{ id: 'morango', name: 'Morango', price: 2 }, { id: 'leite', name: 'Leite em pó', price: 3 }]
          }, {
            id:'extras',name:'Extras',min:0,max:2,options:[{id:'granola',name:'Granola',price:1},{id:'banana',name:'Banana',price:0},{id:'mel',name:'Mel',price:0}]
          }] },{id:'agua',name:'Água',category:'Bebidas',price:5,option_groups:[]},{id:'pizza',name:'Pizza Teste',category:'Pizzas',price:49.90,option_groups:[],pizza_config:{rule:'avg',sizes:[{id:'g',name:'Grande',diameter:35,slices:8,maxFlavors:2}],flavors:[{id:'a',name:'Calabresa',prices:{g:4990}},{id:'b',name:'Frango',prices:{g:5999}}],extras:[{id:'e',kind:'Borda',name:'Catupiry',prices:{g:500}}]}}]
        } });
      }
      if(pathname.endsWith('/pitacco_v2_customer_profile')){
        const data=route.request().postDataJSON();
        assert.equal(data.p_slug,'loja-teste');
        assert.match(data.p_device,/^[0-9a-f-]{36}$/);
        if(data.p_action==='load')return route.fulfill({json:savedProfile?{found:true,...savedProfile}:{found:false,addresses:[]}});
        assert.equal(data.p_action,'save');
        savedProfile={name:data.p_name,addresses:data.p_addresses||[]};
        return route.fulfill({json:{found:true,...savedProfile}});
      }
      if(pathname.endsWith('/pitacco_public_checkout_recovery'))return route.fulfill({json:recoveryConfirmed?{confirmed:true,order_id:orderId,tracking_token:token,total:74}:{confirmed:false}});
      if(pathname.endsWith('/pitacco_public_top_sellers')){
        assert.equal(route.request().postDataJSON().p_slug,'loja-teste');
        return route.fulfill({json:['acai','agua']});
      }
      if(pathname.endsWith('/pitacco_fiado_checkout_status')){
        const args=route.request().postDataJSON();
        assert.equal(args.p_slug,'loja-teste');
        assert.ok(Number(args.p_order_total)>=0,'Backend recebe valor do carrinho (apenas para UI)');
        if(width===375&&args.p_phone==='21999999999')
          return route.fulfill({json:{visible:true,enabled:Number(args.p_order_total)<=80}});
        if(width===375&&args.p_phone==='21999999998')
          return route.fulfill({json:{visible:true,enabled:false,message:'Fiado indisponível para este pedido.'}});
        return route.fulfill({json:{visible:false,enabled:false}});
      }
      if(pathname.endsWith('/pitacco_public_store_open')){
        assert.equal(route.request().postDataJSON().p_slug,'loja-teste');
        return route.fulfill({json:openingFixture()});
      }
      if(pathname.endsWith('/pitacco_public_schedule_slots')){
        assert.equal(route.request().postDataJSON().p_fulfillment,'delivery');
        return route.fulfill({json:scheduled?[scheduled]:[]});
      }
      if (pathname.endsWith('/delivery-quote')) {
        const payload=route.request().postDataJSON();
        assert.equal(payload.slug,'loja-teste');
        assert.match(payload.address,/^Rua (Teste|Fora Entrega), 123, Centro, Nova Iguaçu, RJ/);
        if(payload.address.startsWith('Rua Fora Entrega'))
          return route.fulfill({status:422,json:{error:'Este endereço está fora do círculo de entregas da loja.'}});
        if(++quoteAttempts===1)return route.fulfill({status:409,json:{error:'Existe uma região poligonal inválida. Corrija em Área de Entrega.'}});
        if(payload.latitude!==undefined||payload.longitude!==undefined)
          assert.deepEqual([payload.latitude,payload.longitude],[-22.71,-43.4]);
        else
          assert.equal(payload.latitude,undefined,'Endereço completo cota sem ponto obrigatório em todos os templates');
        if(payload.delivery_service==='priority'&&rejectPriorityOnce){rejectPriorityOnce=false;return route.fulfill({status:409,json:{error:'Entrega prioritária indisponível nesta região. Selecione a entrega padrão.'}});}
        quotes.set(payload.request_id,{fee:payload.delivery_service==='priority'?9:5,service:payload.delivery_service});
        return route.fulfill({json:{quote_id:'30000000-0000-0000-0000-000000000011',
          request_id:payload.request_id,fee:payload.delivery_service==='priority'?9:5,distance_m:1112,distance_type:'straight',
          delivery_service:payload.delivery_service,delivery_min_minutes:payload.delivery_service==='priority'?20:40,
          delivery_max_minutes:payload.delivery_service==='priority'?30:60,
          delivery_options:{standard:{fee:5,min_minutes:40,max_minutes:60},priority:{fee:9,min_minutes:20,max_minutes:30}},
          expires_at:new Date(Date.now()+5*60*1000).toISOString()}});
      }
      if (pathname.endsWith('/pitacco_checkout_quoted_delivery')||pathname.endsWith('/pitacco_confirm_priced_public_checkout')) {
        assert.equal(pathname.endsWith('/pitacco_confirm_priced_public_checkout'),pricedScenario,'Adjusted checkout requires the price confirmation endpoint');
        assert.equal(route.request().postDataJSON().p_quote,'30000000-0000-0000-0000-000000000011');
        requests.push(route.request().postDataJSON());
        const payload=route.request().postDataJSON();
        const quote=quotes.get(payload.p_request);
        assert.ok(quote,'Checkout uses the original quote request');
        assert.equal(quote.service,width===1440?'priority':'standard');
        if(pricedScenario){assert.equal(payload.p_expected_cents,7455);assert.equal(payload.p_price_revision,2);assert.equal(payload.p_use_loyalty,false);}
        const saved=recordedOrders.get(payload.p_request);
        if(saved)assert.deepEqual(payload,saved.payload,'Server replay uses the original request and full checkout snapshot');
        else recordedOrders.set(payload.p_request,{payload,receipt:{order_id:orderId,tracking_token:token,total:(template==='classic'?22:69)+quote.fee-(pricedScenario?3.45:0),payment_status:'pending'}});
        if (requests.length === 1) {
          await responseGate;
          return route.fulfill({ status: 503, json: { message: 'Resposta indisponível' } });
        }
        return route.fulfill({ json: recordedOrders.get(payload.p_request).receipt });
      }
      if (pathname.endsWith('/pitacco_track_public_order')) {
        assert.equal(route.request().postDataJSON().p_token, token);
        const courier_position=scheduled
          ? (++polls===1?{state:'available',latitude:-22.851,longitude:-43.453,observed_at:new Date().toISOString()}:{state:'multiple_stops'})
          : null;
        return route.fulfill({ json: { order_id: orderId, total:[...recordedOrders.values()][0]?.receipt.total, scheduled_for:scheduled, delivery_service:width===1440?'priority':'standard', courier_position, ...tracking } });
      }
      return route.abort();
    });

    await page.goto(origin + (width===375?'/cardapio/?loja=loja-teste':'/loja-teste?utm_source=qr&loja=outro'));
    if(publicBlocked){
      await page.locator('#storeOpenStatus').filter({hasText:'Pedidos temporariamente pausados'}).waitFor();
      assert.equal(await page.locator('body.store-closed').count(),1);
      assert.equal(await page.locator('#addProduct').isDisabled(),true);
      assert.equal(await page.locator('#cartDock').isVisible(),false);
      assert.equal(await page.locator('#scheduleBlock').isVisible(),false);
      assert.equal(await page.getByText(/inadimplência/i).count(),0);
      publicBlocked=false;
      await page.evaluate(()=>document.dispatchEvent(new Event('visibilitychange')));
      await page.locator('#v2OpenPill').filter({hasText:'Aberto'}).waitFor();
      assert.equal(await page.locator('body.store-closed').count(),0);
      assert.equal(await page.locator('#addProduct').isDisabled(),false);
      console.log('PASS public storefront pause, financial privacy and live reopening');
    }
    const productCard=page.getByRole('button',{name:'Personalizar Açaí',exact:true});
    await productCard.waitFor();
    // Inspect product-only scrolling without introducing animation races in the tests.
    await page.evaluate(()=>{
      const body=document.getElementById('productBody');
      const nativeScroll=body.scrollTo.bind(body);
      window.productAutoScroll=[];
      body.style.maxHeight='140px';
      body.scrollTo=options=>{
        window.productAutoScroll.push({top:options.top,behavior:options.behavior});
        nativeScroll({...options,behavior:'instant'});
      };
    });
    // Pizza uses the same dialog, cart persistence and option payload in every template.
    const pizzaCard=page.getByRole('button',{name:'Personalizar Pizza Teste',exact:true});
    await pizzaCard.click();
    const pizza=page.getByRole('dialog',{name:'Pizza Teste'});
    await pizza.locator('select').selectOption('g');
    await pizza.getByRole('checkbox',{name:/Calabresa/}).check();
    assert.equal(await page.evaluate(()=>window.productAutoScroll.length),0,'Partial flavor selection must not advance');
    await pizza.getByRole('checkbox',{name:/Frango/}).check();
    const pizzaScroll=await page.evaluate(()=>window.productAutoScroll.slice());
    assert.equal(pizzaScroll.length,1,'Reaching maximum flavors advances to the optional border');
    await pizza.getByRole('radio',{name:/Catupiry/}).check();
    assert.match(await pizza.locator('#productTotal').innerText(),/59,95/);
    await pizza.getByRole('button',{name:/Adicionar à sacola/}).click();
    identityName='Loja com cadastro atualizado';
    await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
    await page.locator('#storeName').filter({hasText:identityName}).waitFor({state:'attached'});
    identityName='Loja de teste';
    await page.reload();
    await productCard.waitFor();
    await page.locator('#openCart').click();
    const pizzaCart=page.getByRole('dialog',{name:'Sua sacola'});
    assert.match(await pizzaCart.innerText(),/59,95/);
    await pizzaCart.getByRole('button',{name:'Editar montagem'}).click();
    await pizza.getByRole('radio',{name:/Sem complemento/}).check();
    assert.match(await pizza.locator('#productTotal').innerText(),/54,95/);
    await pizza.getByRole('button',{name:'Salvar alterações'}).click();
    await pizzaCart.getByRole('button',{name:'Remover Pizza Teste'}).click();
    await page.locator('#closeCart').click();
    // Verify the shared açaí dialog before diverging into template-specific checkout paths.
    await productCard.click();
    const advanceDialog=page.getByRole('dialog',{name:'Açaí'});
    await page.evaluate(()=>{
      window.productAutoScroll=[];
      const body=document.getElementById('productBody');
      const nativeScroll=body.scrollTo.bind(body);
      // Reload creates a new element; reinstall the scroll observer.
      body.style.maxHeight='140px';
      body.scrollTo=options=>{
        window.productAutoScroll.push({top:options.top,behavior:options.behavior});
        nativeScroll({...options,behavior:'instant'});
      };
    });
    await advanceDialog.getByRole('radio',{name:/Morango/}).check();
    const advanceCalls=await page.evaluate(()=>window.productAutoScroll.slice());
    assert.equal(advanceCalls.length,1,'Maximum of one advances to Extras');
    assert.ok(advanceCalls[0].top>0);
    await advanceDialog.getByRole('radio',{name:/Leite em pó/}).check();
    assert.equal(await page.evaluate(()=>window.productAutoScroll.length),1,'Changing a full radio group does not jump');
    await advanceDialog.getByRole('checkbox',{name:/Granola/}).check();
    await advanceDialog.getByRole('checkbox',{name:/Banana/}).check();
    assert.equal(await page.evaluate(()=>window.productAutoScroll.length),1,'Last group must not auto-submit or scroll');
    await advanceDialog.getByRole('checkbox',{name:/Banana/}).uncheck();
    assert.equal(await page.evaluate(()=>window.productAutoScroll.length),1,'Removing an option does not jump');
    assert.equal(await advanceDialog.isVisible(),true);
    await page.locator('#closeProduct').click();
    await page.evaluate(()=>document.getElementById('productBody').style.removeProperty('max-height'));
    if(template==='classic'){
      // Classic has different navigation from V2. Test its real checkout path
      // without asserting V2-only hero, favourites and product cards.
      assert.equal(await page.locator('body').getAttribute('data-menu-template'),'classic');
      await productCard.click();
      const product=page.getByRole('dialog',{name:'Açaí'});
      await product.getByRole('radio',{name:/Morango/}).check();
      await product.getByRole('button',{name:/Adicionar à sacola/}).click();
      await page.locator('#openCart').click();
      const cart=page.getByRole('dialog',{name:'Sua sacola'});
      assert.match(await cart.locator('#total').innerText(),/valor da entrega.*automaticamente/i);
      await cart.getByRole('button',{name:'Continuar para entrega e pagamento'}).click();
      await page.locator('#customer').fill('Cliente Teste');
      await page.locator('#phone').fill('21999999999');
      for(const [id,value] of [['addressStreet','Rua Teste'],['addressNumber','123'],['addressNeighborhood','Centro'],['addressCity','Nova Iguaçu']])
        await page.locator('#'+id).fill(value);
      await page.locator('#addressState').selectOption('RJ');
      assert.equal(await page.locator('#quoteDelivery').isVisible(),false,'O Clássico também não tem botão de frete');
      await page.locator('#routeQuoteStatus').filter({hasText:'A loja precisa revisar'}).waitFor();
      await page.getByRole('button',{name:'Usar minha localização'}).click();
      await page.locator('#routeQuoteStatus').filter({hasText:/Taxa de entrega: R\$.*5,00/}).waitFor();
      await page.locator('#payment').selectOption('pix_manual');
      if(width===1440){
        for(const method of ['dinheiro','cartao_credito','cartao_debito','pix_maquininha','voucher_alelo','voucher_pluxee','voucher_vr','voucher_ticket','pix_manual']){
          await page.locator('#payment').selectOption(method);
          assert.equal(await page.locator('#payment').inputValue(),method);
        }
      }
      assert.match(await page.locator('#total').innerText(),/Taxa de entrega/);
      assert.equal(await page.locator('#send').isDisabled(),false,'Classic pode confirmar apenas com cotação válida');
      await page.locator('#addressStreet').fill('Rua Fora Entrega');
      await page.locator('#routeQuoteStatus').filter({hasText:'Não atendemos essa região'}).waitFor();
      assert.equal(await page.locator('#send').isDisabled(),true,'Classic bloqueia pedidos fora da cobertura');
      await page.locator('#addressStreet').fill('Rua Teste');
      await page.locator('#routeQuoteStatus').filter({hasText:/Taxa de entrega: R\$.*5,00/}).waitFor();
      assert.equal(await page.locator('#send').isDisabled(),false);
      await page.locator('#deliveryServices input[value="priority"]').check();
      await page.locator('#routeQuoteStatus').filter({hasText:/Taxa de entrega: R\$.*9,00.*20–30 min/}).waitFor();
      assert.match(await page.locator('#total').innerText(),/31,00/);
      if(width!==1440){
        await page.locator('#deliveryServices input[value="standard"]').check();
        await page.locator('#routeQuoteStatus').filter({hasText:/Taxa de entrega: R\$.*5,00.*40–60 min/}).waitFor();
      }
      if(scheduled)await page.getByLabel('Quando deseja receber?').selectOption(scheduled);
      await page.getByRole('button',{name:'Confirmar pedido',exact:true}).click();
      await page.getByRole('button',{name:'Enviando…',exact:true}).waitFor();
      await page.locator('#checkout').evaluate(form=>form.requestSubmit());
      releaseResponse();
      await page.getByRole('button',{name:'Tentar novamente',exact:true}).click();
      await page.getByRole('heading',{name:scheduled?'✓ Pedido agendado enviado com sucesso':'Pedido recebido!',exact:true}).waitFor();
      if(scheduled)assert.match(await page.locator('#success').innerText(),/A loja ainda precisa aceitar manualmente/);
      assert.equal(requests.length,2);
      assert.equal(recordedOrders.size,1,'Lost confirmation and retry create one sale');
      assert.deepEqual(requests[0],requests[1]);
      assert.equal(requests[0].p_scheduled_for,scheduled||undefined);
      assert.equal(requests[0].p_payment,'pix_manual');
      assert.match(requests[0].p_address,/Rua Teste, 123, Centro/);
      assert.equal(await page.evaluate(()=>localStorage.getItem('pitacco-cart:loja-teste')),null);
      await page.getByRole('link',{name:'Acompanhar meu pedido'}).click();
      await page.locator('#currentStatus').filter({hasText:tracking.label}).waitFor();
      assert.deepEqual(errors,[]);
      await page.close();
      console.log('PASS classic automatic quote at '+width+'px');
      continue;
    }
    assert.equal(await page.evaluate(()=>document.documentElement.style.getPropertyValue('--brand')),'#217c5a','Published studio palette takes precedence over old branding');
    assert.equal(await page.locator('body').getAttribute('data-menu-template'),'pitacco-v2','Versão 2 é o template principal');
    await page.locator('#v2TopProducts .v2-top-product').first().waitFor();
    assert.equal(await page.locator('#v2TopProducts .v2-top-product').count(),2,'Início mostra exatamente dois destaques');
    assert.equal(await page.locator('.v2-top-badge').first().evaluate(e=>parseFloat(getComputedStyle(e).fontSize)<20),true,'Selo de destaque não herda tamanho da imagem');
    const initialColor=await page.locator('#storeInitial').evaluate(e=>getComputedStyle(e).color);
    if(['essencial','editorial'].includes(template))assert.notEqual(initialColor,'rgb(255, 255, 255)','Inicial escura no cabeçalho claro');else assert.equal(initialColor,'rgb(255, 255, 255)','Inicial clara no cabeçalho escuro');
    const placement=await page.locator('.v2-top-product').first().evaluate(card=>{const photo=card.querySelector('.v2-top-photo').getBoundingClientRect(),details=card.querySelector('.v2-top-product-details').getBoundingClientRect();return {photoLeft:photo.left,detailsLeft:details.left,caption:getComputedStyle(card.querySelector('.v2-top-product-details')).backgroundColor,priceColor:getComputedStyle(card.querySelector('.v2-top-price')).color,addColor:getComputedStyle(card.querySelector('.v2-top-add')).backgroundColor};});
    if(template==='essencial')assert.ok(placement.photoLeft<placement.detailsLeft,'Essencial apresenta a foto à esquerda');
    if(template==='editorial')assert.ok(placement.photoLeft>placement.detailsLeft,'Editorial apresenta a foto à direita');
    if(template==='urbano'){assert.equal(placement.caption,'rgb(23, 35, 48)','Urbano tem legenda escura contrastante');assert.equal(placement.priceColor,'rgb(255, 255, 255)','Preço urbano legível');assert.equal(placement.addColor,'rgb(255, 203, 50)','Controle urbano amarelo');}
    if(template==='essencial'){const order=await productCard.evaluate(card=>({photo:card.querySelector('.product-visual').getBoundingClientRect().left,text:card.querySelector('.product-text').getBoundingClientRect().left}));assert.ok(order.photo<order.text,'Fotos do catálogo Essencial à esquerda');}
    assert.equal(await page.locator('#layout #products .product').count(),3,'Todos os itens aparecem no catálogo abaixo dos destaques');
    await page.getByRole('heading',{name:'Todo o cardápio',exact:true}).waitFor();
    await page.locator('#v2HeaderAbout').click();
    await page.locator('#v2AboutPage').waitFor();
    assert.equal(await page.locator('#v2AboutPage').isVisible(),true);
    await page.getByRole('button',{name:'Cardápio',exact:true}).click();
    await productCard.waitFor();
    const saveFavorite=page.getByRole('button',{name:'Salvar Açaí nos favoritos'});
    await saveFavorite.click();
    await page.getByRole('button',{name:'♡ Favoritos',exact:true}).click();
    assert.equal(await productCard.count(),1,'Favoritos locais mantêm produto escolhido');
    await page.getByRole('button',{name:'Cardápio',exact:true}).click();
    await page.getByRole('heading',{name:'Açaís',exact:true}).waitFor();
    assert.equal(await page.getByText('Leite em pó',{exact:true}).isVisible(),false,'Complements stay hidden outside the product dialog');
    await page.getByRole('button',{name:'Bebidas',exact:true}).click();
    await page.getByRole('button',{name:'Personalizar Água',exact:true}).waitFor();
    assert.equal(await productCard.count(),0);
    await page.getByRole('button',{name:'Todos',exact:true}).click();
    await page.getByRole('searchbox',{name:'Buscar no cardápio'}).fill('acai');
    await productCard.waitFor();
    assert.equal(await page.getByRole('button',{name:'Personalizar Água',exact:true}).count(),0);
    await productCard.click();
    const product=page.getByRole('dialog',{name:'Açaí'});
    const add=product.getByRole('button',{name:/Adicionar à sacola/});
    await add.click();
    assert.match(await product.getByRole('alert').innerText(),/Confira as escolhas em Adicionais/);
    await product.getByRole('radio',{name:/Morango/}).check();
    await product.getByRole('checkbox',{name:/Granola/}).check();
    await product.getByRole('checkbox',{name:/Banana/}).check();
    assert.equal(await product.getByRole('checkbox',{name:/Mel/}).isDisabled(),true);
    await product.getByRole('checkbox',{name:/Banana/}).uncheck();
    await product.getByRole('checkbox',{name:/Granola/}).uncheck();
    await product.getByRole('button',{name:'Aumentar quantidade'}).click();
    assert.match(await add.innerText(),/44,00/);
    await add.click();
    await productCard.click();
    await product.getByRole('radio',{name:/Leite em pó/}).check();
    await add.click();
    await page.reload();
    await page.waitForFunction(()=>document.querySelector('#v2DockCount')?.textContent?.includes('3 itens'));
    assert.equal(await page.locator('#cartDraftNotice').isVisible(),false,
      'A sacola deve ser recuperada silenciosamente, sem aviso verde na home');
    await page.locator('#openCart').click();
    assert.equal(await page.locator('#cart .cartline').count(),2);
    assert.equal(await page.locator('#cart input').first().inputValue(),'2');
    const cart=page.getByRole('dialog',{name:'Sua sacola'});
    const firstLine=cart.locator('.cartline').first();
    await firstLine.getByRole('button',{name:'Editar complementos',exact:true}).click();
    assert.equal(await product.getByRole('radio',{name:/Morango/}).isChecked(),true);
    assert.equal(await product.locator('#productQuantity').innerText(),'2');
    await product.getByRole('checkbox',{name:/Granola/}).check();
    assert.match(await product.getByRole('button',{name:/Salvar alterações/}).innerText(),/46,00/);
    await product.getByRole('button',{name:/Salvar alterações/}).click();
    await cart.getByText('Item atualizado na sacola.',{exact:true}).waitFor();
    assert.match(await cart.locator('#total').innerText(),/69,00/);
    assert.match(await cart.locator('#total').innerText(),/valor da entrega.*automaticamente/i);
    await firstLine.getByText(/Morango · Granola/).waitFor();
    await firstLine.getByRole('button',{name:'Editar complementos',exact:true}).click();
    await product.getByRole('checkbox',{name:/Granola/}).uncheck();
    await product.getByRole('button',{name:'Fechar produto',exact:true}).click();
    await firstLine.getByText(/Morango · Granola/).waitFor();
    await page.getByRole('button',{name:'Continuar para entrega e pagamento'}).click();
    const principal=template==='pitacco-v2';
    const fiadoChecked=page.waitForResponse(response=>response.url().endsWith('/fixture/pitacco_fiado_checkout_status')).catch(()=>null);
    if(principal){
      await page.locator('#cartDialog[data-v2-stage="identify"]').waitFor();
      await page.locator('#phone').fill('21999999999');
      await page.locator('#v2CheckoutNext').click();
      await page.locator('#cartDialog[data-v2-stage="customer"]').waitFor();
      await page.locator('#customer').fill('Cliente Teste');
      await page.locator('#v2CheckoutNext').click();
      await page.locator('#cartDialog[data-v2-stage="address"]').waitFor();
    }else{
      await page.locator('#customer').fill('Cliente Teste');
      await page.locator('#phone').fill('21999999999');
    }
    for (const [id,value] of [['addressStreet','Rua Teste'],['addressNumber','123'],['addressNeighborhood','Centro'],['addressCity','Nova Iguaçu']])
      await page.locator('#'+id).fill(value);
    await page.locator('#addressState').selectOption('RJ');
    await fiadoChecked;
    assert.equal(await page.getByRole('button',{name:'Tenho fiado autorizado pela loja'}).count(),0);
    if(!principal){
    assert.equal(await page.getByRole('button',{name:'Tenho fiado autorizado pela loja'}).count(),0);
    assert.equal(await page.locator('#fiadoAuth').isVisible(),false);
    if(width===375){
      await page.locator('#payment option[value="fiado"]').waitFor({state:'attached'});
      await page.locator('#payment').selectOption('fiado');
      assert.equal(await page.locator('#fiadoAuth').isVisible(),true,'PIN solicitado somente ao selecionar Fiado');
      assert.equal(await page.locator('#fiadoPin').count(),1,'Campo de PIN disponível');
      assert.equal(await page.locator('#fiadoPin').getAttribute('type'),'password','O PIN fica mascarado');
      assert.equal(await page.locator('#fiadoPin').getAttribute('required'),'','PIN é obrigatório no Fiado');
      await page.locator('#fiadoPin').fill('438216');
      await page.locator('#payment').selectOption('pix_manual');
      assert.equal(await page.locator('#fiadoAuth').isVisible(),false);
      assert.equal(await page.locator('#fiadoPin').getAttribute('required'),null,'Outros pagamentos não exigem PIN');
      assert.equal(await page.locator('#fiadoPin').inputValue(),'','PIN deve ser apagado ao trocar pagamento');
      const disableFiado=page.waitForResponse(response=>response.url().endsWith('/fixture/pitacco_fiado_checkout_status')).catch(()=>null);
      await page.locator('#phone').fill('21999999998');
      await disableFiado;
      await page.locator('#payment option[value="fiado"]').waitFor({state:'attached'});
      assert.equal(await page.locator('#payment option[value="fiado"]').isDisabled(),true,'Autorizado, mas sem crédito para este pedido');
      assert.match(await page.locator('#fiadoUnavailable').innerText(),/Fiado indisponível para este pedido/);
      assert.doesNotMatch(await page.locator('#fiadoUnavailable').innerText(),/R\$|saldo disponível|limite de crédito/i);
      const hideFiado=page.waitForResponse(response=>response.url().endsWith('/fixture/pitacco_fiado_checkout_status')).catch(()=>null);
      await page.locator('#phone').fill('21999999997');
      await hideFiado;
      assert.equal(await page.locator('#payment option[value="fiado"]').count(),0,'Telefone não autorizado não vê Fiado');
      const showFiado=page.waitForResponse(response=>response.url().endsWith('/fixture/pitacco_fiado_checkout_status')).catch(()=>null);
      await page.locator('#phone').fill('21999999999');
      await showFiado;
      await page.locator('#payment option[value="fiado"]').waitFor({state:'attached'});
      assert.equal(await page.locator('#payment option[value="fiado"]').isDisabled(),false);
    }else{
      assert.equal(await page.locator('#payment option[value="fiado"]').count(),0,'Fiado oculto para telefone não autorizado');
    }
    }
    const pricingChecked=page.waitForResponse(response=>response.url().endsWith('/fixture/pitacco_fiado_checkout_status')).catch(()=>null);
    assert.equal(await page.locator('#quoteDelivery').isVisible(),false,'Nenhum template mostra botão manual de frete');
    assert.equal(await page.locator('#deliveryMapPanel').isVisible(),false,'Mapa opcional começa recolhido');
    await page.locator('#showDeliveryMap').click();
    await page.locator('#deliveryMap[data-show-coverage=false]').waitFor();
    await page.locator('#showDeliveryMap').click();
    assert.equal(await page.locator('#deliveryMapPanel').isVisible(),false);
    await page.locator('#routeQuoteStatus').filter({hasText:'A loja precisa revisar'}).waitFor();
    assert.equal(await page.locator('#routeQuoteStatus').getAttribute('role'),'alert');
    await page.getByRole('button',{name:'Usar minha localização'}).click();
    await page.getByText('Localização confirmada. A taxa será atualizada automaticamente e o endereço poderá ser reutilizado após a entrega.').waitFor();
    await page.locator('#routeQuoteStatus').filter({hasText:/Taxa de entrega: R\$.*5,00/}).waitFor();
    await pricingChecked;
    assert.match(await page.locator('#total').innerText(),/74,00/);
    // O servidor decide a cobertura; fora da região não pode haver valor presumido.
    await page.locator('#addressStreet').fill('Rua Fora Entrega');
    await page.locator('#routeQuoteStatus').filter({hasText:'Não atendemos essa região'}).waitFor();
    assert.equal(await page.locator('#routeQuoteStatus').getAttribute('role'),'alert');
    assert.doesNotMatch(await page.locator('#total').innerText(),/Taxa de entrega.+5,00/i);
    await page.locator('#addressStreet').fill('Rua Teste');
    await page.locator('#routeQuoteStatus').filter({hasText:/Taxa de entrega: R\$.*5,00/}).waitFor();
    assert.match(await page.locator('#total').innerText(),/74,00/);
    if(width===375){await mkdir('artifacts',{recursive:true});await page.locator('#addressBlock').screenshot({path:`artifacts/menu-address-${template}.png`});}
    assert.doesNotMatch(await page.locator('#routeQuoteStatus').innerText(),/non-2xx/);
    // Failure of priority must never remove the standard choice or its known price.
    rejectPriorityOnce=true;
    await page.locator('#deliveryServices input[value="priority"]').check();
    await page.locator('#routeQuoteStatus').filter({hasText:'Entrega prioritária indisponível'}).waitFor();
    assert.match(await page.locator('#standardServiceLabel').innerText(),/5,00/);
    assert.equal(await page.locator('#deliveryServices input[value="standard"]').isVisible(),true);
    await page.locator('#deliveryServices input[value="standard"]').check();
    await page.locator('#routeQuoteStatus').filter({hasText:/Taxa de entrega: R\$.*5,00.*40–60 min/}).waitFor();
    await page.locator('#deliveryServices input[value="priority"]').check();
    await page.locator('#routeQuoteStatus').filter({hasText:/Taxa de entrega: R\$.*9,00.*20–30 min/}).waitFor();
    assert.match(await page.locator('#total').innerText(),/78,00/);
    if(width!==1440){
      await page.locator('#deliveryServices input[value="standard"]').check();
      await page.locator('#routeQuoteStatus').filter({hasText:/Taxa de entrega: R\$.*5,00.*40–60 min/}).waitFor();
    }
    if(scheduled)await page.getByLabel('Quando deseja receber?').selectOption(scheduled);
    if(principal){
      await page.locator('#v2CheckoutNext').click();
      await page.locator('#cartDialog[data-v2-stage="payment"]').waitFor();
      const pixCard=page.locator('#v2PaymentCards [data-kind="pix_manual"]');
      assert.equal(await pixCard.isVisible(),true,'Pix manual cadastrado aparece em card');
      if(width===1440){
        for(const method of ['dinheiro','cartao_credito','cartao_debito','pix_maquininha','voucher_alelo','voucher_pluxee','voucher_vr','voucher_ticket']){
          await page.locator('#v2PaymentCards [data-kind="'+method+'"]').click();
          assert.equal(await page.locator('#payment').inputValue(),method,'Pagamento habilitado pela loja pode ser selecionado');
          if(method==='cartao_credito')assert.match(await page.locator('#total').innerText(),/Acréscimo no pagamento/);
          if(method==='pix_maquininha')assert.match(await page.locator('#total').innerText(),/Desconto no pagamento/);
        }
      }else assert.equal(await page.locator('#v2PaymentCards [data-kind="dinheiro"]').count(),0,'Método não cadastrado não aparece');
      if(width===375){
        const fiadoCard=page.locator('#v2PaymentCards [data-kind="fiado"]');
        await fiadoCard.waitFor();
        await page.locator('#v2PaymentCards [data-kind="fiado"]:not([disabled])').waitFor();
        assert.equal(await fiadoCard.isDisabled(),false,'Fiado elegível aparece habilitado');
        await fiadoCard.click();
        assert.equal(await page.locator('#fiadoPin').isVisible(),true);
        await page.locator('#fiadoPin').fill('438216');
      }
      await pixCard.click();
      assert.equal(await page.locator('#payment').inputValue(),'pix_manual');
      await page.locator('#v2CheckoutNext').click();
      await page.locator('#cartDialog[data-v2-stage="review"]').waitFor();
      assert.match(await page.locator('#v2OrderSummary').innerText(),/Pix manual/);
      if(pricedScenario){assert.match(await page.locator('#v2OrderSummary').innerText(),/Desconto no pagamento/);assert.match(await page.locator('#v2OrderSummary').innerText(),/74,55/);}
    }
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
    await page.getByRole('button', { name: principal?'Finalizar pedido →':'Confirmar pedido' }).click();
    await page.getByRole('button', { name: 'Enviando…' }).waitFor();
    assert.equal(await page.locator('#send').isDisabled(), true);
    assert.equal(await page.locator('#cart').evaluate(element => element.inert), true);
    await page.locator('#checkout').evaluate(form => form.requestSubmit());
    releaseResponse();
    await page.getByRole('button', { name: 'Tentar novamente' }).click();
    await page.getByRole('heading', { name: scheduled?'✓ Pedido agendado enviado com sucesso':principal?'✓ Pedido confirmado!':'Pedido recebido!', exact:true }).waitFor();
    if(scheduled){
      assert.match(await page.locator('#success').innerText(),/A loja ainda precisa aceitar manualmente/);
      assert.equal(await page.getByRole('heading',{name:'✓ Pedido confirmado!',exact:true}).count(),0);
    }
    assert.equal(await page.evaluate(()=>localStorage.getItem('pitacco-cart:loja-teste')),null,'Confirmed order clears saved cart');
    assert.equal(requests.length, 2);
    assert.equal(recordedOrders.size,1,'Lost confirmation and retry create one sale');
    assert.deepEqual(requests[0], requests[1]);
    assert.equal(requests[0].p_payment,'pix_manual');
    assert.match(requests[0].p_address,/Rua Teste, 123, Centro/);
    assert.equal(requests[0].p_scheduled_for,scheduled||undefined);
    assert.equal(requests[0].p_quote,'30000000-0000-0000-0000-000000000011');
    assert.equal(Object.hasOwn(requests[0],'p_latitude'),false);
    assert.deepEqual(requests[0].p_items, [
      { product_id: 'acai', quantity: 2, options: ['morango','granola'] },
      { product_id: 'acai', quantity: 1, options: ['leite'] }
    ]);
    assert.match(await page.locator('#success').innerText(), /Pagamento pendente de confirmação/);
    if(pricedScenario)assert.match(await page.locator('#success').innerText(),/74,55/);
    await page.clock.install();
    await page.getByRole('link', { name: 'Acompanhar meu pedido' }).click();
    await page.locator('#currentStatus').filter({hasText: tracking.label}).waitFor();
    if(scheduled){
      await page.locator('#scheduledFor').filter({hasText:'Entrega agendada para'}).waitFor();
      const map=page.getByRole('link',{name:'Abrir localização aproximada no mapa'});
      await map.waitFor();
      const inlineMap=page.locator('#courierLiveMap');
      await page.locator('#courierLiveMap[data-latitude="-22.851"][data-longitude="-43.453"]').waitFor();
      assert.equal(await inlineMap.isVisible(),true);
      assert.match(await page.locator('#courierLocationStatus').innerText(),/Localização aproximada/);
      const mapUrl=new URL(await map.getAttribute('href'));
      assert.equal(mapUrl.hostname,'www.openstreetmap.org');
      assert.equal(mapUrl.searchParams.get('mlat'),'-22.851');
      assert.equal(mapUrl.searchParams.get('mlon'),'-43.453');
      assert.equal(await map.getAttribute('rel'),'noopener noreferrer');
      await page.clock.fastForward(15001);
      await page.locator('#routeTitle').filter({hasText:'O entregador está realizando uma rota com outras entregas'}).waitFor();
      assert.equal(await map.isVisible(),false);
      assert.equal(await inlineMap.isVisible(),false);
    }
    if (width === 375) assert.equal(await page.locator('#steps li').count(), 0);
    if(width===375){
      await page.evaluate(()=>localStorage.setItem('pitacco-cart:loja-teste',JSON.stringify({version:1,items:[{product_id:'agua',quantity:2,options:[]}],pending_request:'60000000-0000-4000-8000-000000000001'})));
      await page.goto(origin+'/loja-teste');
      await page.locator('#cartDraftText').filter({hasText:'ainda não tem confirmação'}).waitFor();
      assert.equal(await page.locator('#continueCheckout').isDisabled(),true);
      assert.equal(await page.locator('#cart').evaluate(node=>node.inert),true);
      assert.equal(requests.length,2,'Recovery never submits another order');
      recoveryConfirmed=true;
      await page.locator('#checkPendingCart').click();
      await page.locator('#recoveredOrderLink').waitFor();
      assert.equal(await page.evaluate(()=>localStorage.getItem('pitacco-cart:loja-teste')),null);
      assert.equal(requests.length,2);
    }
    assert.deepEqual(errors, []);
    await page.close();
    console.log(`PASS public checkout and tracking at ${width}px`);
  }
} finally {
  await browser.close();
}
