import {createClient} from 'npm:@supabase/supabase-js@2.57.0';
import {directDistance,finiteBrazil,polygonValid,withinPolygon} from './coverage-geometry.mjs';

const nativeOrigins=new Set(['http://tauri.localhost','https://tauri.localhost']);
const allowedOrigins=new Set(['https://pitacco.com.br','https://www.pitacco.com.br','https://app.pitacco.com.br',...nativeOrigins]);
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const slugPattern=/^[a-z0-9][a-z0-9-]{2,59}$/;
const normalize=(value:string)=>value.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim();
const response=(status:number,payload:unknown,origin:string)=>new Response(JSON.stringify(payload),{
 status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','Vary':'Origin',
  ...(allowedOrigins.has(origin)?{'Access-Control-Allow-Origin':origin,'Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type','Access-Control-Allow-Methods':'POST, OPTIONS'}:{})}
});
const problem=(status:number,message:string,origin:string)=>response(status,{error:message},origin);

type Geo={lat:number;lng:number;country:string;city:string;neighborhood:string;
 street?:string;houseNumber?:string;postalCode?:string};
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
 return {lat:first.geometry.location.lat,lng:first.geometry.location.lng,country,city,neighborhood,
 street:component('route'),houseNumber:component('street_number'),postalCode:component('postal_code')};
}
/**
 * Limited one-off OSM fallback for the shop ADDRESS, not a general purpose
 * geocoding/search endpoint. Nominatim's public instance forbids heavy use:
 * cap at 1 request/min across all shops using the database rate limiter,
 * identify the app, and cache the answer in stores.latitude/longitude.
 * A larger installation must configure a dedicated geocoding provider.
 */
// Keep only results verified against the actual street AND city and either
// neighborhood or postal code. Never replace the real shop with a city center.
const sameRoad=(a:unknown,b:unknown)=>{
 const clean=(v:unknown)=>normalize(String(v||'')).replace(/^(rua|r\.?|avenida|av\.?|travessa|tv\.?)\s+/,'')
  .replace(/[^a-z0-9 ]+/g,' ').replace(/\s+/g,' ').trim();
 return !!clean(a)&&clean(a)===clean(b);
};
const samePostal=(a:unknown,b:unknown)=>{
 const digits=(v:unknown)=>String(v||'').replace(/\D/g,'');
 return digits(a).length===8 && digits(a)===digits(b);
};
function originMatchesGoogle(g:Geo,store:any):boolean{
 // Google gives rooftop/interpolated results; demand the requested road/number,
 // municipality and (if supplied) postal code. Otherwise try strict OSM.
 if(g.country!=='BR'||!finiteBrazil(g.lat,g.lng)||!sameRoad(g.street,store.address)
  ||normalize(g.city)!==normalize(store.city)
  ||String(g.houseNumber||'').trim()!==String(store.address_number||'').trim())return false;
 if(g.postalCode&&store.postal_code&&!samePostal(g.postalCode,store.postal_code))return false;
 return true;
}
/**
 * Geoapify offers non-Google geocoding results that can be shown on the
 * existing OpenStreetMap/Leaflet map. Never expose the API key to browsers.
 * Presence of a street/city alone is a preview, not a verified storefront.
 */
