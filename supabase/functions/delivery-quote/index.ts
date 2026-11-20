import {createClient} from 'npm:@supabase/supabase-js@2.57.0';
import {directDistance,finiteBrazil,polygonValid,withinPolygon} from './coverage-geometry.mjs';

const allowedOrigins=new Set(['https://pitacco.com.br','https://www.pitacco.com.br','https://app.pitacco.com.br']);
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const slugPattern=/^[a-z0-9][a-z0-9-]{2,59}$/;
const normalize=(value:string)=>value.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim();
const response=(status:number,payload:unknown,origin:string)=>new Response(JSON.stringify(payload),{
 status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','Vary':'Origin',
  ...(allowedOrigins.has(origin)?{'Access-Control-Allow-Origin':origin,'Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type','Access-Control-Allow-Methods':'POST, OPTIONS'}:{})}
});
const problem=(status:number,message:string,origin:string)=>response(status,{error:message},origin);

type Geo={lat:number;lng:number;country:string;city:string;neighborhood:string};
async function geocode(address:string,key:string):Promise<Geo>{
 const url=new URL('https://maps.googleapis.com/maps/api/geocode/json');
 url.searchParams.set('address',address);url.searchParams.set('region','br');url.searchParams.set('key',key);
 const result=await fetch(url,{signal:AbortSignal.timeout(7000)});
 if(!result.ok)throw Error('Geocodificação indisponível.');
 const body=await result.json();
 if(body.status!=='OK'||!Array.isArray(body.results)||!body.results.length)throw Error('Endereço não localizado. Confira rua, número, cidade e estado.');
 const first=body.results[0];
 if(first.partial_match||!first.geometry?.location||!['ROOFTOP','RANGE_INTERPOLATED'].includes(first.geometry.location_type))
  throw Error('Endereço impreciso. Informe rua, número e dados completos.');
 const components=first.address_components||[];
 const component=(kind:string)=>components.find((x:any)=>x.types.includes(kind))?.long_name||'';
 const country=components.find((x:any)=>x.types.includes('country'))?.short_name||'';
 const neighborhood=component('sublocality_level_1')||component('neighborhood')||component('sublocality');
 const city=component('administrative_area_level_2')||component('locality');
 return {lat:first.geometry.location.lat,lng:first.geometry.location.lng,country,city,neighborhood};
}
/**
 * Limited one-off OSM fallback for the shop ADDRESS, not a general purpose
 * geocoding/search endpoint. Nominatim's public instance forbids heavy use:
 * cap at 1 request/min across all shops using the database rate limiter,
 * identify the app, and cache the answer in stores.latitude/longitude.
 * A larger installation must configure a dedicated geocoding provider.
 */
