import {createClient} from 'npm:@supabase/supabase-js@2.57.0';

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
    .select('address,address_number,neighborhood,city,state,postal_code,latitude,longitude')
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
   if(!key)return problem(503,'A localização automática do endereço ainda não foi habilitada.',origin);
   const limiter=await db.rpc('pitacco_service_delivery_quote_limit',{
    p_scope:'origin-hour-'+storeId,p_max:20,p_minutes:60
   });
   if(limiter.error||!limiter.data)return problem(429,'Validação indisponível ou limite de tentativas atingido.',origin);
   const address=[store.address,store.address_number,store.neighborhood,store.city,store.state,store.postal_code,'Brasil'].filter(Boolean).join(', ');
   const location=await geocode(address,key);
   if(location.country!=='BR')return problem(422,'Endereço fora do Brasil.',origin);
   const {error:updateError}=await db.from('stores').update({
    latitude:location.lat,longitude:location.lng
   }).eq('id',storeId);
   if(updateError)throw Error('Não foi possível registrar a localização da loja.');
   return response(200,{latitude:location.lat,longitude:location.lng,address},origin);
  }
  if(!key)return problem(503,'Cálculo de rotas ainda não homologado.',origin);
  const slug=String(body.slug||'').trim(),address=String(body.address||'').trim();
  const requestId=String(body.request_id||'');
  if(!slugPattern.test(slug)||address.length<12||address.length>500||!uuid.test(requestId))
   return problem(400,'Informe o endereço completo e uma solicitação válida.',origin);
  const {data:menu,error:menuError}=await db.from('public_menu_settings').select('store_id,delivery_enabled,enabled').eq('slug',slug).maybeSingle();
  if(menuError||!menu?.enabled||!menu.delivery_enabled)return problem(404,'Cardápio indisponível.',origin);
  const {data:rules,error:rulesError}=await db.from('pitacco_delivery_pricing').select('*').eq('store_id',menu.store_id).maybeSingle();
  if(rulesError||!rules?.enabled)return problem(409,'Cálculo automático ainda não habilitado nesta loja.',origin);
  const hash=await ipHash(request,serviceKey.slice(0,32));
  const limits=[
   {scope:'ip-min-'+menu.store_id+'-'+hash,max:10,minutes:1},
   {scope:'store-day-'+menu.store_id,max:500,minutes:1440}
  ];
  for(const l of limits){
   const {data,error}=await db.rpc('pitacco_service_delivery_quote_limit',{p_scope:l.scope,p_max:l.max,p_minutes:l.minutes});
   if(error)return problem(503,'Limite de cotações temporariamente indisponível.',origin);
   if(!data)return problem(429,'Muitas cotações. Tente novamente mais tarde.',origin);
  }
  const {data:store,error:storeError}=await db.from('stores').select('address,address_number,neighborhood,city,state,postal_code').eq('id',menu.store_id).single();
  if(storeError||!store?.address||!store.city||!store.state)return problem(409,'A loja precisa validar seu endereço.',origin);
  const storeAddress=[store.address,store.address_number,store.neighborhood,store.city,store.state,store.postal_code,'Brasil'].filter(Boolean).join(', ');
  const [from,to]=await Promise.all([geocode(storeAddress,key),geocode(address+', Brasil',key)]);
  if(from.country!=='BR'||to.country!=='BR')return problem(422,'Endereço fora da região atendida.',origin);
  const meters=await roadDistance(from,to,key);
  if(meters>rules.max_radius_km*1000)return problem(422,'Endereço fora da área de entrega desta loja.',origin);
  const override=(rules.neighborhood_fees||[]).find((v:any)=>normalize(v.bairro||'')===normalize(to.neighborhood)&&normalize(v.cidade||'')===normalize(to.city));
  const km=Math.max(1,Math.ceil(meters/1000));
  const fee=Number(override?override.taxa:rules.distance_fees?.[km-1]);
  if(!Number.isFinite(fee)||fee<0||fee>999.99)throw Error('Tabela de frete inválida.');
  const expiresAt=new Date(Date.now()+5*60*1000).toISOString();
  const {data:quote,error:insertError}=await db.from('pitacco_delivery_route_quotes').insert({
   store_id:menu.store_id,request_id:requestId,destination_address:address,
   distance_m:meters,fee,pricing_updated_at:rules.updated_at,expires_at:expiresAt
  }).select('id').single();
  if(insertError)return problem(409,'Esta solicitação já possui cotação. Recomece a conferência do frete.',origin);
  return response(200,{quote_id:quote.id,request_id:requestId,distance_m:meters,fee,expires_at:expiresAt},origin);
 }catch(error){
  const message=error instanceof Error?error.message:'Falha ao calcular a entrega.';
  const status=message.includes('impreciso')||message.includes('localizado')?422:503;
  return problem(status,status===503?'Serviço de rotas indisponível no momento. Tente novamente.':message,origin);
 }
});
