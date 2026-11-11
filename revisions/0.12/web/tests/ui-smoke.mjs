// Isolated browser fixtures: never contacts the production database.
import {chromium} from 'playwright';
import {createServer} from 'vite';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
process.env.VITE_SUPABASE_URL='https://pitacco-test.supabase.co';
process.env.VITE_SUPABASE_ANON_KEY='sb_publishable_fixture_only_123456';
const server=await createServer({server:{host:'127.0.0.1',port:4178},logLevel:'error'});await server.listen();
const browser=await chromium.launch({channel:'chrome',headless:true});
const page=await browser.newPage({viewport:{width:1600,height:1000}});
const uid='10000000-0000-0000-0000-000000000001',sid='20000000-0000-0000-0000-000000000001';
const cid='30000000-0000-0000-0000-000000000001';
const store={id:sid,name:'Loja de demonstração',plan:'saas',platform:'',delivery_mode:'propria',max_orders_per_trip:4};
const order=(i,status,preparation_status)=>({id:`40000000-0000-0000-0000-00000000000${i}`,store_id:sid,source:'proprio',status,preparation_status,gross:25,fees:0,created_at:new Date().toISOString(),receipt:{customer:['','Ana · exemplo','Bruno · exemplo','Carla · exemplo','Diego · exemplo'][i],items:[{name:'Açaí 500 ml',quantity:1,unit_price:25}],logistics:'loja'}});
const orders=[order(1,'pending','preparing'),order(2,'accepted','preparing'),order(3,'accepted','ready'),order(4,'accepted','ready')];
const deliveries=orders.slice(1).map((o,i)=>({id:`50000000-0000-0000-0000-00000000000${i}`,order_id:o.id,store_id:sid,customer_name:o.receipt.customer,address:'Endereço de teste',source:'proprio',logistics_provider:'loja',status:i===2?'retirada':'pendente'}));
let assigned=null;let submittedStore=null;let reprintCall=null;const errors=[];page.on('pageerror',e=>errors.push(e.message));
await page.route('https://pitacco-test.supabase.co/**',async route=>{
 const request=route.request(),url=new URL(request.url());let result=[];
 if(url.pathname==='/auth/v1/token')result={access_token:'fixture-access-token',refresh_token:'fixture-refresh',token_type:'bearer',expires_in:3600,user:{id:uid,email:'demo@example.invalid',aud:'authenticated'}};
 else if(url.pathname.endsWith('/profiles'))result={id:uid,email:'demo@example.invalid',role:'admin'};
 else if(url.pathname.endsWith('/stores')){if(request.method()==='POST'){submittedStore=request.postDataJSON();result=[]}else result=[store]}
 else if(url.pathname.endsWith('/orders'))result=orders;
 else if(url.pathname.endsWith('/deliveries'))result=deliveries;
 else if(url.pathname.endsWith('/print_sectors'))result=[{sector:'Cozinha',printer:'Térmica de teste',width:80,copies:1,enabled:true}];
 else if(url.pathname.endsWith('/couriers'))result=request.headers().accept?.includes('object')?null:[{id:cid,store_id:sid,name:'Entregador de teste',fleet_type:'propria',active:true,available:false}];
 else if(url.pathname.includes('/rpc/reprint_order')){reprintCall=request.postDataJSON();result=null}
 else if(url.pathname.includes('/rpc/assign_order_courier')){assigned=request.postDataJSON();const d=deliveries.find(d=>d.id===assigned.p_delivery);d.courier_id=assigned.p_courier;d.status='atribuida';d.batch_id='60000000-0000-0000-0000-000000000001';result=d.batch_id}
 else if(url.pathname.includes('/rpc/set_order_preparation')){const args=request.postDataJSON();orders.find(o=>o.id===args.p_order).preparation_status=args.p_status;result=null}
 else if(url.pathname.includes('/rpc/accept_order')){const args=request.postDataJSON();orders.find(o=>o.id===args.p_order).status='accepted';result=null}
 await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(result)});
});
let smokeStage='login';
try{
 await page.goto('http://127.0.0.1:4178');await page.getByPlaceholder('E-mail',{exact:true}).fill('demo@example.invalid');await page.getByPlaceholder('Senha (mínimo 6 caracteres)').fill('fixture-password');await page.getByRole('button',{name:'Entrar',exact:true}).click();
 // The admin fixture must explicitly enter its linked store before testing orders.
 await page.getByRole('button',{name:'Entrar no ambiente da loja',exact:true}).waitFor({timeout:12000});
 await page.getByRole('button',{name:'Entrar no ambiente da loja',exact:true}).click();
 // The store switch opens the overview (Painel), not the order board.
 await page.getByRole('navigation',{name:'Menu principal'}).getByRole('button',{name:'Pedidos',exact:true}).click();
 smokeStage='orders visible';
 try{await page.getByText('Ana · exemplo',{exact:true}).waitFor({timeout:12000})}catch(e){await fs.mkdir('ui-evidence',{recursive:true});await page.screenshot({path:'ui-evidence/login-diagnostic.png',fullPage:true});throw new Error('Pedido de demonstração não apareceu. URL='+page.url()+'; tela='+JSON.stringify((await page.locator('body').innerText()).slice(0,1600))+'; erros='+JSON.stringify(errors)+'; causa='+e.message)}
smokeStage='reprint';
 const printer=page.locator('.order-card').filter({hasText:'Bruno · exemplo'}).getByRole('button',{name:/Reimprimir comanda do pedido/});
 assert.ok(await printer.isVisible(),'O ícone de reimpressão deve estar visível no cartão de pedido aceito');
 await printer.click();await page.waitForTimeout(300);
 assert.equal(reprintCall?.p_order,orders[1].id,'O ícone deve solicitar a reimpressão do pedido correspondente');
 assert.ok(reprintCall?.p_reason?.length>=5,'A auditoria deve receber motivo automático sem pedir justificativa');
smokeStage='board columns';
 for(const name of ['Em análise','Em preparo','Pronto','Em entrega'])assert.equal(await page.getByRole('heading',{name,exact:true}).count(),1);
 await page.getByRole('button',{name:'+ Nova venda',exact:true}).click();assert.ok(await page.getByPlaceholder('Cliente',{exact:true}).isVisible());
 await page.getByRole('button',{name:'+ Nova venda',exact:true}).click();
smokeStage='store administration';
 await page.getByRole('button',{name:'Administrar Loja',exact:true}).click();await page.getByRole('group',{name:'Configurações da loja'}).getByRole('button',{name:'Impressão e aceite',exact:true}).click();assert.equal(await page.getByRole('button',{name:'Criar pedido',exact:true}).count(),0);assert.ok(await page.getByRole('heading',{name:'Impressoras por setor'}).isVisible());
 // Store smoke must not expect admin-only establishment registration.\nsmokeStage='finance navigation regression';
 const financeErrorsBefore=errors.length;
 await page.getByRole('button',{name:'Financeiro',exact:true}).click();
 await page.waitForTimeout(350);
 assert.ok(await page.getByRole('heading',{name:'Financeiro',exact:true}).isVisible(),'Financeiro deve mostrar seu título sem tela branca');
 assert.ok(await page.locator('main').isVisible(),'Financeiro deve manter a área principal visível');
 assert.ok((await page.locator('main').innerText()).trim().length>80,'Financeiro não pode ficar vazio');
 assert.deepEqual(errors.slice(financeErrorsBefore),[],'Financeiro não pode lançar exceções JavaScript');
 await page.screenshot({path:'ui-evidence/financeiro.png',fullPage:true});
 await page.getByRole('button',{name:'Caixa',exact:true}).click();
 await page.waitForTimeout(250);
 assert.ok((await page.locator('main').innerText()).trim().length>80,'Caixa não pode ficar vazio');
 assert.deepEqual(errors.slice(financeErrorsBefore),[],'Caixa não pode lançar exceções JavaScript');
 await page.getByRole('button',{name:'Pedidos',exact:true}).click();
smokeStage='order acceptance';
 await page.getByRole('button',{name:'Pedidos',exact:true}).click();await page.getByRole('button',{name:'Aceitar pedido',exact:true}).click();await page.waitForTimeout(5500);assert.equal(await page.locator('.preparing .order-card').count(),2);
 await page.locator('.preparing .order-card').filter({hasText:'Bruno · exemplo'}).getByRole('button',{name:'Marcar como pronto'}).click();await page.waitForTimeout(5500);assert.equal(await page.locator('.ready .order-card').count(),2);
 await page.getByRole('textbox',{name:'Buscar pedido'}).fill('Carla');assert.equal(await page.locator('.order-card').count(),1);await page.getByRole('textbox',{name:'Buscar pedido'}).fill('');
 await fs.mkdir('ui-evidence',{recursive:true});await page.screenshot({path:'ui-evidence/pedidos.png',fullPage:true});
smokeStage='dispatch';
 await page.locator('.ready .order-card').filter({hasText:'Carla · exemplo'}).getByRole('button',{name:'Despachar entrega',exact:true}).click();
 await page.getByRole('dialog').getByText('Entregador de teste',{exact:true}).waitFor();assert.equal(await page.getByRole('dialog').getByText('Itens do pedido',{exact:true}).count(),0);assert.ok(await page.getByRole('dialog').getByText('Entrega sob demanda',{exact:true}).isVisible());
 assert.equal(await page.getByRole('dialog').getByText('Alocação automática',{exact:true}).count(),0);
 assert.ok(await page.getByText('Integrações não configuradas',{exact:true}).isVisible());
 await page.getByRole('dialog').getByRole('radio').check();
 await page.getByRole('button',{name:'Confirmar entregador',exact:true}).click();
 await page.getByText('Entregador atribuído. A rota aguarda coleta e saída.',{exact:true}).waitFor();assert.equal(assigned.p_courier,cid);
 await page.screenshot({path:'ui-evidence/entrega-modal.png',fullPage:true});
 await page.getByRole('button',{name:'Fechar',exact:true}).click();
 await page.getByRole('button',{name:'Administrar Loja',exact:true}).click();
 await page.getByRole('group',{name:'Configurações da loja'}).getByRole('button',{name:'Identidade da loja',exact:true}).click();
 await page.screenshot({path:'ui-evidence/minha-loja.png',fullPage:true});
 await page.getByRole('group',{name:'Configurações da loja'}).getByRole('button',{name:'Impressão e aceite',exact:true}).click();
 await page.screenshot({path:'ui-evidence/impressoras.png',fullPage:true});
 assert.deepEqual(errors,[]);console.log('PASS UI: board stages, create toggle, printer separation, neutral store payload, accept, ready, search; no page errors.');
}catch(error){
 await fs.mkdir('ui-evidence',{recursive:true});
 await page.screenshot({path:'ui-evidence/failure-diagnostic.png',fullPage:true}).catch(()=>{});
 const body=await page.locator('body').innerText().catch(()=>'<unavailable>');
 console.error('UI SMOKE FAILURE stage='+smokeStage+'; message='+error.message+'; url='+page.url()+'; visibleText='+JSON.stringify(body.slice(0,2200))+'; pageErrors='+JSON.stringify(errors));
 throw error;
}finally{await browser.close();await server.close()}