async function approximateStoreAddress(store:any,db:any):Promise<Geo & {approximate:boolean}>{
 const cap=await db.rpc('pitacco_service_delivery_quote_limit',{
  p_scope:'pitacco-osm-geocode-global-minute',p_max:1,p_minutes:1
 });
 if(cap.error)throw Error('A verificação do serviço de localização está temporariamente indisponível.');
 if(cap.data!==true)throw Error('Serviço de localização ocupado. Tente novamente em um minuto.');
 const query=[store.address,store.neighborhood,store.city,store.state,'Brasil']
  .filter(Boolean).map((value:string)=>String(value).trim()).join(', ');
 const endpoint=new URL('https://nominatim.openstreetmap.org/search');
 endpoint.searchParams.set('q',query);
 endpoint.searchParams.set('format','jsonv2');
 endpoint.searchParams.set('addressdetails','1');
 endpoint.searchParams.set('limit','4');
 endpoint.searchParams.set('countrycodes','br');
 let first:any, providerUnavailable=false;
 try{
  const result=await fetch(endpoint,{
   headers:{
    'User-Agent':'Pitacco-delivery/1.0 (https://pitacco.com.br)',
    'Referer':'https://pitacco.com.br/'
   },
   signal:AbortSignal.timeout(9000)
  });
  if(!result.ok)throw Error('Geocodificação temporariamente indisponível.');
  const items=await result.json();
  if(Array.isArray(items)){
   const street=(value:any)=>normalize(String(value||'')).replace(/^(rua|r |avenida|av )\s+/,'');
   first=items.find((item:any)=>item.address?.country_code==='br'&&
     finiteBrazil(Number(item.lat),Number(item.lon))&&
     street(item.address.road||item.address.pedestrian||item.address.residential)
       ===street(store.address));
   // A rough but region-valid OSM suggestion is also acceptable; the merchant
   // must visually confirm or drag the pin to the actual shop entrance.
   if(!first)first=items.find((item:any)=>item.address?.country_code==='br'&&
     finiteBrazil(Number(item.lat),Number(item.lon))&&
     normalize(String(item.display_name||'')).includes(normalize(String(store.city||''))));
  }
 }catch{providerUnavailable=true;}
 if(!first){
  // BrasilAPI CEP v2 sometimes includes a geocoded postal centroid. Never
  // mislabel this as the exact storefront entrance.
  const cep=String(store.postal_code||'').replace(/\D/g,'');
  if(cep.length===8){
   try{
    const resp=await fetch('https://brasilapi.com.br/api/cep/v2/'+cep,{
     headers:{'User-Agent':'Pitacco-delivery/1.0 (https://pitacco.com.br)'},
     signal:AbortSignal.timeout(6500)
    });
    if(resp.ok){
     const data=await resp.json();
     const lat=Number(data?.location?.coordinates?.latitude),lng=Number(data?.location?.coordinates?.longitude);
     if(data?.city&&normalize(data.city)===normalize(store.city)&&
       data?.state&&Number.isFinite(lat)&&Number.isFinite(lng)&&finiteBrazil(lat,lng)){
      return {lat,lng,country:'BR',city:store.city,neighborhood:store.neighborhood||'',approximate:true};
     }
    }
   }catch{/* Manual pin remains available. */}
  }
  throw Error(providerUnavailable
   ?'Provedor de localização indisponível. Marque a loja no mapa ou tente novamente mais tarde.'
   :'Não encontramos esse endereço automaticamente. Toque no mapa para marcar a loja.');
 }
 return {lat:Number(first.lat),lng:Number(first.lon),country:'BR',
  city:store.city,neighborhood:store.neighborhood||'',approximate:true};
}

