const apiOrigin='https://merchant-api.ifood.com.br';
const uuid=/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
const allowedOrigins=new Set(['https://app.pitacco.com.br','https://admin.pitacco.com.br']);
const encoder=new TextEncoder();
const decoder=new TextDecoder();
const base64=bytes=>btoa(String.fromCharCode(...bytes));
const decode=value=>Uint8Array.from(atob(value),character=>character.charCodeAt(0));

export function createDistributedIfood({id,secret,tokenKey,supabaseUrl,publicKey,rpc,fetcher,logger}) {
 const configured=Boolean(id&&secret&&tokenKey&&publicKey);
 let key;
 function vaultKey(){
  key??=crypto.subtle.importKey('raw',decode(tokenKey),'AES-GCM',false,['encrypt','decrypt']);
  return key;
 }
 async function seal(value,context){
  const iv=crypto.getRandomValues(new Uint8Array(12));
  const encrypted=await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:encoder.encode(context)},
   await vaultKey(),encoder.encode(JSON.stringify(value)));
  return base64(iv)+'.'+base64(new Uint8Array(encrypted));
 }
 async function open(value,context){
  const [iv,data]=value.split('.');
  const decrypted=await crypto.subtle.decrypt({name:'AES-GCM',iv:decode(iv),additionalData:encoder.encode(context)},
   await vaultKey(),decode(data));
  return JSON.parse(decoder.decode(decrypted));
 }
 function api(path,init={}){
  return fetcher(apiOrigin+path,{...init,signal:AbortSignal.timeout(8000),redirect:'error'});
 }
 async function getToken(form,previousRefresh){
  const response=await api('/authentication/v1.0/oauth/token',{
   method:'POST',body:new URLSearchParams({clientId:id,clientSecret:secret,...form}),
  });
  if(!response.ok)return {error:response.status};
  const value=await response.json();
  if(typeof value.accessToken!=='string'||!value.accessToken||
    !(Number(value.expiresIn)>0)||typeof (value.refreshToken??previousRefresh)!=='string')throw Error('oauth-response');
  return {access:value.accessToken,refresh:value.refreshToken??previousRefresh,expires:Date.now()+Number(value.expiresIn)*1000};
 }
 async function connect(request){
  const origin=request.headers.get('origin');
  const headers={'cache-control':'no-store',vary:'Origin'};
  const reply=(status,body)=>Response.json(body,{status,headers});
  if(!allowedOrigins.has(origin))return reply(403,{error:'Origem indisponível.'});
  headers['access-control-allow-origin']=origin;
  headers['access-control-allow-headers']='authorization, apikey, content-type, x-client-info, x-supabase-api-version';
  headers['access-control-allow-methods']='POST, OPTIONS';
  if(request.method==='OPTIONS')return new Response(null,{status:204,headers});
  if(request.method!=='POST')return reply(405,{error:'Use POST.'});
  const authorization=request.headers.get('authorization');
  if(!authorization?.startsWith('Bearer '))return reply(401,{error:'Entre na sua conta Pitacco.'});
  if(!configured)return reply(503,{error:'O vínculo iFood ainda não foi disponibilizado.'});
  try{
   const input=await request.json().catch(()=>null);
   if(!input||typeof input.store!=='string'||!uuid.test(input.store.toLowerCase()))return reply(400,{error:'Selecione a loja.'});
   const store=input.store.toLowerCase();
   const sessionHeaders={authorization,apikey:publicKey,'content-type':'application/json'};
   const database=(name,args)=>fetcher(new URL('/rest/v1/rpc/'+name,supabaseUrl),{
    method:'POST',headers:sessionHeaders,body:JSON.stringify(args),signal:AbortSignal.timeout(4000),redirect:'error',
   });
   const [user,permission,flag]=await Promise.all([
    fetcher(new URL('/auth/v1/user',supabaseUrl),{headers:sessionHeaders,signal:AbortSignal.timeout(4000),redirect:'error'}),
    database('pitacco_ifood_connections',{p_store:store}),database('pitacco_ifood_linking_status',{}),
   ]);
   if(!user.ok||!permission.ok)return reply(403,{error:'Somente gestores podem vincular a conta da loja.'});
   const actor=(await user.json()).id;
   const testing=input.test===true&&origin==='https://admin.pitacco.com.br'&&
    await database('pitacco_is_platform_owner',{}).then(async value=>value.ok&&await value.json()===true);
   if(!testing&&(!flag.ok||await flag.json()!==true)){
    return reply(403,{error:'A homologação geral do iFood está pendente.'});
   }
   if(input.action==='start'){
    if(typeof input.merchant!=='string'||!uuid.test(input.merchant))return reply(400,{error:'Informe o Merchant ID da loja iFood.'});
    const response=await api('/authentication/v1.0/oauth/userCode',{
     method:'POST',body:new URLSearchParams({clientId:id}),
    });
    if(!response.ok)return reply(502,{error:'O iFood não gerou o código. Tente novamente.'});
    const result=await response.json();
    if(typeof result.userCode!=='string'||typeof result.authorizationCodeVerifier!=='string')throw Error('verification-response');
    const portal=new URL(result.verificationUrlComplete??result.verificationUrl);
    if(portal.origin!=='https://portal.ifood.com.br')throw Error('invalid-verification-url');
    const seconds=Math.min(600,Math.floor(Number(result.expiresIn)));
    const ref=await rpc('pitacco_ifood_begin_auth',{p_actor:actor,p_store:store,p_merchant:input.merchant,p_test:testing,
     p_verifier:await seal(result.authorizationCodeVerifier,actor+':'+store),p_seconds:seconds});
    return reply(200,{reference:ref,userCode:result.userCode,portal:portal.toString(),seconds});
   }
   if(input.action!=='finish'||typeof input.reference!=='string'||!uuid.test(input.reference)||
       typeof input.code!=='string'||!input.code.trim()||input.code.length>256)return reply(400,{error:'Informe o código de autorização.'});
   const [attempt]=await rpc('pitacco_ifood_take_auth',{p_ref:input.reference,p_actor:actor,p_store:store});
   if(!attempt||attempt.test_only!==testing)return reply(409,{error:'Gere um novo código de vínculo e autorize no iFood.'});
   const credential=await getToken({grantType:'authorization_code',authorizationCode:input.code.trim(),
    authorizationCodeVerifier:await open(attempt.verifier,actor+':'+store)});
   if(credential.error)return reply(422,{error:'O iFood recusou o código. Gere um novo vínculo e tente novamente.'});
   const identity=await api('/merchant/v1.0/merchants/'+attempt.merchant_id,{headers:{authorization:'Bearer '+credential.access}});
   if(!identity.ok||(await identity.json()).id!==attempt.merchant_id){
    return reply(403,{error:'A autorização recebida não permite acessar o Merchant ID informado.'});
   }
   await rpc('pitacco_ifood_link_verified',{p_store:store,p_merchant:attempt.merchant_id,p_test:testing,
    p_credential:await seal(credential,attempt.merchant_id)});
   return reply(200,{linked:true});
  }catch(error){
   if(error.status===400||error.status===409)return reply(409,{error:'Este vínculo não pôde ser gravado. Confira o ID e o limite de contas da loja.'});
   logger.warn('Vínculo iFood indisponível.');
   return reply(503,{error:'Não foi possível concluir o vínculo. Gere um novo código ou tente mais tarde.'});
  }
 }
 async function pollOne(row,enqueue){
  let encrypted=null,ok=false,revoked=false;
  try{
   let credential=await open(row.credential,row.merchant_id);
   if(credential.expires<Date.now()+60000){
    credential=await getToken({grantType:'refresh_token',refreshToken:credential.refresh},credential.refresh);
    if(credential.error){
     revoked=[400,401,403].includes(credential.error);
     return;
    }
    encrypted=await seal(credential,row.merchant_id);
   }
   const headers={authorization:'Bearer '+credential.access,'x-polling-merchants':row.merchant_id};
   const response=await api('/events/v1.0/events:polling',{headers});
   if(!response.ok){revoked=[401,403].includes(response.status);return;}
   if(response.status===204){ok=true;return;}
   const events=await response.json();
   if(!Array.isArray(events))throw Error('poll-response');
   const received=[];
   for(const event of events){
    if(typeof event.id!=='string'||!uuid.test(event.id)||event.merchantId!==row.merchant_id)continue;
    await enqueue(event,true);
    received.push({id:event.id});
   }
   if(received.length){
    const ack=await api('/events/v1.0/events/acknowledgment',{
     method:'POST',headers:{...headers,'content-type':'application/json'},body:JSON.stringify(received),
    });
    if(!ack.ok)throw Error('poll-ack');
   }
   ok=true;
  }catch{logger.warn('Consulta iFood será retomada em nova tentativa.');}
  finally{await rpc('pitacco_ifood_save_poll',{p_merchant:row.merchant_id,p_lease:row.lease,p_credential:encrypted,p_ok:ok,p_revoked:revoked});}
 }
 async function poll(enqueue){
  if(!configured)return;
  const rows=await rpc('pitacco_ifood_claim_poll',{});
  await Promise.allSettled(rows.map(row=>pollOne(row,enqueue)));
 }
 async function accessFor(merchant){
  const credential=await rpc('pitacco_ifood_poll_credential',{p_merchant:merchant});
  return credential?(await open(credential,merchant)).access:null;
 }
 return {connect,poll,accessFor};
}