async function geoapifyStoreAddress(store:any,key:string):Promise<(Geo & {approximate:boolean})|null>{
 const address=new URL('https://api.geoapify.com/v1/geocode/search');
 address.searchParams.set('street',String(store.address).trim());
 if(store.address_number)address.searchParams.set('housenumber',String(store.address_number).trim());
 if(store.postal_code)address.searchParams.set('postcode',String(store.postal_code).replace(/\D/g,''));
 address.searchParams.set('city',String(store.city).trim());
 address.searchParams.set('state',String(store.state).trim());
 address.searchParams.set('country','Brazil');
 address.searchParams.set('filter','countrycode:br');
 address.searchParams.set('format','json');
 address.searchParams.set('limit','5');
 address.searchParams.set('apiKey',key);
 const res=await fetch(address,{signal:AbortSignal.timeout(8500)});
 if(!res.ok)throw Error('Geoapify indisponível (HTTP '+res.status+').');
 const payload=await res.json();
 const matches=Array.isArray(payload.results)?payload.results:[];
 const normalizedCity=normalize(String(store.city||''));
 const expectedDistrict=normalize(String(store.neighborhood||''));
 const normalizedNumber=String(store.address_number||'').trim();
 for(const item of matches){
  if(String(item.country_code||'').toLowerCase()!=='br')continue;
  if(!finiteBrazil(Number(item.lat),Number(item.lon)))continue;
  if(!sameRoad(item.street,store.address))continue;
  if(item.postcode&&store.postal_code&&!samePostal(item.postcode,store.postal_code))continue;
  const cities=[item.city,item.municipality,item.county].filter(Boolean);
  if(!cities.some((v:any)=>normalize(String(v))===normalizedCity))continue;
  const districts=[item.suburb,item.district,item.neighbourhood,item.city_district].filter(Boolean);
  const hasDistrict=Boolean(expectedDistrict)&&districts.some((v:any)=>normalize(String(v))===expectedDistrict);
  const hasPostcode=Boolean(item.postcode)&&samePostal(item.postcode,store.postal_code);
  if(!hasDistrict&&!hasPostcode)continue;
  const incomingNumber=String(item.housenumber||'').trim();
  if(incomingNumber&&incomingNumber!==normalizedNumber)continue;
  const confidence=Number(item.rank?.confidence);
  if(Number.isFinite(confidence)&&confidence<0.70)continue;
  const type=String(item.result_type||'').toLowerCase();
  const precise=incomingNumber!==''&&incomingNumber===normalizedNumber
   &&['building','amenity','house'].includes(type)
   &&Number.isFinite(confidence)&&confidence>=0.85;
  return {lat:Number(item.lat),lng:Number(item.lon),country:'BR',
   city:String(item.city||store.city),neighborhood:String(item.suburb||store.neighborhood||''),
   street:String(item.street),houseNumber:incomingNumber,
   postalCode:String(item.postcode||''),approximate:!precise};
 }
 return null;
}

async function approximateStoreAddress(store:any,db:any):Promise<Geo & {approximate:boolean}>{
 // Overall throttle protects the free provider against sustained requests.
 const cap=await db.rpc('pitacco_service_delivery_quote_limit',{
  p_scope:'pitacco-osm-geocode-global-minute',p_max:12,p_minutes:1
 });
 if(cap.error)throw Error('A verificação do serviço de localização está temporariamente indisponível.');
 if(cap.data!==true)throw Error('Serviço de localização ocupado. Tente novamente mais tarde.');
 // Global atomic 1 request/second cap follows Nominatim's public usage policy.
 const slot=await db.rpc('pitacco_service_nominatim_second_slot');
 if(slot.error)throw Error('A verificação do serviço de localização está temporariamente indisponível.');
 if(slot.data!==true)throw Error('Serviço de localização ocupado. Tente novamente em alguns segundos.');
 // Use the full saved address, including number and CEP; never search the
 // municipality alone or save its generic centre as a shop entrance.
 const street=[store.address,store.address_number].filter(Boolean).map((v:string)=>String(v).trim()).join(', ');
 const query=[street,store.neighborhood,store.city,store.state,store.postal_code,'Brasil']
  .filter(Boolean).map((value:string)=>String(value).trim()).join(', ');
 const search=async(q:string)=>{
  const endpoint=new URL('https://nominatim.openstreetmap.org/search');
  endpoint.searchParams.set('q',q);
  endpoint.searchParams.set('format','jsonv2');
  endpoint.searchParams.set('addressdetails','1');
  endpoint.searchParams.set('limit','10');
  endpoint.searchParams.set('countrycodes','br');
  const result=await fetch(endpoint,{
   headers:{'User-Agent':'Pitacco-delivery/1.0 (https://pitacco.com.br)',
    'Referer':'https://pitacco.com.br/'},
   signal:AbortSignal.timeout(9000)
  });
  if(!result.ok)throw Error('Provedor público não respondeu.');
  const data=await result.json();
  if(!Array.isArray(data))throw Error('Resposta inválida de geocodificação.');
  return data;
 };
 let items:any[];
 try{items=await search(query);}
 catch{throw Error('Provedor de localização indisponível. Tente novamente mais tarde.');}
 if(items.length===0){
  // A second, simplified lookup helps OSM street records without house
  // numbers/CEPs. Reserve another rate-limited slot one second later.
  await new Promise(resolve=>setTimeout(resolve,1100));
  const retry=await db.rpc('pitacco_service_nominatim_second_slot');
  if(!retry.error&&retry.data===true){
   const relaxed=[store.address,store.neighborhood,store.city,store.state,'Brasil']
    .filter(Boolean).map((v:string)=>String(v).trim()).join(', ');
   try{items=await search(relaxed);}catch{/* No unsafe fallback. */}
  }
 }
 const first=items.find((item:any)=>{
  const a=item.address||{};
  if(a.country_code!=='br'||!finiteBrazil(Number(item.lat),Number(item.lon)))return false;
  const road=a.road||a.pedestrian||a.residential||a.living_street||a.footway;
  if(!sameRoad(road,store.address))return false;
  const cities=[a.city,a.town,a.municipality,a.county,a.village].filter(Boolean);
  if(!cities.some((city:any)=>normalize(String(city))===normalize(store.city)))return false;
  const expectedZip=String(store.postal_code||'').replace(/\D/g,'');
  if(a.postcode&&expectedZip.length===8&&!samePostal(a.postcode,expectedZip))return false;
  if(a.house_number&&store.address_number&&
   String(a.house_number).trim()!==String(store.address_number).trim())return false;
  const districts=[a.suburb,a.city_district,a.neighbourhood,a.quarter,a.district,
   a.borough,a.hamlet,a.residential].filter(Boolean);
  const sameDistrict=!!store.neighborhood&&districts.some((v:any)=>
   normalize(String(v))===normalize(String(store.neighborhood)));
  const sameZip=expectedZip.length===8&&samePostal(a.postcode,expectedZip);
  return sameDistrict||sameZip;
 });
 if(!first)throw Error('Endereço não localizado com segurança: o mapa gratuito não possui um ponto confiável para esta rua. Use o GPS na entrada da loja ou conecte um geocodificador preciso.');
 return {lat:Number(first.lat),lng:Number(first.lon),country:'BR',city:store.city,
  neighborhood:store.neighborhood||'',approximate:!Boolean(first.address?.house_number)};
}