async function roadDistance(origin:Geo,destination:Geo,key:string):Promise<number>{
 const res=await fetch('https://routes.googleapis.com/directions/v2:computeRoutes',{
  method:'POST',
  headers:{'Content-Type':'application/json','X-Goog-Api-Key':key,'X-Goog-FieldMask':'routes.distanceMeters'},
  body:JSON.stringify({origin:{location:{latLng:{latitude:origin.lat,longitude:origin.lng}}},
   destination:{location:{latLng:{latitude:destination.lat,longitude:destination.lng}}},
   travelMode:'DRIVE',routingPreference:'TRAFFIC_UNAWARE'}),
  signal:AbortSignal.timeout(8000)
 });
 if(!res.ok)throw Error('Não foi possível calcular o trajeto viário.');
 const data=await res.json();const meters=data.routes?.[0]?.distanceMeters;
 if(!Number.isSafeInteger(meters)||meters<0)throw Error('Não há rota disponível para esse endereço.');
 return meters;
}
type Point=[number,number];
async function ipHash(request:Request,secret:string){
 const ip=request.headers.get('cf-connecting-ip')||request.headers.get('x-real-ip')||request.headers.get('x-forwarded-for')?.split(',')[0]||'unknown';
 const bytes=new TextEncoder().encode(secret+'|'+ip);
 return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))).map(v=>v.toString(16).padStart(2,'0')).join('');
}
Deno.serve(async request=>{
 const origin=request.headers.get('origin')||'';
 if(request.method==='OPTIONS')return new Response(null,{status:204,headers:{'Access-Control-Allow-Origin':allowedOrigins.has(origin)?origin:'null','Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type','Access-Control-Allow-Methods':'POST, OPTIONS','Vary':'Origin'}});
 if(request.method!=='POST')return problem(405,'Método não permitido.',origin);
 if(!allowedOrigins.has(origin))return problem(403,'Origem não autorizada.',origin);
 const key=Deno.env.get('PITACCO_GOOGLE_MAPS_SERVER_KEY');
 const serviceKey=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
 const url=Deno.env.get('SUPABASE_URL');
 if(!serviceKey||!url)return problem(503,'Configuração do serviço indisponível.',origin);
 try{
  const body=await request.json();
  const db=createClient(url,serviceKey,{auth:{persistSession:false,autoRefreshToken:false}});
  if(body.action==='store-origin'||body.action==='store-point'){
   const storeId=String(body.store_id||'');
   const token=(request.headers.get('authorization')||'').replace(/^Bearer\s+/i,'');
   if(!uuid.test(storeId)||!token)return problem(401,'Entre como gestor para configurar a localização da loja.',origin);
   const {data:identity,error:authError}=await db.auth.getUser(token);
   if(authError||!identity.user)return problem(401,'Sessão inválida.',origin);
   // Same store permissions as the courier manager; includes the platform
   // owner and the authenticated store manager, never a courier or customer.
   const {data:allowed,error:permissionError}=await db.rpc('pitacco_can_manage_courier_store',{
    p_actor:identity.user.id,p_store:storeId
   });
   if(permissionError||allowed!==true)return problem(403,'Sem permissão para alterar a localização desta loja.',origin);
   const {data:store,error:storeError}=await db.from('stores')
    .select('address,address_number,neighborhood,city,state,postal_code,latitude,longitude,updated_at')
    .eq('id',storeId).single();
   if(storeError||!store?.address||!store.city||!store.state)
    return problem(422,'Cadastre rua, cidade e estado em Dados da loja.',origin);
   if(body.action==='store-point'){
    // A deliberate drag/click on the map. No coordinates exposed in forms.
    // Keep this modification within Brazil and within the current store.
    const lat=body.latitude,lng=body.longitude;
    if(typeof lat!=='number'||typeof lng!=='number'||!Number.isFinite(lat)||!Number.isFinite(lng)||
       lat < -34 || lat > 6 || lng < -75 || lng > -32)
     return problem(422,'Escolha a entrada da loja no mapa, dentro do Brasil.',origin);
    const limiter=await db.rpc('pitacco_service_delivery_quote_limit',{
     p_scope:'store-map-point-hour-'+storeId,p_max:30,p_minutes:60
    });
    if(limiter.error||!limiter.data)return problem(429,'Aguarde antes de salvar outro ponto da loja.',origin);
    const {error:updateError}=await db.from('stores').update({
     latitude:Number(lat.toFixed(6)),longitude:Number(lng.toFixed(6))
    }).eq('id',storeId);
    if(updateError)throw Error('Não foi possível salvar o ponto da loja.');
    return response(200,{saved:true},origin);
   }
   if(store.latitude!=null&&store.longitude!=null&&
      finiteBrazil(Number(store.latitude),Number(store.longitude))){
    return response(200,{latitude:Number(store.latitude),longitude:Number(store.longitude),
     approximate:false,cached:true},origin);
   }
   const limiter=await db.rpc('pitacco_service_delivery_quote_limit',{
    p_scope:'origin-hour-'+storeId,p_max:10,p_minutes:60
   });
   if(limiter.error)return problem(503,'A busca automática do endereço está temporariamente indisponível.',origin);
   if(!limiter.data)return problem(429,'Aguarde antes de localizar sua loja novamente.',origin);
   const address=[store.address,store.address_number,store.neighborhood,store.city,
     store.state,store.postal_code,'Brasil'].filter(Boolean).join(', ');
   let location:Geo & {approximate?:boolean};
   try{
    if(key){
     try{location={...(await geocode(address,key)),approximate:false};}
     catch{location=await approximateStoreAddress(store,db);}
    }else location=await approximateStoreAddress(store,db);
   }catch(failure){
    const detail=failure instanceof Error?failure.message:'Falha ao localizar o endereço.';
    if(detail.includes('ocupado')||detail.includes('Aguarde'))
     return problem(429,'A localização automática está ocupada. O Pitacco fará outra tentativa.',origin);
    if(detail.includes('Não encontramos')||detail.includes('Endereço não localizado'))
     return problem(422,'Não encontramos um ponto confiável para este endereço. Confira rua, número, bairro e CEP.',origin);
    return problem(503,'O provedor de localização não respondeu. O Pitacco tentará novamente automaticamente.',origin);
   }
   if(location.country!=='BR'||!finiteBrazil(location.lat,location.lng))
    return problem(422,'Endereço fora da região atendida.',origin);
   // Geocoding can take several seconds. If the merchant edited their
   // address while the provider was working, NEVER save the old address's
   // coordinates onto the newly saved address (freight uses this origin).
   let save=db.from('stores').update({
    latitude:Number(location.lat.toFixed(6)),longitude:Number(location.lng.toFixed(6))
   }).eq('id',storeId).eq('address',store.address)
    .eq('city',store.city).eq('state',store.state);
   save=store.updated_at==null
    ?save.is('updated_at',null)
    :save.eq('updated_at',store.updated_at);
   const {data:saved,error:updateError}=await save.select('id').maybeSingle();
   if(updateError)throw Error('Não foi possível registrar a localização da loja.');
   if(!saved)return problem(409,
    'O endereço da loja mudou durante a localização. Atualize os dados e o Pitacco localizará o novo endereço.',origin);
   return response(200,{latitude:location.lat,longitude:location.lng,
    approximate:Boolean(location.approximate),address},origin);
  }
  const slug=String(body.slug||'').trim(),address=String(body.address||'').trim();
  const requestId=String(body.request_id||'');
  if(!slugPattern.test(slug)||address.length<12||address.length>500||!uuid.test(requestId))
   return problem(400,'Informe o endereço completo e uma solicitação válida.',origin);
  const {data:menu,error:menuError}=await db.from('public_menu_settings')
   .select('store_id,delivery_enabled,enabled').eq('slug',slug).maybeSingle();
  if(menuError||!menu?.enabled||!menu.delivery_enabled)
   return problem(404,'Entrega indisponível nesta loja.',origin);
  const {data:rules,error:rulesError}=await db.from('pitacco_delivery_pricing')
   .select('*').eq('store_id',menu.store_id).maybeSingle();
  if(rulesError||!rules?.enabled)
   return problem(409,'A loja ainda não configurou a área e o valor de entrega.',origin);
  const hash=await ipHash(request,serviceKey.slice(0,32));
  const limits=[
   {scope:'ip-min-'+menu.store_id+'-'+hash,max:10,minutes:1},
   {scope:'store-day-'+menu.store_id,max:500,minutes:1440}
  ];
  for(const l of limits){
   const {data,error}=await db.rpc('pitacco_service_delivery_quote_limit',{
    p_scope:l.scope,p_max:l.max,p_minutes:l.minutes
   });
   if(error)return problem(503,'Limite de cotações temporariamente indisponível.',origin);
   if(!data)return problem(429,'Muitas cotações. Tente novamente mais tarde.',origin);
  }
  const {data:store,error:storeError}=await db.from('stores')
   .select('latitude,longitude,address,address_number,neighborhood,city,state,postal_code')
   .eq('id',menu.store_id).single();
  if(storeError||store?.latitude==null||store?.longitude==null||
     !finiteBrazil(Number(store.latitude),Number(store.longitude)))
   return problem(409,'A loja precisa marcar o ponto de partida em Dados e identidade.',origin);
  const from:Point=[Number(store.latitude),Number(store.longitude)];
  const mode=rules.coverage_type||'road';
  let to:Point,meters:number,fee:number;
  if(mode==='circle'||mode==='polygon'){
   // Customer confirms their drop-off on the same map the store configured.
   // This pin (NOT just text address) is saved in the protected order quote.
   const lat=body.latitude,lng=body.longitude;
   if(typeof lat!=='number'||typeof lng!=='number'||!finiteBrazil(lat,lng))
    return problem(422,'Marque e confirme o ponto exato da entrega no mapa.',origin);
   to=[lat,lng];
   meters=directDistance(from,to);
   if(mode==='circle'){
    if(meters>rules.max_radius_km*1000)
     return problem(422,'Este endereço está fora do círculo de entregas da loja.',origin);
    const bracket=Math.max(1,Math.ceil(meters/1000));
    fee=Number(rules.distance_fees?.[bracket-1]);
   }else{
    const polygon:Point[]=rules.polygon;
    if(!Array.isArray(polygon)||!polygonValid(polygon)||
       polygon.some(p=>directDistance(from,p)>30000))
     return problem(409,'O polígono da loja precisa ser corrigido em Área de Entrega.',origin);
    if(!withinPolygon(to,polygon))
     return problem(422,'Este endereço está fora do polígono atendido pela loja.',origin);
    fee=Number(rules.polygon_fee);
   }
  }else if(mode==='road'){
   // Preserve the optional existing road-routing mode for shops with a
   // homologated provider. New visual modes above need no maps API key.
   if(!key)return problem(503,'Distância por trajeto indisponível nesta loja.',origin);
   const shopAddress=[store.address,store.address_number,store.neighborhood,
    store.city,store.state,store.postal_code,'Brasil'].filter(Boolean).join(', ');
   const destination=await geocode(address+', Brasil',key);
   if(destination.country!=='BR')return problem(422,'Endereço fora do Brasil.',origin);
   to=[destination.lat,destination.lng];
   meters=await roadDistance({
    lat:from[0],lng:from[1],country:'BR',city:store.city,neighborhood:store.neighborhood
   },destination,key);
   if(meters>rules.max_radius_km*1000)
    return problem(422,'Endereço fora da área de entrega desta loja.',origin);
   const override=(rules.neighborhood_fees||[]).find((v:any)=>
    normalize(v.bairro||'')===normalize(destination.neighborhood)&&
    normalize(v.cidade||'')===normalize(destination.city));
   fee=Number(override?override.taxa:rules.distance_fees?.[Math.max(1,Math.ceil(meters/1000))-1]);
  }else return problem(409,'Modo de entrega não reconhecido.',origin);
  if(!Number.isFinite(fee)||fee<0||fee>999.99)
   return problem(409,'As taxas de entrega da loja precisam ser corrigidas.',origin);
  const expiresAt=new Date(Date.now()+5*60*1000).toISOString();
  const {data:quote,error:insertError}=await db.from('pitacco_delivery_route_quotes').insert({
   store_id:menu.store_id,request_id:requestId,destination_address:address,
   destination_latitude:Number(to[0].toFixed(6)),
   destination_longitude:Number(to[1].toFixed(6)),
   distance_m:meters,fee,pricing_updated_at:rules.updated_at,expires_at:expiresAt
  }).select('id').single();
  if(insertError)return problem(409,'Esta solicitação já possui cotação. Recomece o cálculo do frete.',origin);
  return response(200,{quote_id:quote.id,request_id:requestId,distance_m:meters,
   distance_type:mode==='road'?'road':'straight',fee,expires_at:expiresAt},origin);
 }catch(error){
  const message=error instanceof Error?error.message:'Falha ao calcular a entrega.';
  const status=message.includes('impreciso')||message.includes('localizado')?422:503;
  return problem(status,status===503?'Serviço de rotas indisponível no momento. Tente novamente.':message,origin);
 }
});
