const ownerOrigin = 'https://admin.pitacco.com.br';
const simpleId = /^[A-Za-z0-9_-]{1,140}$/;
const chargeId = /^CHAR_[A-Fa-f0-9-]{10,100}$/;
const paymentId = /^\d{1,30}$/;
const storeId = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const isMatchingAmount = (amount, expected) => Number.isSafeInteger(amount) && amount === expected;

function providerRequest(input) {
  const {provider, reference, token} = input;
  if (typeof token !== 'string' || !/^[A-Za-z0-9._-]{10,512}$/.test(token)) return null;
  const headers = {accept:'application/json', authorization:'Bearer '+token};
  if (provider === 'mercado_pago' && typeof reference === 'string' && paymentId.test(reference) && token.startsWith('TEST-')) {
    return {
      url:'https://api.mercadopago.com/v1/payments/'+reference,
      options:{headers},
      verify: data => ({
        valid:String(data.id)===reference && data.live_mode===false && data.currency_id==='BRL',
        confirmed:data.status==='approved',
        amount:Math.round(Number(data.transaction_amount)*100),
      }),
    };
  }
  if (provider === 'pagbank' && typeof reference === 'string' && chargeId.test(reference)) {
    return {
      url:'https://sandbox.api.pagseguro.com/charges/'+reference,
      options:{headers},
      verify:data=>({
        valid:data.id===reference && data.amount?.currency==='BRL',
        confirmed:data.status==='PAID',
        amount:Number(data.amount?.summary?.paid ?? data.amount?.value),
      }),
    };
  }
  if (provider === 'infinitepay' && [input.handle, reference, input.slug, input.transaction]
    .every(value=>typeof value==='string' && simpleId.test(value))) {
    return {
      url:'https://api.checkout.infinitepay.io/payment_check',
      options:{
        method:'POST',
        headers:{accept:'application/json','content-type':'application/json','x-api-key':token},
        body:JSON.stringify({handle:input.handle,order_nsu:reference,transaction_nsu:input.transaction,slug:input.slug}),
      },
      verify:data=>({valid:data.success===true, confirmed:data.paid===true, amount:Number(data.paid_amount)}),
    };
  }
  return null;
}

export function createPaymentHomologation({supabaseUrl,publicKey,additionalOrigin,fetcher=fetch}) {
  return async request=>{
    const origin=request.headers.get('origin');
    const headers={'cache-control':'no-store',vary:'Origin'};
    if (origin===ownerOrigin || (additionalOrigin && origin===additionalOrigin)) {
      headers['access-control-allow-origin']=origin;
      headers['access-control-allow-methods']='POST, OPTIONS';
      headers['access-control-allow-headers']='authorization, apikey, content-type, x-client-info, x-supabase-api-version';
    }
    const reply=(status,body)=>Response.json(body,{status,headers});
    if(origin&&!headers['access-control-allow-origin'])return reply(403,{error:'Origem indisponível.'});
    if(request.method==='OPTIONS')return new Response(null,{status:204,headers});
    if(request.method!=='POST')return reply(405,{error:'Método indisponível.'});
    const authorization=request.headers.get('authorization');
    if(!authorization?.startsWith('Bearer '))return reply(401,{error:'Entre no Pitacco Admin.'});

    try {
      const signal=AbortSignal.timeout(8000);
      const supabaseHeaders={authorization,apikey:publicKey,'content-type':'application/json'};
      const owner=await fetcher(new URL('/rest/v1/rpc/pitacco_is_platform_owner',supabaseUrl),{
        method:'POST',headers:supabaseHeaders,body:'{}',redirect:'error',signal,
      });
      if(!owner.ok||await owner.json()!==true)return reply(403,{error:'Consulta exclusiva do proprietário do Pitacco.'});
      const input=await request.json().catch(()=>null);
      const operation=input&&providerRequest(input);
      if(!operation||typeof input.store_id!=='string'||!storeId.test(input.store_id)||
          !Number.isSafeInteger(input.expected_cents)||input.expected_cents<1||input.expected_cents>1000000){
        return reply(400,{error:'Confira a loja, a credencial e a referência de teste.'});
      }
      const store=await fetcher(new URL('/rest/v1/rpc/pitacco_admin_homologation_probe',supabaseUrl),{
        method:'POST',headers:supabaseHeaders,body:JSON.stringify({p_store:input.store_id}),redirect:'error',signal,
      });
      if(!store.ok)return reply(403,{error:'Loja indisponível para homologação.'});
      const response=await fetcher(operation.url,{...operation.options,signal,redirect:'error'});
      if(!response.ok)return reply(422,{error:'O provedor não aceitou a consulta. Confira o ambiente, a credencial e a referência.'});
      const payment=operation.verify(await response.json());
      if(!payment.valid)return reply(422,{error:'O provedor não retornou uma transação verificável para esses dados.'});
      return reply(200,{confirmed:payment.confirmed,amount_matches:isMatchingAmount(payment.amount,input.expected_cents)});
    } catch {
      return reply(503,{error:'A consulta ficou indisponível. Tente novamente.'});
    }
  };
}