/**
 * Resolve an address for a circle/polygon quote only when a configured
 * provider returns a verified street + house number + municipality match.
 * Never guess from a bairro, CEP centroid or city centre. When confidence is
 * insufficient the client must confirm the point on its visual map.
 * Coordinates are used for an authoritative server-side quote only.
 */
async function customerDeliveryLocation(address:string,geoapifyKey?:string,googleKey?:string):Promise<Point>{
 const parts=address.split(',').map(p=>p.trim());
 const street=parts[0]||'',number=parts[1]||'',city=parts[3]||'';
 const postal=(address.match(/\bCEP\s*([0-9]{5}-?[0-9]{3})\b/i)?.[1]||'').replace(/\D/g,'');
 if(street.length<3||!number||!city)throw Error('Preencha rua, número, bairro e cidade para calcular o frete.');
 if(geoapifyKey){
  try{
   const url=new URL('https://api.geoapify.com/v1/geocode/search');
   url.searchParams.set('text',address+', Brasil');
   url.searchParams.set('filter','countrycode:br');
   url.searchParams.set('format','json');url.searchParams.set('limit','5');
   url.searchParams.set('apiKey',geoapifyKey);
   const res=await fetch(url,{signal:AbortSignal.timeout(7000)});
   if(res.ok){
    const data=await res.json();
    for(const found of Array.isArray(data.results)?data.results:[]){
     if(String(found.country_code||'').toLowerCase()!=='br')continue;
     if(!finiteBrazil(Number(found.lat),Number(found.lon)))continue;
     if(!sameRoad(found.street,street))continue;
     if(String(found.housenumber||'').trim()!==number)continue;
     if(![found.city,found.municipality,found.county].some((v:any)=>normalize(String(v||''))===normalize(city)))continue;
     if(postal&&found.postcode&&!samePostal(postal,found.postcode))continue;
     if(!['building','amenity','house'].includes(String(found.result_type||'').toLowerCase()))continue;
     if(Number(found.rank?.confidence||0)<0.80)continue;
     return [Number(found.lat),Number(found.lon)];
    }
   }
  }catch{ /* The exact pin can always be supplied by the customer. */ }
 }
 if(googleKey){
  try{
   const found=await geocode(address+', Brasil',googleKey);
   if(found.country==='BR'&&finiteBrazil(found.lat,found.lng)
     &&sameRoad(found.street,street)&&String(found.houseNumber||'').trim()===number
     &&normalize(found.city)===normalize(city)
     &&(!postal||!found.postalCode||samePostal(postal,found.postalCode))){
    return [found.lat,found.lng];
   }
  }catch{ /* A map pin remains the safe fallback. */ }
 }
 throw Error('Não foi possível localizar este endereço com precisão. Marque a entrega no mapa ou use sua localização atual.');
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
 const geoapifyKey=Deno.env.get('PITACCO_GEOAPIFY_API_KEY');
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
    p_scope:'origin-hour-'+storeId,p_max:24,p_minutes:60
   });
   if(limiter.error)return problem(503,'A busca automática do endereço está temporariamente indisponível.',origin);
   if(!limiter.data)return problem(429,'Aguarde antes de localizar sua loja novamente.',origin);
   const address=[store.address,store.address_number,store.neighborhood,store.city,
     store.state,store.postal_code,'Brasil'].filter(Boolean).join(', ');
   let location:(Geo & {approximate?:boolean})|null=null;
   let provider='openstreetmap';
   try{
    // Google's geocoding results cannot be displayed over non-Google maps.
    // Prefer the OSM-compatible, configured Geoapify provider if available.
    if(geoapifyKey){
     try{
      location=await geoapifyStoreAddress(store,geoapifyKey);
      if(location)provider='geoapify';
     }catch{/* Fall back to the strict OSM request, not city centroids. */}
    }
    if(!location)location=await approximateStoreAddress(store,db);
   }catch(failure){
    const detail=failure instanceof Error?failure.message:'Falha ao localizar o endereço.';
    if(detail.includes('ocupado')||detail.includes('Aguarde'))
     return problem(429,'A localização automática está ocupada. O Pitacco fará outra tentativa.',origin);
    if(detail.includes('Não encontramos')||detail.includes('Endereço não localizado'))
     return problem(422,'Não foi possível localizar esta rua com segurança no mapa gratuito. Use o GPS na entrada da loja para marcar o ponto exato.',origin);
    return problem(503,'O provedor de localização não respondeu. O Pitacco tentará novamente automaticamente.',origin);
   }
   if(location.country!=='BR'||!finiteBrazil(location.lat,location.lng))
    return problem(422,'Endereço fora da região atendida.',origin);
   // Only a verified building may become a freight origin automatically.
   // Street-level guesses are preview-only until the merchant confirms.
   if(location.approximate){
    return response(200,{latitude:location.lat,longitude:location.lng,
     approximate:true,saved:false,requires_confirmation:true,provider},origin);
   }
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
    approximate:Boolean(location.approximate),address,provider},origin);
  }
  const slug=String(body.slug||'').trim(),address=String(body.address||'').trim();
  const requestId=String(body.request_id||'');
  if(!slugPattern.test(slug)||address.length<12||address.length>500||!uuid.test(requestId))
   return problem(400,'Informe o endereço completo e uma solicitação válida.',origin);
  const {data:menu,error:menuError}=await db.from('public_menu_settings')
   .select('store_id,delivery_enabled,enabled').eq('slug',slug).maybeSingle();
  if(menuError||!menu?.enabled||!menu.delivery_enabled)
   return problem(404,'Entrega indisponível nesta loja.',origin);
  // Desktop quotes are available only to an authenticated manager of this store.
  if(nativeOrigins.has(origin)){
   const token=(request.headers.get('authorization')||'').replace(/^Bearer\s+/i,'');
   if(!token)return problem(401,'Entre como gestor para calcular o frete.',origin);
   const {data:identity,error:authError}=await db.auth.getUser(token);
   if(authError||!identity.user)return problem(401,'Sessão inválida.',origin);
   const {data:allowed,error:permissionError}=await db.rpc('pitacco_can_manage_courier_store',{p_actor:identity.user.id,p_store:menu.store_id});
   if(permissionError||allowed!==true)return problem(403,'Sem permissão para calcular o frete desta loja.',origin);
  }
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
  let regionName:string|null=null;
  let eta:any=null;
  if(mode==='circle'||mode==='polygon'||mode==='polygons'){
   // Customer confirms drop-off coordinates on the same map the store
   // configured. Never trust a typed address for polygon membership.
   const lat=body.latitude,lng=body.longitude;
   if(typeof lat==='number'&&typeof lng==='number'&&finiteBrazil(lat,lng)){
    to=[lat,lng];
   }else if(lat!=null||lng!=null){
    return problem(422,'Localização inválida. Marque novamente a entrega no mapa.',origin);
   }else{
    // Selecting a saved or freshly typed address quotes automatically if a
    // configured provider resolves its exact house. No fallback to centroids.
    try{to=await customerDeliveryLocation(address,geoapifyKey||undefined,key||undefined);}
    catch(error){return problem(422,error instanceof Error?error.message:'Confirme o ponto de entrega no mapa.',origin);}
   }
   meters=directDistance(from,to);
   if(mode==='circle'){
    // Keep existing per-kilometre circle brackets completely unchanged.
    if(meters>rules.max_radius_km*1000)
     return problem(422,'Este endereço está fora do círculo de entregas da loja.',origin);
    const bracket=Math.max(1,Math.ceil(meters/1000));
    fee=Number(rules.distance_fees?.[bracket-1]);
    eta=rules.distance_times?.[bracket-1];
    regionName=`Até ${bracket} km`;
   }else if(mode==='polygons'){
    const regions=rules.polygons;
    if(!Array.isArray(regions)||regions.length<1||regions.length>12)
     return problem(409,'Cadastre as regiões poligonais em Área de Entrega.',origin);
    let matched:any=null;
    // Ordered array is the explicit priority: first matching polygon wins.
    // A client must never be charged multiple overlapping region fees.
    for(const region of regions){
     const vertices:Point[]=region.vertices;
     if(!Array.isArray(vertices)||!polygonValid(vertices)||
        vertices.some(p=>directDistance(from,p)>30000))
      return problem(409,'Existe uma região poligonal inválida. Corrija em Área de Entrega.',origin);
     if(withinPolygon(to,vertices)){matched=region;break;}
    }
    if(!matched)
     return problem(422,'Este endereço está fora de todas as regiões de entrega da loja.',origin);
    fee=Number(matched.fee);
    regionName=String(matched.name||'Região');
    eta=matched;
   }else{
    // Compatibility with single-polygon settings created before migration.
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
   eta=override||rules.distance_times?.[Math.max(1,Math.ceil(meters/1000))-1];
   if(override)regionName=String(override.bairro||'Bairro');
  }else return problem(409,'Modo de entrega não reconhecido.',origin);
  if(!Number.isFinite(fee)||fee<0||fee>999.99)
   return problem(409,'As taxas de entrega da loja precisam ser corrigidas.',origin);
  const service=body.delivery_service??'standard';
  if(!['standard','priority'].includes(service))return problem(400,'Modalidade de entrega inválida.',origin);
  const standard={fee,min_minutes:eta?.min_minutes??null,max_minutes:eta?.max_minutes??null};
  const priority=eta?.priority;
  const available=priority?.enabled===true&&Number.isFinite(priority.fee)&&priority.fee>fee&&priority.fee<=999.99&&Number.isInteger(priority.min_minutes)&&Number.isInteger(priority.max_minutes)&&priority.min_minutes>=1&&priority.max_minutes>=priority.min_minutes&&priority.max_minutes<eta.max_minutes&&priority.min_minutes<eta.min_minutes;
  const options={standard,priority:available?{fee:priority.fee,min_minutes:priority.min_minutes,max_minutes:priority.max_minutes}:null};
  if(service==='priority'){
   if(!available)return problem(409,'Entrega prioritária indisponível nesta região. Selecione a entrega padrão.',origin);
   fee=priority.fee;eta=priority;
  }
  const min=eta?.min_minutes,max=eta?.max_minutes;
  const validEta=Number.isInteger(min)&&Number.isInteger(max)&&min>=1&&max>=min&&max<=720;
  const expiresAt=new Date(Date.now()+5*60*1000).toISOString();
  const {data:quote,error:insertError}=await db.from('pitacco_delivery_route_quotes').insert({
   store_id:menu.store_id,request_id:requestId,destination_address:address,
   destination_latitude:Number(to[0].toFixed(6)),
   destination_longitude:Number(to[1].toFixed(6)),
   distance_m:meters,fee,pricing_updated_at:rules.updated_at,expires_at:expiresAt,
   delivery_min_minutes:validEta?min:null,delivery_max_minutes:validEta?max:null,delivery_region:regionName,delivery_service:service
  }).select('id').single();
  if(insertError)return problem(409,'Esta solicitação já possui cotação. Recomece o cálculo do frete.',origin);
  return response(200,{quote_id:quote.id,request_id:requestId,distance_m:meters,
   distance_type:mode==='road'?'road':'straight',fee,region_name:regionName,expires_at:expiresAt,delivery_min_minutes:validEta?min:null,delivery_max_minutes:validEta?max:null,delivery_service:service,delivery_options:options},origin);
 }catch(error){
  const message=error instanceof Error?error.message:'Falha ao calcular a entrega.';
  const status=message.includes('impreciso')||message.includes('localizado')?422:503;
  return problem(status,status===503?'Serviço de rotas indisponível no momento. Tente novamente.':message,origin);
 }
});
