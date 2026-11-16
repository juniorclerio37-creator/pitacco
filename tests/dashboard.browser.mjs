import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { chromium } from '../web/node_modules/playwright/index.mjs';

const dashboard = 'http://localhost:4180';
const api = 'https://pitacco-fixture.supabase.co';
const adminPortal='https://admin.pitacco.com.br';
const realApi='https://mdevzehqcpcgxspwbiyz.supabase.co';
const keys=['alertas','estoque','cardapio','clientes','fideliza','financeiro','caixa','relatorios','motoboys','integracoes','agendamento'];
const user = { id: '10000000-0000-0000-0000-000000000001', aud: 'authenticated', email: 'teste@example.invalid' };
const store = { id: '20000000-0000-0000-0000-000000000001', name: 'Loja de Teste', plan: 'saas' };
const readOnlyStore = { id: '20000000-0000-0000-0000-000000000002', name: 'Loja sem gestão', plan: 'saas' };
const fixtureUsername = '00000000001';
const adminToken = [ {alg:'HS256'}, {sub:user.id, exp:Math.floor(Date.now()/1000)+3600} ]
  .map(part=>Buffer.from(JSON.stringify(part)).toString('base64url')).join('.')+'.Zml4dHVyZQ';
const browser = await chromium.launch({ executablePath: process.env.PITACCO_CHROMIUM });

