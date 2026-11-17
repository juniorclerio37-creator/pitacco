import test from 'node:test';
import assert from 'node:assert/strict';
import {createPaymentHomologation} from '../supabase/functions/payment-homologation/handler.mjs';

const ownerOrigin='https://admin.pitacco.com.br';
const supabaseUrl='https://db.example.test';
const base={store_id:'20000000-0000-0000-0000-000000000001',expected_cents:1250};
const request=(input,origin=ownerOrigin)=>new Request('https://edge.example.test',{
 method:'POST',headers:{origin,authorization:'Bearer fixture', 'content-type':'application/json'},
 body:JSON.stringify({...base,...input}),
});

test('gateway verification rejects merchants before any provider call',async()=>{
 const handler=createPaymentHomologation({supabaseUrl,publicKey:'fixture',fetcher:async url=>{
  assert.equal(url.pathname,'/rest/v1/rpc/pitacco_is_platform_owner');
  return Response.json(false);
 }});
 const input={provider:'mercado_pago',reference:'123',token:'TEST-fixture1'};
 assert.equal((await handler(request(input))).status,403);
 assert.equal((await handler(request(input,'https://app.pitacco.com.br'))).status,403);
});

test('owner checks existing provider payments and expected amounts without sending charges',async()=>{
 const cases=[
  {
   input:{provider:'mercado_pago',reference:'123',token:'TEST-fixture1'},
   url:'https://api.mercadopago.com/v1/payments/123',response:{id:123,status:'approved',live_mode:false,currency_id:'BRL',transaction_amount:12.50},
   expected:{confirmed:true,amount_matches:true,environment:'sandbox',provider_status:'approved',amount_cents:1250,reference:'123'},
  },
  {
   input:{provider:'pagbank',reference:'CHAR_AAAAAAAA-BBBB',token:'sandbox-fixture'},
   url:'https://sandbox.api.pagseguro.com/charges/CHAR_AAAAAAAA-BBBB',
   response:{id:'CHAR_AAAAAAAA-BBBB',status:'PAID',amount:{currency:'BRL',summary:{paid:1300}}},
   expected:{confirmed:true,amount_matches:false,environment:'sandbox',provider_status:'PAID',amount_cents:1300,reference:'CHAR_AAAAAAAA-BBBB'},
  },
  {
   input:{provider:'infinitepay',reference:'order-123',token:'inchk_fixture',handle:'loja1',slug:'pay-fixture',transaction:'trans-123'},
   url:'https://api.checkout.infinitepay.io/payment_check',
   response:{success:true,paid:false,amount:1250,paid_amount:0},
   expected:{confirmed:false,amount_matches:false},
  },
 ];
 for(const {input,url,response,expected} of cases){
  let calls=0;
  const handler=createPaymentHomologation({supabaseUrl,publicKey:'fixture',fetcher:async (address,options)=>{
   calls++;
   if(calls===1){
    assert.equal(address.pathname,'/rest/v1/rpc/pitacco_is_platform_owner');
    return Response.json(true);
   }
   if(calls===2){
    assert.equal(address.pathname,'/rest/v1/rpc/pitacco_admin_homologation_probe');
    assert.deepEqual(JSON.parse(options.body),{p_store:base.store_id});
    return Response.json({});
   }
   assert.equal(address,url);
   assert.equal(options.redirect,'error');
   if(input.provider==='infinitepay'){
    assert.equal(options.headers['x-api-key'],input.token);
    assert.deepEqual(JSON.parse(options.body),{handle:'loja1',order_nsu:'order-123',transaction_nsu:'trans-123',slug:'pay-fixture'});
   }else{
    assert.equal(options.method,undefined);
    assert.equal(options.headers.authorization,'Bearer '+input.token);
   }
   return Response.json(response);
  }});
  const result=await handler(request(input));
  assert.equal(result.status,200);
  assert.deepEqual(await result.json(),expected);
  assert.equal(calls,3);
 }
});

test('PagBank sandbox order looks up received amounts without treating pending or refunded funds as paid',async()=>{
 const reference='ORDE_AAAAAAAA-BBBB';
 let charges=[{status:'PAID',amount:{currency:'BRL',value:1500,summary:{paid:1500,refunded:250}}}];
 const handler=createPaymentHomologation({supabaseUrl,publicKey:'fixture',fetcher:async(url,options)=>{
  if(url.pathname==='/rest/v1/rpc/pitacco_is_platform_owner')return Response.json(true);
  if(url.pathname==='/rest/v1/rpc/pitacco_admin_homologation_probe')return Response.json({});
  assert.equal(url,'https://sandbox.api.pagseguro.com/orders/'+reference);
  assert.equal(options.method,undefined);
  return Response.json({id:reference,charges,qr_codes:[{amount:{value:1250}}]});
 }});
 const query=()=>handler(request({provider:'pagbank',reference,token:'sandbox-fixture'}));
 assert.deepEqual(await (await query()).json(),{confirmed:true,amount_matches:true,environment:'sandbox',provider_status:'PAID',amount_cents:1250,reference});
 charges=[];
 assert.deepEqual(await (await query()).json(),{confirmed:false,amount_matches:true,environment:'sandbox',provider_status:'WAITING',amount_cents:1250,reference});
});

test('Mercado Pago verifies the test environment before returning numeric payment or Orders status',async()=>{
 const orderId='ORD01JP84C939T20S0P1DN382FQ6K';
 let orderMode=true,liveMode,refunded=false;
 const handler=createPaymentHomologation({supabaseUrl,publicKey:'fixture',fetcher:async(url,options)=>{
  if(url.pathname==='/rest/v1/rpc/pitacco_is_platform_owner')return Response.json(true);
  if(url.pathname==='/rest/v1/rpc/pitacco_admin_homologation_probe')return Response.json({});
  assert.equal(options.method,undefined);
  if(orderMode){
   assert.equal(url,'https://api.mercadopago.com/v1/orders/'+orderId);
   return Response.json({id:orderId,country_code:'BRA',total_amount:'12.50',status:'processed',
    status_detail:refunded?'partially_refunded':'accredited',live_mode:liveMode,
    transactions:{payments:[{payment_method:{ticket_url:'https://www.mercadopago.com.br/sandbox/payments/123/ticket'}}]}});
  }
  assert.equal(url,'https://api.mercadopago.com/v1/payments/123');
  return Response.json({id:123,live_mode:liveMode,status:'approved',currency_id:'BRL',transaction_amount:12.5});
 }});
 const query=()=>handler(request({provider:'mercado_pago',reference:orderMode?orderId:'123',token:'APP_USR-sandbox-fixture'}));
 assert.equal((await (await query()).json()).confirmed,true);
 refunded=true;
 assert.equal((await (await query()).json()).confirmed,false);
 liveMode=true;
 assert.equal((await query()).status,422);
 orderMode=false;
 assert.equal((await query()).status,422);
 liveMode=false;
 assert.equal((await (await query()).json()).confirmed,true);
});
