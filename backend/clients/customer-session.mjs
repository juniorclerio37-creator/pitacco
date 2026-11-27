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
