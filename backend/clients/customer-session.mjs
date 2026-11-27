// Preserve the exact existing per-store device credential. No new identity on resume.
const uuid=/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
export function customerSession(slug,{storage=globalThis.localStorage,fetcher=globalThis.fetch}={}){
  if(!/^[a-z0-9][a-z0-9-]{0,119}$/.test(slug))throw Error('Invalid store');
  const key='pitacco-v2-customer-device:'+slug, links='pitacco-device-order-links:'+slug;
  const remembered=()=>{try{const d=storage.getItem(key);return uuid.test(d||'')?d:null}catch{return null}};
  const clear=d=>{try{if(remembered()===d){storage.removeItem(key);storage.removeItem(links)}}catch{}};
  async function run(action){
    const device=remembered();
    if(!device)return {state:'inactive'};
    try{
      const r=await fetcher('/api/v1/public/menus/'+slug+'/profile/session',{method:'POST',headers:{'Content-Type':'application/json',Accept:'application/json'},body:JSON.stringify({device,action}),credentials:'omit',cache:'no-store',redirect:'error',referrerPolicy:'no-referrer',signal:AbortSignal.timeout(8000)});
      if(!r.ok)return {state:'retry'};
      const {data}=await r.json();
      if(remembered()!==device)return {state:'inactive'};
      if(data?.active===false&&data.reset===true){clear(device);return {state:'inactive'}}
      if(action==='resume'&&data?.active===true&&typeof data.name==='string'&&/^\d{10,11}$/.test(data.phone||'')&&Array.isArray(data.addresses)&&Date.parse(data.expires_at)>Date.now())return {state:'active',data};
      return {state:'retry'};
    }catch{return {state:'retry'}}
  }
  return {resume:()=>run('resume'),logout:()=>run('logout')};
}

// Explicit compatibility with V2's existing profile/session/history calls.
// Existing caller owns the device key, UI state and local-storage lifecycle.
export async function customerProfileRpc(name,args,{fetcher=globalThis.fetch,signal}={}){
 const failure=()=>({data:null,error:{code:'retry',message:'Cadastro temporariamente indisponível.'},status:503});
 if(!args||typeof args!=='object'||Array.isArray(args)||typeof args.p_slug!=='string'||!/^[a-z0-9][a-z0-9-]{0,119}$/.test(args.p_slug)||!uuid.test(args.p_device||''))return failure();
 let suffix,body={device:args.p_device,action:args.p_action},allowed=['p_slug','p_device','p_action'];
 if(name==='pitacco_v2_customer_profile'){
  suffix='/profile';allowed.push('p_phone');
  if(!['load','save'].includes(body.action)||typeof args.p_phone!=='string')return failure();
  body.phone=args.p_phone;
  if(body.action==='save'){
   allowed.push('p_name','p_addresses');
   body.name=args.p_name;
   if(Object.hasOwn(args,'p_addresses'))body.addresses=args.p_addresses;
  }
 }else if(name==='pitacco_customer_device_session'){
  suffix='/profile/session';
  if(!['resume','logout'].includes(body.action))return failure();
 }else if(name==='pitacco_customer_device_orders'){
  suffix='/profile/orders';
  if(!['list','link'].includes(body.action))return failure();
  if(body.action==='link'){
   allowed.push('p_tracking');
   if(!uuid.test(args.p_tracking||''))return failure();
   body.tracking=args.p_tracking;
  }
 }else return failure();
 if(Object.keys(args).some(k=>!allowed.includes(k)))return failure();
 try{
  const timeout=AbortSignal.timeout(8000);
  const response=await fetcher('/api/v1/public/menus/'+args.p_slug+suffix,{
   method:'POST',headers:{'Content-Type':'application/json',Accept:'application/json'},
   body:JSON.stringify(body),credentials:'omit',cache:'no-store',redirect:'error',referrerPolicy:'no-referrer',
   signal:signal?AbortSignal.any([signal,timeout]):timeout
  });
  const envelope=await response.json();
  // Only explicit server revocation can tell the existing V2 to clear its key.
  if(response.status===409&&suffix==='/profile'&&envelope?.session_reset===true)
   return {data:{session_reset:true},error:{code:'session_reset'},status:409};
  if(!response.ok||!envelope?.data||typeof envelope.data!=='object'||Array.isArray(envelope.data))return failure();
  const data=envelope.data;
  if(suffix==='/profile'&&typeof data.found!=='boolean')return failure();
  if(suffix!=='/profile'&&typeof data.active!=='boolean')return failure();
  if(suffix==='/profile/session'){
   if(data.reset===true&&data.active!==false)return failure();
   if(body.action==='logout'&&(data.active!==false||data.reset!==true))return failure();
   if(data.active===true&&(typeof data.name!=='string'||!/^\d{10,11}$/.test(data.phone||'')||!Array.isArray(data.addresses)||!(Date.parse(data.expires_at)>Date.now())))return failure();
  }
  if(suffix==='/profile/orders'&&data.active===true){
   if(body.action==='list'&&!Array.isArray(data.orders))return failure();
   if(body.action==='link'&&typeof data.linked!=='boolean')return failure();
  }
  return {data,error:null,status:200};
 }catch{return failure();}
}
