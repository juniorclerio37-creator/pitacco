// Experimental, same-origin API only. No automatic fallback to another backend.
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SLUG=/^[a-z0-9][a-z0-9-]{0,119}$/;
const PAYMENT_METHODS=new Set(["pix_manual","dinheiro","cartao_credito","cartao_debito","cartao_entrega","pix_maquininha","voucher_alelo","voucher_pluxee","voucher_vr","voucher_ticket"]);
const state=(name,data=null)=>({state:name,data});
function menuPath(slug){
  return typeof slug==='string'&&SLUG.test(slug)?'/api/v1/public/menus/'+slug:null;
}
async function request(path,{fetcher=globalThis.fetch,signal,body,timeoutMs=8000}={}){
  const timeout=AbortSignal.timeout(timeoutMs);
  try{
    const response=await fetcher(path,{
      method:body===undefined?'GET':'POST',
      headers:{Accept:'application/json',...(body===undefined?{}:{'Content-Type':'application/json'})},
      ...(body===undefined?{}:{body:JSON.stringify(body)}),
      cache:'no-store',credentials:'omit',redirect:'error',referrerPolicy:'no-referrer',
      signal:signal?AbortSignal.any([signal,timeout]):timeout
    });
    if(!response.ok)return {status:response.status,data:null};
    const parsed=await response.json();
    return {status:response.status,data:parsed?.data??null};
  }catch{return {status:0,data:null};}
}
function validReceipt(data){
  return data&&UUID.test(data.order_id??'')&&UUID.test(data.tracking_token??'')&&
    (typeof data.total==='number'||typeof data.total==='string'&&/^\d+(\.\d+)?$/.test(data.total))&&
    Number.isFinite(Number(data.total))&&Number(data.total)>=0;
}
export async function readCoreMenu(slug,options={}){
  const path=menuPath(slug);
  if(!path)return state('unavailable');
  const {status,data}=await request(path,{...options,body:undefined});
  if(status===404)return state('unavailable');
  if(status===429)return state('rate_limited');
  if(status!==200||data?.store?.slug!==slug||!Array.isArray(data.products))return state('retry');
  return state('ready',data);
}
export async function placeCoreOrder(slug,cart,options={}){
  const path=menuPath(slug);
  if(!path||!UUID.test(cart?.request_id??'')||!PAYMENT_METHODS.has(cart?.payment))return state('invalid');
  // Caller owns the stable request_id and immutable checkout snapshot across retries.
  // Never generate a replacement ID, replay automatically or switch upstream here.
  const {status,data}=await request(path+'/checkout',{...options,body:cart});
  if(status===200&&validReceipt(data))return state('confirmed',data);
  if(status===422)return state('invalid');
  if(status===409)return state('rejected');
  if(status===429)return state('rate_limited');
  // Timeout, network failure, or malformed success can mean a committed order.
  return state('uncertain');
}
export async function recoverCoreOrder(slug,requestId,options={}){
  const path=menuPath(slug);
  if(!path||!UUID.test(requestId??''))return state('invalid');
  const {status,data}=await request(path+'/checkout/recovery',{...options,body:{request_id:requestId}});
  if(status===200&&data?.confirmed===true&&validReceipt(data))return state('confirmed',data);
  if(status===200&&data?.confirmed===false)return state('not_found');
  if(status===429)return state('rate_limited');
  return state('uncertain');
}

export async function readCoreSchedule(slug,fulfillment,options={}){
  const path=menuPath(slug);
  if(!path||!['pickup','delivery'].includes(fulfillment))return state('invalid');
  const {status,data}=await request(path+'/schedule-slots?fulfillment='+fulfillment,{...options,body:undefined});
  if(status===429)return state('rate_limited');
  if(status===404)return state('unavailable');
  if(status!==200||data?.timezone!=='America/Sao_Paulo'||!Array.isArray(data.slots)||data.slots.length>350)return state('retry');
  let last=-Infinity;
  for(const slot of data.slots){
    if(typeof slot!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}-03:00$/.test(slot))return state('retry');
    const time=Date.parse(slot);
    if(!Number.isFinite(time)||time<=last)return state('retry');
    last=time;
  }
  return state('ready',data);
}

// Compatibility contract for the existing V2 schedule selector only.
export async function readCoreScheduleRpc(args,options={}){
  if(!args||Object.keys(args).sort().join(',')!=='p_fulfillment,p_slug')return {data:null,error:{code:'invalid'}};
  const result=await readCoreSchedule(args.p_slug,args.p_fulfillment,options);
  return result.state==='ready'?{data:result.data.slots,error:null}:{data:null,error:{code:result.state}};
}

export async function readCoreStoreStateRpc(name,args,options={}){
  const resource=name==='pitacco_public_store_open'?'opening':name==='pitacco_public_payment_price_rules'?'payment-prices':null;
  const path=menuPath(args?.p_slug);
  if(!resource||!path||Object.keys(args).join(',')!=='p_slug')return {data:null,error:{code:'invalid'}};
  const {status,data}=await request(path+'/'+resource,{...options,body:undefined});
  if(status!==200||!data||typeof data!=='object'||Array.isArray(data))return {data:null,error:{code:status===429?'rate_limited':status===404?'unavailable':'retry'}};
  if(resource==='opening'&&typeof data.open!=='boolean')return {data:null,error:{code:'retry'}};
  if(resource==='payment-prices'&&Object.values(data).some(r=>!Number.isSafeInteger(r?.adjustment_bps)||!Number.isSafeInteger(r?.revision)))return {data:null,error:{code:'retry'}};
  return {data,error:null};
}
