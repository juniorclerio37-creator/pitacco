// Experimental same-origin transport. Not imported by the live storefront.
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export async function readCoreTracking(token,{fetcher=globalThis.fetch,signal}={}){
  if(typeof token!=='string'||!UUID.test(token))return {state:'unavailable',data:null};
  try{
    const timeout=AbortSignal.timeout(5000);
    const response=await fetcher('/api/v1/public/orders/tracking',{
      method:'POST',headers:{'Content-Type':'application/json','Accept':'application/json'},
      body:JSON.stringify({tracking_token:token}),cache:'no-store',
      credentials:'omit',referrerPolicy:'no-referrer',redirect:'error',
      signal:signal?AbortSignal.any([signal,timeout]):timeout
    });
    if(response.status===404)return {state:'unavailable',data:null};
    if(response.status===429)return {state:'rate_limited',data:null};
    if(!response.ok)return {state:'retry',data:null};
    const body=await response.json();
    if(!body?.data||typeof body.data!=='object'||!UUID.test(body.data.order_id??''))return {state:'retry',data:null};
    return {state:'ready',data:body.data};
  }catch{
    // Fail closed: no token, URL, upstream response or error detail in returned errors.
    return {state:'retry',data:null};
  }
}