try {
  for (const width of [375, 768, 1440]) {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    const errors = [];
    let adminMode=false,moduleEnabled=true,ownerMigrationApplied=false,readOnlyChecks=0,failFeatureCheck=false;
    const catalog=[];
    const productId='70000000-0000-0000-0000-000000000001';
    const merchantProduct={id:'70000000-0000-0000-0000-000000000002',store_id:store.id,
      name:'Açaí para editar',price:16.5,cost:0,category:'Açaí',menu_active:true};
    const merchantGroup={id:'70000000-0000-0000-0000-000000000003',name:'Frutas',min:0,max:1,options:[]};
    const menuSettings={slug:'loja-teste',enabled:false,delivery_enabled:true,pickup_enabled:false,delivery_fee:5,
      payment_methods:['dinheiro'],pix_instructions:'',preparation_minutes:30};
    const evidence=[];
    const ingredients = [];
    const movements = [];
    const settlements=[];
    const settlementId='50000000-0000-0000-0000-000000000001';
    const costOrder={order_id:'30000000-0000-0000-0000-000000000003',reference:'D-182',channel:'Delivery próprio',
      created_at:new Date().toISOString(),gross:100,fees:10,direct_cost:null,result:null};
    const appointment = {
      id:'30000000-0000-0000-0000-000000000002', store_id:store.id, status:'pending',
      source:'proprio', gross:30, fees:0, created_at:new Date().toISOString(),
      scheduled_for:new Date(Date.now()+7_200_000).toISOString(),
      scheduled_release_at:new Date(Date.now()+5_400_000).toISOString(),
      receipt:{display_number:'D-181',customer:'Cliente agendado',items:[],payment:'pix_manual'}
    };
    const pendingOrder = {
      id:'30000000-0000-0000-0000-000000000001', store_id:store.id, status:'pending',
      source:'proprio', gross:25, fees:0, created_at:new Date().toISOString(),
      receipt:{display_number:'D-180',customer:'Cliente do pedido',items:'Formato antigo',payment:'pix_manual'}
    };
    page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(({ api,storeId }) => {
      if(window!==window.top)return;
      localStorage.setItem('dg.supabase.url', api);
      localStorage.setItem('dg.supabase.key', 'sb_publishable_fixture_only_123456');
      localStorage.setItem('pitacco:print-options:'+storeId,'{preferência inválida');
    }, { api,storeId:store.id });

    await page.route('**/*', async route => {
      const { pathname, origin } = new URL(route.request().url());
      if (origin === dashboard && (pathname === '/app/' || /^\/(assets\/[A-Za-z0-9_.-]+|pitacco-brand-013\.svg)$/.test(pathname))) {
        const file = pathname === '/app/' ? '/app/index.html' : pathname;
        const contentType = { html:'text/html', js:'text/javascript', css:'text/css', svg:'image/svg+xml' }[file.split('.').at(-1)];
        return route.fulfill({ contentType, body: await readFile(new URL('../web/dist' + file, import.meta.url)) });
      }
      if(origin===adminPortal&&(pathname==='/'||/^\/(assets\/[A-Za-z0-9_.-]+|pitacco-brand-013\.svg)$/.test(pathname))){
        const file=pathname==='/'?'/index.html':pathname;
        const contentType={html:'text/html',js:'text/javascript',css:'text/css',svg:'image/svg+xml'}[file.split('.').at(-1)];
        return route.fulfill({contentType,body:await readFile(new URL('../web/dist-admin'+file,import.meta.url))});
      }
      if (origin !== api && origin !== realApi) return route.abort();
      const headers = {
        'access-control-allow-origin': origin===realApi?adminPortal:dashboard,
        'access-control-allow-headers': 'authorization,apikey,content-type,x-client-info,x-supabase-api-version',
        'access-control-allow-methods': 'GET,POST,OPTIONS'
      };
      if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
      if(pathname==='/functions/v1/platform-owner-login'){
        assert.equal(origin,realApi);
        const {username,password}=route.request().postDataJSON();
        assert.equal(username,fixtureUsername);
        if(password!=='senha-de-teste')return route.fulfill({headers,status:401});
        return route.fulfill({headers,json:{access_token:adminToken,refresh_token:'fixture-owner-refresh'}});
      }
      if(pathname==='/auth/v1/user'&&origin===realApi)return route.fulfill({headers,json:user});
      if(pathname==='/rest/v1/rpc/pitacco_list_products'){
        assert.equal(route.request().postDataJSON().p_store_id,store.id);
        return route.fulfill({headers,json:catalog});
      }
      if(pathname==='/rest/v1/products')return route.fulfill({headers,json:[merchantProduct]});
      if(pathname==='/rest/v1/rpc/pitacco_list_complements'){
        assert.deepEqual(route.request().postDataJSON(),{p_store_id:store.id,p_product_id:merchantProduct.id});
        return route.fulfill({headers,json:[merchantGroup]});
      }
      if(pathname==='/rest/v1/rpc/pitacco_save_option'){
        const input=route.request().postDataJSON();
        const id='70000000-0000-0000-0000-000000000004';
        const updating=merchantGroup.options.length>0;
        assert.deepEqual(input,{p_store_id:store.id,p_group_id:merchantGroup.id,p_option_id:updating?id:null,
          p_name:'Banana',p_price:updating?3:2.5,p_available:!updating});
        merchantGroup.options=[{id,name:input.p_name,price:input.p_price,available:input.p_available}];
        return route.fulfill({headers,json:id});
      }
      if(pathname==='/rest/v1/rpc/pitacco_save_product'){
        assert.ok(adminMode);
        const input=route.request().postDataJSON();
        assert.deepEqual(input,{p_store_id:store.id,p_product_id:null,p_name:'Açaí 500 ml',p_category:'Açaí',
          p_description:'',p_price:16.5,p_cost:0,p_menu_active:true});
        catalog.push({id:productId,name:input.p_name,category:input.p_category,description:'',
          price:input.p_price,cost:input.p_cost,menu_active:input.p_menu_active});
        return route.fulfill({headers,json:productId});
      }
      if(pathname==='/rest/v1/rpc/pitacco_owner_menu_settings'){
        assert.equal(route.request().postDataJSON().p_store,store.id);
        return route.fulfill({headers,json:menuSettings});
      }
      if(pathname==='/rest/v1/rpc/save_public_menu_settings'){
        const input=route.request().postDataJSON();
        assert.equal(input.p_store,store.id);
        assert.equal(input.p_delivery_fee,7.50);
        return route.fulfill({headers,json:null});
      }
      if(pathname==='/rest/v1/rpc/pitacco_save_preparation_minutes'){
        assert.deepEqual(route.request().postDataJSON(),{p_store:store.id,p_minutes:45});
        return route.fulfill({headers,json:45});
      }
      if(pathname==='/rest/v1/rpc/is_admin')throw new Error('O painel do proprietário consultou a permissão legada');
      if(pathname==='/rest/v1/rpc/is_store_manager'){
        assert.equal(origin,api);
        const {s}=route.request().postDataJSON();
        assert.ok([store.id,readOnlyStore.id].includes(s));
        if(s===readOnlyStore.id&&readOnlyChecks++===0){
          return route.fulfill({headers,status:503,json:{message:'Consulta indisponível'}});
        }
        return route.fulfill({headers,json:s===store.id});
      }
      if(pathname==='/rest/v1/rpc/pitacco_is_platform_owner'){
        if(!ownerMigrationApplied)return route.fulfill({headers,status:404,json:{code:'PGRST202',message:'Função indisponível'}});
        return route.fulfill({headers,json:adminMode});
      }
      if(pathname==='/rest/v1/rpc/pitacco_store_features'){
        if(failFeatureCheck)return route.fulfill({headers,status:503,json:{message:'Funções indisponíveis'}});
        const flags=Object.fromEntries(keys.map(key=>[key,key!=='estoque'||moduleEnabled]));
        return route.fulfill({headers,json:flags});
      }
      if(pathname==='/rest/v1/rpc/pitacco_owner_feature_settings'){
        assert.ok(adminMode);
        return route.fulfill({headers,json:Object.fromEntries(keys.map(key=>[key,{default_enabled:true,override:key==='estoque'&&!moduleEnabled?false:null}]))});
      }
      if(pathname==='/rest/v1/rpc/pitacco_owner_set_feature'){
        assert.ok(adminMode);
        assert.deepEqual(route.request().postDataJSON(),{p_store:store.id,p_feature:'estoque',p_enabled:false});
        moduleEnabled=false;
        return route.fulfill({headers,json:null});
      }
      if(pathname==='/rest/v1/rpc/pitacco_admin_homologation_results')return route.fulfill({headers,json:evidence});
      if(pathname==='/rest/v1/rpc/pitacco_admin_homologation_probe'){
        assert.equal(route.request().postDataJSON().p_store,store.id);
        return route.fulfill({headers,json:{menu_slug:'loja-teste',menu_has_checkout:true,has_active_products:true,sandbox_store_linked:true}});
      }
      if(pathname==='/functions/v1/asaas-homologation'){
        assert.deepEqual(route.request().postDataJSON(),{store_id:store.id,payment_id:'pay_test'});
        return route.fulfill({headers,json:{outcome:'checked',confirmed:true,plan_amount:true,sandbox_enabled:true,linked:true,recorded:false}});
      }
      if(pathname==='/rest/v1/rpc/pitacco_admin_record_homologation'){
        assert.ok(adminMode);
        const input=route.request().postDataJSON();
        assert.equal(input.p_store,store.id);
        assert.equal(input.p_scope,'asaas');
        assert.equal(input.p_outcome,'pending');
        assert.ok(input.p_request);
        evidence.unshift({id:901,store_name:store.name,scope:input.p_scope,outcome:input.p_outcome,notes:input.p_notes,recorded_at:new Date().toISOString()});
        return route.fulfill({headers,json:901});
      }
      if (pathname === '/auth/v1/signup') return route.fulfill({ headers, json: { user: { ...user, identities: [] }, session: null } });
      if (pathname === '/auth/v1/token') {
        return route.fulfill({ headers, json: { user, access_token:'fixture-access', refresh_token:'fixture-refresh', token_type:'bearer', expires_in:3600 } });
      }
      if (pathname === '/rest/v1/profiles') return route.fulfill({ headers, json: { ...user, role:adminMode||width===375?'admin':'gestor' } });
      if (pathname === '/rest/v1/store_members') return route.fulfill({headers,json:[]});
      if (pathname === '/rest/v1/orders') {
        const filters = new URL(route.request().url()).searchParams;
        if(width===375 && filters.has('scheduled_release_at')){
          return route.fulfill({headers,status:400,json:{code:'42703',message:'column orders.scheduled_release_at does not exist'}});
        }
        const filter=filters.get('status');
        const orders = (width===375?[pendingOrder]:[pendingOrder,appointment]).filter(order=>!filter||filter.includes(order.status));
        return route.fulfill({headers,json:orders});
      }
      if (pathname === '/rest/v1/pitacco_schedule_windows') {
        if(route.request().method()==='POST'){
          const days=route.request().postDataJSON();
          assert.equal(days.length,7);
          assert.equal(days[0].enabled,true);
          assert.ok(days.every(day=>day.store_id===store.id));
        }
        return route.fulfill({headers,json:[]});
      }
      if (pathname === '/rest/v1/rpc/pitacco_store_subscription_status') {
        assert.equal(route.request().postDataJSON().p_store,store.id);
        return route.fulfill({headers,json:{
          status:'overdue',trial_ends_at:new Date(Date.now()-3600000).toISOString(),
          orders_blocked:true,regularization_url:'https://billing.example.invalid/'
        }});
      }
      if (pathname === '/rest/v1/rpc/pitacco_operational_alerts') {
        assert.equal(route.request().postDataJSON().p_store,store.id);
        return route.fulfill({headers,json:{
          couriers:{available:0,unavailable:2,recent_gps:0},
          events:[{code:'preparation_late',entity_id:pendingOrder.id,reference:'D-180',target:'Pedidos',event_at:new Date().toISOString()}]
        }});
      }
      if(pathname==='/rest/v1/pitacco_marketplace_settlements')return route.fulfill({headers,json:settlements});
      if(pathname==='/rest/v1/rpc/pitacco_import_marketplace_settlement'){
        const input=route.request().postDataJSON();
        assert.equal(input.p_store,store.id);
        assert.deepEqual(input.p_lines,[{external_order:'001',net:'22.50'}]);
        settlements.push({id:settlementId,provider:input.p_provider,account_reference:input.p_account,settlement_reference:input.p_reference,settled_on:input.p_settled_on});
        return route.fulfill({headers,json:settlementId});
      }
      if(pathname==='/rest/v1/rpc/pitacco_marketplace_settlement_report'){
        assert.equal(route.request().postDataJSON().p_settlement,settlementId);
        return route.fulfill({headers,json:[{external_order:'001',reported_net:22.50,recorded_net:24,difference:-1.50,status:'different'}]});
      }
      if (pathname === '/rest/v1/rpc/pitacco_period_financial_report') {
        const payload = route.request().postDataJSON();
        assert.equal(payload.p_store, store.id);
        return route.fulfill({headers,json:[
          {metric:'vendas', channel:'Delivery próprio', entries:2, amount:73},
          {metric:'recebimentos', channel:null, entries:1, amount:22}
        ]});
      }
      if(pathname==='/rest/v1/rpc/pitacco_order_profit_report'){
        const input=route.request().postDataJSON();
        assert.equal(input.p_store,store.id);
        assert.equal(input.p_page,0);
        return route.fulfill({headers,json:[costOrder]});
      }
      if(pathname==='/rest/v1/pitacco_order_costs'){
        const input=route.request().postDataJSON();
        assert.deepEqual(input,{order_id:costOrder.order_id,store_id:store.id,goods_cost:'22',
          processing_fees:'3',delivery_cost:'8',other_cost:'2',merchant_discount:'5'});
        Object.assign(costOrder,input,{direct_cost:35,result:55});
        return route.fulfill({headers,status:201});
      }
      if (pathname === '/rest/v1/rpc/pitacco_decide_pending_order') {
        const payload = route.request().postDataJSON();
        assert.deepEqual(payload,{p_order:pendingOrder.id,p_status:'rejected',p_reason:'Item indisponível'});
        pendingOrder.status = payload.p_status;
        return route.fulfill({headers,json:null});
      }
      if(pathname==='/rest/v1/stores'){
        return route.fulfill({headers,json:origin===api&&width===1440?[store,readOnlyStore]:[store]});
      }
      if (pathname === '/rest/v1/couriers' && route.request().headers().accept?.includes('object')) {
        return route.fulfill({ headers, json: null });
      }
      if (pathname === '/rest/v1/pitacco_ingredients') {
        if (route.request().method() === 'POST') {
          const payload = route.request().postDataJSON();
          assert.equal(payload.store_id, store.id);
          ingredients.push({...payload, id:'fixture-ingredient', balance:0});
        }
        return route.fulfill({headers,json:ingredients});
      }
      if (pathname === '/rest/v1/pitacco_stock_movements') {
        if (route.request().method() === 'POST') {
          const payload = route.request().postDataJSON();
          assert.equal(payload.store_id, store.id);
          assert.equal(payload.ingredient_id, ingredients[0].id);
          ingredients[0].balance += payload.quantity;
          movements.push({...payload, created_at:new Date().toISOString()});
        }
        return route.fulfill({headers,json:movements});
      }
      return route.fulfill({ headers, json: [] });
    });

    await page.goto(dashboard + '/app/');
    await page.getByRole('button', { name:'Criar uma conta' }).click();
    await page.getByPlaceholder('Seu nome').fill('Pessoa Teste');
    await page.getByPlaceholder('E-mail', { exact:true }).fill(user.email);
    await page.getByPlaceholder('Senha (mínimo 6 caracteres)').fill('senha-de-teste');
    await page.getByRole('button', { name:'Cadastrar', exact:true }).click();
    await page.getByText(/confirme o cadastro pelo link enviado/).waitFor();
    await page.getByRole('heading', { name:'Entrar na plataforma' }).waitFor();
    await page.getByPlaceholder('E-mail', { exact:true }).fill(user.email);
    await page.getByPlaceholder('Senha (mínimo 6 caracteres)').fill('senha-de-teste');
    await page.getByRole('button', { name:'Entrar', exact:true }).click();
    await page.locator('.store-identity-copy').getByText(store.name, { exact:true }).waitFor({ state:'attached' });
    await page.getByRole('heading',{name:'Visão Geral',exact:true}).waitFor();

    const navigation = page.getByRole('navigation', { name:'Menu principal' });
    if (width <= 800) {
      assert.equal(await navigation.isVisible(), false);
      await page.getByRole('button', { name:'Abrir menu' }).click();
      await navigation.waitFor({ state:'visible' });
    }
    await navigation.getByRole('button', { name:'Visão Geral', exact:true }).click();
    await page.getByRole('heading', { name:'Visão Geral', exact:true }).waitFor();
    await page.getByRole('region',{name:'Indicadores da loja'}).getByText('Ticket médio',{exact:true}).waitFor();
    await page.getByRole('group',{name:'Indicador do gráfico'}).getByRole('button',{name:'Pedidos'}).click();
    await page.getByRole('img',{name:'Gráfico de pedidos registrados'}).waitFor();
    await page.getByRole('combobox',{name:'Período da visão geral'}).selectOption('7');
    await page.getByRole('heading',{name:'Movimento por dia'}).waitFor();
    if (width <= 800) assert.equal(await navigation.isVisible(), false);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    if (width <= 800) await page.getByRole('button', { name:'Abrir menu' }).click();
    await navigation.getByRole('button', { name:'Estoque', exact:true }).click();
    const inventory = page.getByRole('region', { name:'Controle de estoque' });
    await inventory.getByLabel('Nome').fill('Polpa de açaí');
    await inventory.getByLabel('Estoque mínimo').fill('100');
    await inventory.getByRole('button', { name:'Cadastrar insumo' }).click();
    await inventory.getByText('Estoque baixo', { exact:false }).waitFor();
    await inventory.getByRole('button', { name:'Movimentações', exact:true }).click();
    await inventory.getByLabel('Insumo').selectOption('fixture-ingredient');
    await inventory.getByLabel('Quantidade', { exact:true }).fill('250');
    await inventory.getByLabel('Motivo').fill('Compra de teste');
    await inventory.getByRole('button', { name:'Registrar movimentação' }).click();
    await inventory.getByText(/Compra de teste/).waitFor();
    await inventory.getByRole('button', { name:'Insumos', exact:true }).click();
    await inventory.getByText(/250 g/).waitFor();
    if (width <= 800) await page.getByRole('button', { name:'Abrir menu' }).click();
    await navigation.getByRole('button', { name:'Pedidos', exact:true }).click();
    if(width===375){
      await page.getByRole('button',{name:'Agendados (0)',exact:true}).waitFor();
      await page.getByRole('region',{name:'Central de pedidos',exact:true})
        .locator('.connection-bar').filter({hasText:'Conectado · sincronização ativa'}).waitFor();
    }else{
      await page.getByRole('button', { name:'Agendados (1)', exact:true }).click();
      await page.locator('.pedidos-card').getByText('Cliente agendado').waitFor();
      await page.getByText(/Aceite liberado às/).waitFor();
      assert.equal(await page.getByRole('button',{name:'Aceitar pedido',exact:true}).count(),0);
    }
    await page.getByRole('button', { name:'Pendentes (1)', exact:true }).click();
    await page.getByRole('button', { name:'Recusar pedido', exact:true }).click();
    await page.getByLabel('Motivo da recusa').fill('Item indisponível');
    await page.getByRole('button', { name:'Confirmar recusa', exact:true }).click();
    await page.getByRole('button', { name:'Recusados (1)', exact:true }).click();
    await page.locator('.pedidos-card').getByText('Cliente do pedido').waitFor();
    if(width===768){
      appointment.scheduled_release_at=new Date(Date.now()-1_000).toISOString();
      await page.getByRole('button',{name:'Pendentes (1)',exact:true}).click();
      await page.locator('.pedidos-card').getByText('Cliente agendado').waitFor();
      await page.getByRole('button',{name:'Aceitar pedido',exact:true}).waitFor();
    }
    if (width <= 800) await page.getByRole('button', { name:'Abrir menu' }).click();
    await navigation.getByRole('button', { name:'Relatórios', exact:true }).click();
    const financial = page.getByRole('region', {name:'Relatório financeiro'});
    await financial.getByRole('button', {name:'Gerar relatório'}).click();
    await financial.getByText('Vendas registradas', {exact:true}).waitFor();
    const csv = page.waitForEvent('download');
    await financial.getByRole('button', {name:'Baixar planilha CSV'}).click();
    const file = await csv;
    assert.match(await readFile(await file.path(),'utf8'),/"Vendas registradas";"Delivery próprio";"2";"73,00"/);
    await page.evaluate(()=>{
      const open = window.open;
      window.open = (...argumentsList)=>{
        const preview = open.apply(window,argumentsList);
        preview.print = ()=>{preview.document.body.dataset.printed='true';};
        return preview;
      };
    });
    const popup = page.waitForEvent('popup');
    await financial.getByRole('button', {name:'Salvar como PDF'}).click();
    const preview = await popup;
    await preview.locator('body[data-printed="true"]').waitFor();
    await preview.getByText('Recebimentos confirmados no caixa', {exact:true}).waitFor();
    await preview.close();
    await page.getByRole('button',{name:'Resultado por pedido',exact:true}).click();
    const orderReport=page.getByRole('region',{name:'Resultado por pedido'});
    await orderReport.getByRole('button',{name:'Consultar pedidos'}).click();
    await orderReport.getByText('Aguardando custos',{exact:true}).waitFor();
    await orderReport.getByRole('button',{name:'Editar custos do pedido D-182'}).click();
    const costForm=orderReport.getByRole('form',{name:'Custos do pedido'});
    for(const [label,value] of [['Custo dos produtos','22'],['Taxa de pagamento adicional','3'],
      ['Custo de entrega adicional','8'],['Outros custos diretos','2'],['Desconto informado','5']]){
      await costForm.getByLabel(label,{exact:true}).fill(value);
    }
    await costForm.getByRole('button',{name:'Salvar custos'}).click();
    await orderReport.getByText('Custos salvos.',{exact:true}).waitFor();
    await orderReport.getByRole('cell',{name:/55,00/}).waitFor();
    await page.getByRole('button',{name:'Conciliação de repasses',exact:true}).click();
    const payouts=page.getByRole('region',{name:'Conciliação de repasses'});
    await payouts.getByLabel('Referência da conta').fill('loja-teste');
    await payouts.getByLabel('Referência do repasse').fill('repasse-teste');
    await payouts.getByLabel('Data do repasse').fill('2026-11-12');
    await payouts.getByLabel('Arquivo CSV').setInputFiles({
      name:'repasse.csv',mimeType:'text/csv',buffer:Buffer.from('pedido_externo;repasse_liquido\n001;22,50\n')
    });
    await payouts.getByRole('button',{name:'Importar repasse'}).click();
    await payouts.getByText('Repasse importado.').waitFor();
    await payouts.getByText('Divergente',{exact:true}).waitFor();
    if (width <= 800) await page.getByRole('button', { name:'Abrir menu' }).click();
    await navigation.getByRole('button', { name:'Administrar Loja', exact:true }).click();
    await page.getByRole('button', { name:'Agendamento', exact:true }).click();
    const schedule = page.getByRole('region', {name:'Horários de agendamento'});
    await schedule.getByRole('group',{name:'Segunda-feira',exact:true}).getByRole('checkbox').check();
    await schedule.getByRole('button',{name:'Salvar horários'}).click();
    await schedule.getByText('Horários de agendamento salvos.').waitFor();
    if(width===1440){
      await page.getByRole('button',{name:'Impressão e aceite',exact:true}).click();
      await page.locator('.merchant-print-layout').getByRole('heading',{name:'Impressoras por setor'}).waitFor();
      await page.getByTitle('Pré-visualização HTML da comanda').waitFor();
      await navigation.getByRole('button',{name:'Motoboys',exact:true}).click();
      await page.locator('.courier-overview-grid').getByRole('button',{name:'Abrir acerto'}).waitFor();
    }
    if (width <= 800) await page.getByRole('button', { name:'Abrir menu' }).click();
    await navigation.getByRole('button', { name:'Alertas', exact:true }).click();
    const alerts=page.getByRole('region',{name:'Central de alertas'});
    await alerts.getByText('Preparo acima do prazo',{exact:true}).waitFor();
    await alerts.getByRole('button',{name:'Atualizar alertas'}).click();
    await alerts.getByRole('button',{name:'Abrir pedidos'}).click();
    await page.getByRole('heading',{name:'Pedidos',exact:true}).first().waitFor();
    if (width <= 800) await page.getByRole('button', { name:'Abrir menu' }).click();
    await navigation.getByRole('button', { name:'Financeiro', exact:true }).click();
    await page.getByRole('group',{name:'Seções financeiras'}).getByRole('button',{name:'Assinatura',exact:true}).click();
    const billing=page.getByRole('region',{name:'Situação da assinatura'});
    await billing.getByText('Vencida',{exact:true}).waitFor();
    await billing.getByRole('alert').filter({hasText:'Novos pedidos bloqueados'}).waitFor();
    assert.equal(await billing.getByRole('link',{name:'Regularizar assinatura'}).getAttribute('href'),'https://billing.example.invalid/');
    assert.equal(await page.getByRole('button',{name:'Homologação',exact:true}).count(),0);
    await page.goto(adminPortal);
    async function adminLogin(password='senha-de-teste'){
      await page.getByLabel('Usuário',{exact:true}).fill(fixtureUsername);
      await page.getByLabel('Senha',{exact:true}).fill(password);
      await page.getByRole('button',{name:'Entrar',exact:true}).click();
    }
    await adminLogin('senha-incorreta');
    await page.getByRole('alert').filter({hasText:'Usuário ou senha inválidos.'}).waitFor();
    await adminLogin();
    await page.getByRole('alert').filter({hasText:'Não foi possível verificar sua autorização.'}).waitFor();
    assert.equal(await page.getByRole('navigation',{name:'Administração geral'}).count(),0);
    await page.getByRole('button',{name:'Sair',exact:true}).click();
    ownerMigrationApplied=true;
    await adminLogin();
    await page.getByRole('alert').filter({hasText:'Acesso exclusivo do proprietário'}).waitFor();
    await page.getByRole('button',{name:'Sair',exact:true}).click();
    adminMode=true;
    await adminLogin();
    const platform=page.getByRole('navigation',{name:'Administração geral'});
    await platform.getByRole('button',{name:'Homologação',exact:true}).click();
    const homologation=page.getByRole('region',{name:'Homologação do Pitacco'});
    await homologation.getByLabel('Loja',{exact:true}).selectOption(store.id);
    await homologation.getByRole('button',{name:'Verificar configuração da loja'}).click();
    await homologation.getByRole('link',{name:'Abrir cardápio'}).waitFor();
    await homologation.getByLabel('ID da cobrança de teste').fill('pay_test');
    await homologation.getByRole('button',{name:'Consultar cobrança de teste'}).click();
    await homologation.getByText('Pagamento confirmado pelo Asaas.').waitFor();
    await homologation.getByText('Registro da confirmação no Pitacco pendente.').waitFor();
    await homologation.getByLabel('Observação').fill('Asaas conferido. Aguardando confirmação do webhook.');
    await homologation.getByRole('button',{name:'Salvar resultado'}).click();
    await homologation.getByText('Resultado registrado no histórico.').waitFor();
    await homologation.getByText('Asaas conferido. Aguardando confirmação do webhook.').waitFor();
    await platform.getByRole('button',{name:'Estabelecimentos',exact:true}).click();
    const storeTabs=page.getByRole('navigation',{name:'Seções do estabelecimento'});
    await storeTabs.getByRole('button',{name:'Catálogo',exact:true}).click();
    const productCatalog=page.getByRole('region',{name:'Catálogo do estabelecimento'});
    await productCatalog.getByRole('button',{name:'Novo produto',exact:true}).click();
    const editor=productCatalog.getByRole('form',{name:'Editar produto'});
    await editor.getByLabel('Nome do produto').fill('Açaí 500 ml');
    await editor.getByLabel('Categoria').fill('Açaí');
    await editor.getByLabel('Preço',{exact:true}).fill('16.50');
    await editor.getByRole('checkbox',{name:'Publicar no cardápio'}).check();
    await editor.getByRole('button',{name:'Salvar produto'}).click();
    await productCatalog.getByText('Produto salvo.').waitFor();
    await productCatalog.getByRole('button',{name:'Editar Açaí 500 ml'}).waitFor();
    await storeTabs.getByRole('button',{name:'Checkout',exact:true}).click();
    const checkout=page.getByRole('region',{name:'Checkout do estabelecimento'});
    await checkout.getByLabel('Taxa de entrega').fill('7.50');
    await checkout.getByRole('button',{name:'Salvar checkout',exact:true}).click();
    await checkout.getByText('Configuração do checkout salva.').waitFor();
    await checkout.getByLabel('Tempo de preparo em minutos').fill('45');
    await checkout.getByRole('button',{name:'Salvar tempo de preparo',exact:true}).click();
    await checkout.getByText('Tempo de preparo salvo.').waitFor();
    await storeTabs.getByRole('button',{name:'Agendamento',exact:true}).click();
    const adminSchedule=page.getByRole('region',{name:'Horários de agendamento'});
    await adminSchedule.getByRole('group',{name:'Segunda-feira',exact:true}).getByRole('checkbox').check();
    await adminSchedule.getByRole('button',{name:'Salvar horários',exact:true}).click();
    await adminSchedule.getByText('Horários de agendamento salvos.').waitFor();
    await platform.getByRole('button',{name:'Módulos do lojista',exact:true}).click();
    const modules=page.getByRole('region',{name:'Módulos do painel do lojista'});
    await modules.getByLabel('Aplicar a').selectOption(store.id);
    await modules.getByLabel('Estoque',{exact:true}).selectOption('disabled');
    await modules.getByText('Estoque atualizado.').waitFor();
    adminMode=false;
    await page.goto(dashboard+'/app/');
    await page.getByRole('region',{name:'Indicadores da loja'}).waitFor();
    if(width<=800)await page.getByRole('button',{name:'Abrir menu'}).click();
    await navigation.getByRole('button',{name:'Clientes',exact:true}).waitFor();
    assert.equal(await navigation.getByRole('button',{name:'Estoque',exact:true}).count(),0);
    assert.equal(await page.getByRole('button',{name:'Homologação',exact:true}).count(),0);
    if(width===1440){
      await navigation.getByRole('button',{name:'Meu Cardápio',exact:true}).click();
      await page.waitForURL(url=>url.searchParams.get('aba')==='Produtos');
      await page.reload();
      await page.getByRole('heading',{name:'Editor de cardápio',exact:true}).waitFor();
      await page.getByRole('button',{name:'Editar',exact:true}).click();
      const complements=page.getByRole('region',{name:'Grupos e complementos'});
      await complements.getByLabel('Nome do item',{exact:true}).fill('Banana');
      await complements.getByLabel('Preço adicional (R$)',{exact:true}).fill('2.50');
      await complements.getByRole('button',{name:'Adicionar item',exact:true}).click();
      await complements.getByText('Complemento salvo.',{exact:true}).waitFor();
      await complements.getByRole('button',{name:'Salvar item',exact:true}).waitFor();
      const banana=complements.getByRole('form',{name:'Editar item Banana'});
      await banana.getByLabel('Preço adicional (R$)',{exact:true}).fill('3.00');
      await banana.getByLabel('Disponível',{exact:true}).uncheck();
      await banana.getByRole('button',{name:'Salvar item',exact:true}).click();
      await complements.getByText('Complemento salvo.',{exact:true}).waitFor();
      await page.getByRole('button',{name:'Fechar',exact:true}).click();
      await navigation.getByRole('button',{name:'Pedidos',exact:true}).click();
      await page.getByRole('combobox',{name:'Selecionar loja'}).selectOption(readOnlyStore.id);
      await page.getByRole('alert').filter({hasText:'Não foi possível verificar o acesso à loja.'}).waitFor();
      await page.getByRole('button',{name:'Tentar novamente',exact:true}).click();
      const ordersRegion=page.getByRole('region',{name:'Central de pedidos',exact:true});
      await ordersRegion.getByText('Solicite acesso de gestor para operar pedidos e configurações.').waitFor();
      assert.equal(await ordersRegion.getByRole('button',{name:'Aceitar pedido',exact:true}).count(),0);
      failFeatureCheck=true;
      await page.goto(dashboard+'/app/?aba=Produtos');
      await page.getByRole('alert').filter({hasText:'Não foi possível carregar as funções da loja.'}).waitFor();
      assert.ok(await navigation.getByRole('button',{name:'Visão Geral',exact:true}).isVisible());
      failFeatureCheck=false;
      await page.getByRole('button',{name:'Tentar novamente',exact:true}).click();
      await page.getByRole('heading',{name:'Editor de cardápio',exact:true}).waitFor();
    }
    assert.deepEqual(errors, []);
    await page.close();
    console.log(`PASS dashboard authentication, navigation, inventory, pending order decisions and reports at ${width}px`);
  }
} finally {
  await browser.close();
}
