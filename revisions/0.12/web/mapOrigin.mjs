// Shared merchant-only location helper. Coordinates remain internal to the
// map UI; customers receive only their own secure order tracking.
export function shopPoint(store){
 if(store?.latitude==null||store?.longitude==null)return null;
 const lat=Number(store.latitude),lng=Number(store.longitude);
 return Number.isFinite(lat)&&Number.isFinite(lng)&&Math.abs(lat)<=90&&Math.abs(lng)<=180
  ? [lat,lng] : null;
}
export async function edgeErrorMessage(error,fallback='Não foi possível localizar a loja.'){
 if(!error)return fallback;
 try{
  // Supabase FunctionsHttpError wraps the actual JSON error body in context.
  const context=error.context;
  if(context&&typeof context.json==='function'){
   const result=await context.json();
   if(result?.error&&typeof result.error==='string')return result.error;
  }
 }catch{}
 return error.message==='Edge Function returned a non-2xx status code'
  ? fallback : (error.message||fallback);
}
export async function locateStoreByAddress(client,storeId){
 const pending=inflightOriginRequests.get(storeId);
 if(pending)return pending;
 const job=locateStoreOnce(client,storeId);
 inflightOriginRequests.set(storeId,job);
 try{return await job;}finally{if(inflightOriginRequests.get(storeId)===job)inflightOriginRequests.delete(storeId);}
}
// Two merchant tabs can request the same origin simultaneously; keep only
// one in-flight query per store and always clear the cache after completion.
const inflightOriginRequests=new Map();
async function locateStoreOnce(client,storeId){
 const {data,error}=await client.functions.invoke('delivery-quote',{
  body:{action:'store-origin',store_id:storeId}
 });
 if(error){
  const failure=new Error(await edgeErrorMessage(error,
    'O serviço de localização do endereço está indisponível. Tente novamente mais tarde.'));
  // Supabase FunctionsHttpError exposes a Response at error.context.
  // Network errors may have no status and can be retried once.
  const status=Number(error.context?.status||0);
  failure.status=status;
  failure.retryable=!status||status===429||status>=500;
  failure.retryAfterMs=status===429?8_000:75_000;
  throw failure;
 }
 const latitude=Number(data?.latitude),longitude=Number(data?.longitude);
 if(data?.latitude==null||data?.longitude==null||
    !Number.isFinite(latitude)||!Number.isFinite(longitude)||
    Math.abs(latitude)>90||Math.abs(longitude)>180)
  throw Error(data?.error||'Endereço não localizado. Confira rua, número, bairro e CEP.');
 return {point:[latitude,longitude],approximate:!!data.approximate};
}
