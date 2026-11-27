// Run from the disposable frontend build with playwright installed.
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {createServer} from 'node:http';
import {chromium} from 'playwright';

const store='20000000-0000-4000-8000-000000000001';
const order='40000000-0000-4000-8000-000000000001';
const identity={store_id:store,name:'Loja Fixture',role:'owner'};
const token='a'.repeat(64), attempts=[], pointWrites=[];
let point={id:store,name:identity.name,address:'Rua Fixture',address_number:'10',neighborhood:'Centro',city:'Nova Iguaçu',state:'RJ',postal_code:'26000-000',latitude:null,longitude:null};
const server=createServer(async(req,res)=>{
 const {pathname}=new URL(req.url,'http://127.0.0.1');
 res.setHeader('Content-Type','application/json');
 if(pathname.endsWith('/auth/login'))return res.end(JSON.stringify({access_token:token,token_type:'Bearer',expires_at:new Date(Date.now()+900000).toISOString()}));
 if(req.headers.authorization!=='Bearer '+token){res.statusCode=401;return res.end('{}');}
 const reply=data=>res.end(JSON.stringify(data));
 if(pathname.endsWith('/auth/me'))return reply({id:order,email:'fixture@example.com',stores:[identity]});
 if(pathname.endsWith('/context'))return reply({data:identity});
 if(pathname.endsWith('/operation-settings'))return reply({data:{store_id:store,dispatch_mode:'manual',acceptance_settings:[],print_sectors:[]}});
 if(pathname.endsWith('/map-point')){
  if(req.method==='PUT'){
   const chunks=[];for await(const chunk of req)chunks.push(chunk);
   const proposal=JSON.parse(Buffer.concat(chunks));
   pointWrites.push(proposal);
   point={...point,latitude:proposal.latitude,longitude:proposal.longitude,saved:true};
  }
  return reply({data:point});
 }
 if(pathname.endsWith('/map-origin'))return reply({data:{latitude:-22.85,longitude:-43.45,approximate:true,saved:false,requires_confirmation:true}});
 if(pathname.endsWith('/fleet-map')){res.statusCode=503;return reply({});}
 if(pathname.endsWith('/reprint')){
  const data=[];for await(const chunk of req)data.push(chunk);
  attempts.push(JSON.parse(Buffer.concat(data)));
  if(attempts.length===1){res.statusCode=503;return reply({});}
  return reply({data:{queued:true}});
 }
 const data=pathname.endsWith('/own-board')?[{id:order,store_id:store,source:'proprio',status:'accepted',preparation_status:'ready',created_at:new Date().toISOString(),receipt:{logistics:'retirada',items:[]}}]:[];
 reply({data,limit:100,offset:0});
});
server.listen(8080,'127.0.0.1');
await once(server,'listening');
let browser;
try{
  browser=await chromium.launch({headless:true,executablePath:process.env.PITACCO_CHROMIUM_PATH});
  const page=await browser.newPage();
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/*',route=>route.request().url().startsWith('http://127.0.0.1:4173/')?route.continue():route.abort());
  await page.goto('http://127.0.0.1:4173');
  await page.getByPlaceholder('E-mail').fill('fixture@example.com');
  await page.getByPlaceholder('Senha').fill('fixture-password');
  await page.getByRole('button',{name:'Entrar'}).click();
  await page.getByLabel('Estabelecimento').selectOption(store);
  const reprint=page.getByRole('button',{name:/Reimprimir comanda do pedido/});
  await reprint.click({timeout:10000});
  await page.getByText('Envio à fila não confirmado.',{exact:true}).waitFor();
  await reprint.click();
  await page.getByText('Reimpressão enviada à fila do Windows.',{exact:true}).waitFor();
  assert.equal(attempts.length,2);
  assert.deepEqual(attempts[0],attempts[1]);
  await page.getByRole('heading',{name:'Dados da Loja'}).waitFor();
  await page.getByText('Rua Fixture, 10, Centro, Nova Iguaçu, RJ, 26000-000').waitFor();
  await page.getByRole('button',{name:'Salvar ponto da loja',exact:true}).waitFor();
  assert.deepEqual(pointWrites,[]);
  await page.getByRole('button',{name:'Salvar ponto da loja',exact:true}).click();
  await page.getByText('Ponto exato da loja salvo.',{exact:false}).waitFor();
  assert.deepEqual(pointWrites,[{latitude:-22.85,longitude:-43.45,confirmed:true}]);
  assert.deepEqual(errors,[]);
  console.log('Chromium: reimpressão, falha HTTP, nova tentativa idempotente e confirmação da fila e do marcador aprovadas com API simulada.');
}finally{
 try{await browser?.close();}
 finally{server.close();}
}
