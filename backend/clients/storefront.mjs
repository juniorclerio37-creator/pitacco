// Experimental, same-origin API only. No automatic fallback to another backend.
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SLUG=/^[a-z0-9][a-z0-9-]{0,119}$/;
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
  if(!path||!UUID.test(cart?.request_id??'')||cart?.payment!=='pix_manual')return state('invalid');
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
