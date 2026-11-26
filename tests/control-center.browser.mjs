import assert from 'node:assert/strict';
import {readFile,mkdir} from 'node:fs/promises';
import {chromium} from '../web/node_modules/playwright/index.mjs';
const admin='https://admin.pitacco.com.br',api='https://mdevzehqcpcgxspwbiyz.supabase.co';
const user={id:'10000000-0000-4000-8000-000000000099',aud:'authenticated',email:'control-fixture@example.invalid',factors:[]};
const token=[{alg:'HS256'},{sub:user.id,exp:Math.floor(Date.now()/1000)+3600,aal:'aal2'}].map(x=>Buffer.from(JSON.stringify(x)).toString('base64url')).join('.')+'.fixture';
const store={id:'20000000-0000-4000-8000-000000000099',name:'Estabelecimento de teste',city:'Nova Iguaçu',state:'RJ',plan:'complete',status:'active',online:true,registration_complete:true,created_at:'2026-11-01T12:00:00Z',latitude:-22.7,longitude:-43.4};
const targetStore={...store,id:'20000000-0000-4000-8000-000000000098',name:'Destino de teste'};
const series=Array.from({length:7},(_,i)=>({day:'2026-11-'+String(i+20),orders:i*2,revenue:i*5,merchant_gross:i*50,signups:i%3}));
const metrics={observed_at:new Date().toISOString(),stores:{total:1,active:1,online:1,offline:0,free:0,paying:1,trial:0,courtesy:0,suspended:0,overdue:0,new:1,previous_new:0,mrr:59.9},orders:{total:42,previous:21,cancelled:2,completed:38,in_progress:2,gross:1540},channels:[{source:'proprio',orders:42}],couriers:{total:2,online:1},finance:{subscriptions:59.9,commissions:2.1,revenue:62,receivables:59.9,overdue:0,proofs_pending:0,costs:null,cost_entries:0},lifecycle:{measurement_started_at:new Date().toISOString()},cohort:null,forecast:series.map(r=>({day:r.day,receivables:0})),alerts:{operational:0,delivery:0,support:0},series,sources:{sales:'orders isolados de teste',revenue:'liquidações isoladas',mrr:'contratos ativos de teste',costs:'ausência não significa custo zero',online:'horário de abertura verificado'}};
const browser=await chromium.launch({executablePath:process.env.PITACCO_CHROMIUM});
await mkdir('artifacts',{recursive:true});
try{
 for(const width of [375,768,1440]){
  const page=await browser.newPage({viewport:{width,height:960}});page.setDefaultTimeout(15000);const errors=[];page.on('pageerror',e=>errors.push(e.message));const mutations=[],copies=[];const rows={costs:[],notices:[],assistance:[],users:[],devices:[],audit:[],sessions:[],admins:[],settings:[]};let owner=true,failedDashboard=false;
  await page.addInitScript(({user,token})=>localStorage.setItem('sb-mdevzehqcpcgxspwbiyz-auth-token',JSON.stringify({access_token:token,refresh_token:'fixture-refresh',expires_at:Math.floor(Date.now()/1000)+3600,token_type:'bearer',user})),{user,token});
  await page.route('**/*',async route=>{
   const url=new URL(route.request().url()),path=url.pathname,headers={'content-type':'application/json','access-control-allow-origin':'*'};
   if(route.request().method()==='OPTIONS')return route.fulfill({status:200,headers:{...headers,'access-control-allow-headers':'*','access-control-allow-methods':'*'},body:'{}'});
   if(url.origin===admin){
    if(path.startsWith('/api/intelligence/releases'))return route.fulfill({headers,json:{rows:[],observed_at:new Date().toISOString()}});
    if(path==='/api/intelligence/health')return route.fulfill({headers,json:{observed_at:new Date().toISOString(),database_ms:4,worker:'operational'}});
    const file=path==='/'||path==='/index.html'?'web/dist-admin/index.html':'web/dist-admin'+path;
    try{return route.fulfill({contentType:path.endsWith('.js')?'text/javascript':path.endsWith('.css')?'text/css':path.endsWith('.svg')?'image/svg+xml':'text/html',body:await readFile(file)})}catch{return route.fulfill({status:404,body:'Not found'})}
   }
   if(url.origin!==api)return route.abort();
   if(path==='/auth/v1/user')return route.fulfill({headers,json:user});
   if(path==='/auth/v1/logout')return route.fulfill({headers,json:{}});
   if(path==='/auth/v1/token')return route.fulfill({headers,json:{access_token:token,refresh_token:'fixture-refresh',expires_in:3600,token_type:'bearer',user}});
   if(path==='/rest/v1/stores')return route.fulfill({headers,json:[store,targetStore]});
   if(path.startsWith('/rest/v1/rpc/')){
    const fn=path.split('/').at(-1),args=route.request().postDataJSON()||{};
    if(fn==='pitacco_is_platform_owner')return route.fulfill({headers,json:owner});
    if(fn==='pitacco_control_access')return route.fulfill({headers,json:{allowed:true,owner,role:owner?'owner':'observer',modules:owner?[]:['analytics','stores','health'],aal:'aal2'}});
    if(fn==='pitacco_control_dashboard')return route.fulfill(failedDashboard?{status:503,headers,json:{message:'Falha de consulta de teste'}}:{headers,json:metrics});
    if(fn==='pitacco_control_stores'){assert.ok(args.p_page==null||args.p_page>=0);return route.fulfill({headers,json:{rows:!args.p_search||store.name.toLowerCase().includes(args.p_search.toLowerCase())?[store]:[],total:1,page_size:20}})}
    if(fn==='pitacco_control_rows')return route.fulfill({headers,json:{rows:args.p_view==='health'?[{id:'firebase',status:'no_recent_evidence',observed_at:null,source:null,summary:null}]:rows[args.p_view]||[],has_more:false,observed_at:new Date().toISOString()}});
    if(fn==='pitacco_owner_incident_pulse')return route.fulfill({headers,json:{observed_at:new Date().toISOString(),unacknowledged:0,rows:[]}});
    if(fn==='pitacco_control_mutate'){
     mutations.push(args);assert.equal(owner,true);
     if(args.p_action==='cost')rows.costs.unshift({id:'cost',...args.p_data});
     if(args.p_action==='assistance')rows.assistance.unshift({id:'assist',store_id:store.id,store_name:store.name,reason:args.p_data.reason,expires_at:new Date(Date.now()+1800000).toISOString(),own:true});
     return route.fulfill({headers,json:{saved:true,id:'fixture-result'}});
    }
    if(fn==='pitacco_store_registration')return route.fulfill({headers,json:{...store,person_type:'cpf',document:'52998224725',responsible_name:'Titular de teste',administrative_phone:'21900000001',administrative_email:'fixture@example.invalid',whatsapp:'21900000002'}});
    if(fn==='pitacco_owner_copy_media_manifest'){assert.equal(owner,true);return route.fulfill({headers,json:[]});}
    if(fn==='pitacco_owner_copy_catalog'){assert.equal(owner,true);copies.push(args);return route.fulfill({headers,json:{store_id:args.p_target||args.p_request,products:1,groups:1,options:2,pizzas:0,combos:1}});}
    if(fn==='pitacco_owner_operation_rows')return route.fulfill({headers,json:{rows:[],has_more:false}});
    return route.fulfill({headers,json:[]});
   }
   return route.fulfill({headers,json:[]});
  });
  page.on('dialog',d=>d.accept());
  await page.goto(admin);await page.getByRole('heading',{name:'Toda a operação. Sob controle.'}).waitFor();
  assert.equal(await page.locator('.cc-kpi').count(),8);
  assert.equal(await page.getByRole('button',{name:/Recebimentos do Pitacco/}).innerText().then(t=>t.includes('62,00')),true);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+2),true,'Dashboard fits '+width);
  await page.getByRole('button',{name:'Receita Pitacco',exact:true}).click();await page.getByRole('img',{name:'Receita Pitacco no período selecionado'}).waitFor();
  await page.getByRole('button',{name:'Ativar modo escuro',exact:true}).click();assert.equal(await page.locator('.cc-shell.pitacco-theme-dark').count(),1);
  await page.screenshot({path:'artifacts/control-center-dark-'+width+'.png',fullPage:true});
  await page.getByRole('button',{name:'Ativar modo claro',exact:true}).click();
  await page.screenshot({path:'artifacts/control-center-light-'+width+'.png',fullPage:true});
  async function go(name){const nav=page.getByRole('navigation',{name:'Administração geral'});if(width<=800&&!await nav.isVisible())await page.getByRole('button',{name:'Menu administrativo',exact:true}).click();await nav.getByRole('button',{name,exact:true}).click();}
  await go('Estabelecimentos');await page.getByRole('table',{name:'Estabelecimentos',exact:true}).waitFor();await page.getByRole('button',{name:'Abrir '+store.name,exact:true}).click();await page.getByRole('navigation',{name:'Seções do estabelecimento'}).waitFor();
  await page.getByRole('button',{name:'Duplicar loja',exact:true}).click();let copyPanel=page.getByRole('region',{name:'Duplicar loja ou clonar cardápio'});await copyPanel.getByLabel('Nome da nova loja').fill('Nova unidade de teste');await copyPanel.getByRole('button',{name:'Duplicar estabelecimento',exact:true}).click();await copyPanel.getByText('Cópia concluída.',{exact:true}).waitFor();assert.equal(copies[0].p_source,store.id);assert.equal(copies[0].p_target,null);assert.equal(copies[0].p_new_name,'Nova unidade de teste');
  await page.getByRole('button',{name:'Duplicar cardápio',exact:true}).click();await copyPanel.getByLabel('Loja de destino').selectOption(targetStore.id);await copyPanel.getByRole('button',{name:'Clonar cardápio',exact:true}).click();await copyPanel.getByText('Cópia concluída.',{exact:true}).waitFor();assert.equal(copies[1].p_target,targetStore.id);assert.equal(copies[1].p_new_name,null);assert.notEqual(copies[0].p_request,copies[1].p_request);
  await go('Estabelecimentos');await page.getByRole('button',{name:'Duplicar cardápio '+store.name,exact:true}).click();await copyPanel.getByLabel('Loja de destino').waitFor();
  await page.getByRole('navigation',{name:'Seções do estabelecimento'}).getByRole('button',{name:'Assistência',exact:true}).click();await page.getByRole('button',{name:'Solicitar assistência',exact:true}).click();await page.getByLabel('Motivo da solicitação').fill('Investigar uma falha registrada na operação de teste');await page.getByRole('button',{name:'Confirmar e registrar',exact:true}).click();await page.getByText('Aguardando lojista',{exact:true}).waitFor();assert.equal(await page.getByRole('button',{name:'Abrir visão',exact:true}).count(),0,'Consent cannot be bypassed in the UI');
  await go('Custos e despesas');await page.getByRole('button',{name:'Lançar despesa',exact:true}).click();await page.getByLabel('Descrição',{exact:true}).fill('Despesa de teste isolada');await page.getByLabel('Valor em reais').fill('12.50');await page.getByLabel('Competência').fill('2026-11-26');await page.getByLabel('Referência do lançamento').fill('fixture-cost-'+width);await page.getByRole('button',{name:'Confirmar e registrar',exact:true}).click();await page.getByRole('cell',{name:/12,50/}).waitFor();assert.equal(mutations.find(r=>r.p_action==='cost').p_data.amount_cents,1250);
  await go('Saúde da plataforma');await page.getByRole('cell',{name:'Sem evidência recente',exact:true}).waitFor();assert.equal(await page.getByText('Operacional',{exact:true}).count(),0,'Missing telemetry is not displayed as operational');
  await go('Super Dashboard');await page.getByRole('heading',{name:'Toda a operação. Sob controle.'}).waitFor();failedDashboard=true;await page.getByRole('button',{name:'Atualizar Control Center',exact:true}).click();await page.getByRole('alert').filter({hasText:'Falha na atualização'}).waitFor();assert.ok((await page.getByRole('button',{name:/Recebimentos do Pitacco/}).innerText()).includes('62,00'),'A refresh failure keeps the last confirmed snapshot');failedDashboard=false;
  if(width===1440){owner=false;await page.reload();await page.getByRole('heading',{name:'Toda a operação. Sob controle.'}).waitFor();const nav=page.getByRole('navigation',{name:'Administração geral'});assert.equal(await nav.getByRole('button',{name:'Administradores e permissões',exact:true}).count(),0);assert.equal(await nav.getByRole('button',{name:'Financeiro do Pitacco',exact:true}).count(),0);assert.equal(await page.getByRole('button',{name:/Recebimentos do Pitacco/}).isEnabled(),false);}
  assert.deepEqual(errors,[],'No browser exceptions at '+width);await page.close();console.log('PASS Control Center: responsive layout, charts, themes, costs, consent, truthful telemetry and permissions at '+width+'px');
 }
}finally{await browser.close()}
