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
 const {data,error}=await client.functions.invoke('delivery-quote',{
  body:{action:'store-origin',store_id:storeId}
 });
 if(error)throw Error(await edgeErrorMessage(error));
 const latitude=Number(data?.latitude),longitude=Number(data?.longitude);
 if(data?.latitude==null||data?.longitude==null||
    !Number.isFinite(latitude)||!Number.isFinite(longitude)||
    Math.abs(latitude)>90||Math.abs(longitude)>180)
  throw Error(data?.error||'Endereço não localizado. Confira rua, número, bairro e CEP.');
 return {point:[latitude,longitude],approximate:!!data.approximate};
}
