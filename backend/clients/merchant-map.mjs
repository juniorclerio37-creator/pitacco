// Experimental transport matching the original StorePointPicker and FleetTracking
// data contracts. Host must explicitly inject this adapter; no global client swap.
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const valid=(p)=>typeof p?.latitude==='number'&&typeof p?.longitude==='number'&&Number.isFinite(p.latitude)&&Number.isFinite(p.longitude)&&p.latitude>=-34&&p.latitude<=6&&p.longitude>=-75&&p.longitude<=-32;
export function createMerchantMap({store,token,scopedFetch,fetcher=globalThis.fetch}){
 if(!UUID.test(store??'')||(typeof scopedFetch!=='function'&&(typeof token!=='string'||!token)))throw Error('Sessão inválida.');
 let active=true,flight=null,writing=false;const controller=new AbortController();
 const base='/api/v1/stores/'+store+'/';
 function stop(){active=false;token='';controller.abort();}
 async function request(path,body,method=body?'PUT':'GET'){
  if(!active)throw Error('Sessão encerrada.');
  const res=await (scopedFetch??fetcher)(base+path,{method,headers:{Accept:'application/json',...(scopedFetch?{}:{Authorization:'Bearer '+token}),...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{}),cache:'no-store',credentials:'omit',redirect:'error',referrerPolicy:'no-referrer',signal:AbortSignal.any([controller.signal,AbortSignal.timeout(8000)])});
  if(!active)throw Error('Sessão encerrada.');
  if([401,403,404].includes(res.status)){stop();throw Error('Mapa não autorizado.');}
  if(!res.ok){const e=Error(res.status===429?'Aguarde antes de salvar outro ponto da loja.':'Mapa indisponível.');e.status=res.status;throw e;}
  const {data}=await res.json();if(!active||!data||typeof data!=='object')throw Error('Mapa indisponível.');return data;
 }
 function point(data){
  if(data.id!==store||typeof data.name!=='string'||!(valid(data)||(data.latitude===null&&data.longitude===null)))throw Error('Ponto inconsistente.');
  return {id:store,name:data.name,latitude:data.latitude,longitude:data.longitude};
 }
 async function readPoint(){return point(await request('map-point'));}
 async function readStoreAddress(){
  const data=await request('map-point');
  const shop=point(data);
  const address={};
  for(const field of ['address','address_number','neighborhood','city','state','postal_code']){
   if(data[field]!==null&&typeof data[field]!=='string')throw Error('Endereço da loja inconsistente.');
   address[field]=data[field];
  }
  return {...shop,...address};
 }
 async function savePoint(latitude,longitude){
  if(!valid({latitude,longitude}))throw Error('Escolha a entrada da loja no mapa, dentro do Brasil.');
  if(writing)throw Error('Gravação em andamento.');
  writing=true;
  try{const data=await request('map-point',{latitude,longitude,confirmed:true});if(data.saved!==true)throw Error('Gravação não confirmada.');return {...point(data),saved:true};}
  finally{writing=false;}
 }
 function readFleet(){
  if(!active)return Promise.reject(Error('Sessão encerrada.'));
  if(flight)return flight;
  flight=(async()=>{
   const data=await request('fleet-map');
   const {couriers,deliveries,positions,motion}=data;
   const shop=point(data.store??{});
   if(![couriers,deliveries,positions,motion].every(Array.isArray)||couriers.some(c=>c.store_id!==store)||deliveries.some(d=>d.store_id!==store||d.logistics_provider!=='loja'||!['pendente','atribuida','aceita','retirada'].includes(d.status)))throw Error('Mapa inconsistente.');
   const ids=new Set(couriers.map(c=>c.id));
   if(ids.size!==couriers.length||positions.some(p=>!ids.has(p.courier_id))||motion.some(p=>!ids.has(p.courier_id))||deliveries.some(d=>d.courier_id&&!ids.has(d.courier_id)))throw Error('Mapa inconsistente.');
   return {store:{...data.store,...shop},couriers,deliveries,positions,motion};
  })().finally(()=>{flight=null;});return flight;
 }
 // Exact bridge for the existing StorePointPicker "delivery-quote" invocation.
 // Lookup is server-side; an approximate result never becomes a confirmed point.
 async function invoke(name,{body}={}){
  try{
   if(name!=='delivery-quote'||body?.store_id!==store)throw Error('Operação não autorizada.');
   if(body.action==='store-point'&&Object.keys(body).sort().join(',')==='action,latitude,longitude,store_id')return {data:await savePoint(body.latitude,body.longitude),error:null};
   if(body.action==='store-origin'&&Object.keys(body).sort().join(',')==='action,store_id'){
    const p=await readPoint();
    if(valid(p))return {data:{latitude:p.latitude,longitude:p.longitude,approximate:false,cached:true},error:null};
    const v=await request('map-origin',{},'POST');
    if(!valid(v)||typeof v.approximate!=='boolean'||(v.approximate&&(v.saved!==false||v.requires_confirmation!==true))||(!v.approximate&&v.saved!==true))throw Error('Endereço ainda não localizado. Marque a entrada da loja no mapa.');
    return {data:{latitude:v.latitude,longitude:v.longitude,approximate:v.approximate,cached:v.cached===true},error:null};
   }
   throw Error('Operação não autorizada.');
  }catch(e){return {data:null,error:{message:e.message||'Mapa indisponível.',context:{status:e.status||0}}};}
 }
 return {readPoint,readStoreAddress,savePoint,readFleet,invoke,stop};
}
