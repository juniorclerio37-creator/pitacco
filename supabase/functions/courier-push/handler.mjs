const oauthUrl='https://oauth2.googleapis.com/token';
const tokenScope='https://www.googleapis.com/auth/firebase.messaging';
const encoder=new TextEncoder();
const encode=bytes=>btoa(String.fromCharCode(...bytes)).replaceAll('+','-').replaceAll('/','_').replace(/=+$/,'');
const segment=value=>encode(encoder.encode(JSON.stringify(value)));

export function firebaseMessage(event) {
 // The modern Android 2.0 app receives high-priority DATA events in its
 // native FirebaseMessagingService, including when the WebView is backgrounded.
 // This is required for the app-side authorized alarm and courier voice.
 // Legacy installed WebView APKs still need notification+data for system tray.
 // Only an event UUID is sent; no customer or delivery details are exposed.
 const eventId=String(event.event_id),native=event.protocol==='data_only';
 const message={
  token:event.token,
  data:{kind:'new_assignment',event_id:eventId},
  android:{priority:'HIGH',ttl:'90s',collapse_key:eventId}
 };
 if(!native){
  message.notification={title:'Pitacco Entregador',body:'Você tem uma nova entrega! Abra o aplicativo para conferir.'};
  message.android.notification={tag:eventId};
 }
 return {message};
}

export function adminFirebaseMessage(event){
 // Only native Android data messages: NO notification payload or default
 // system sound. The Android app renders them in a separate silent channel.
 const title=String(event.title||'Comunicado Pitacco');
 const body=String(event.body||'');
 return {message:{
  token:event.token,
  data:{kind:'admin_message',event_id:String(event.event_id),title,body},
  android:{priority:'HIGH',ttl:'21600s',collapse_key:String(event.event_id)}
 }};
}

export function completionStatus(status, details) {
 if(status>=200&&status<300)return 'sent';
 if(details?.some(value=>value.errorCode==='UNREGISTERED'))return 'invalid';
 return status===400?'rejected':'retry';
}

export function createCourierPush({url,serviceKey,cronSecret,verifyCron,account,fetcher=fetch,now=()=>Date.now()}) {
 let savedToken;
 async function rpc(name,body={}) {
  const response=await fetcher(new URL('/rest/v1/rpc/'+name,url),{
   method:'POST',headers:{apikey:serviceKey,authorization:'Bearer '+serviceKey,'content-type':'application/json'},
   body:JSON.stringify(body),redirect:'error',signal:AbortSignal.timeout(5500)
  });
  if(!response.ok)throw Error('database');
  return response.status===204?null:response.json();
 }
 async function googleToken(){
  if(savedToken&&savedToken.expires>now())return savedToken.value;
  const seconds=Math.floor(now()/1000);
  const signable=segment({alg:'RS256',typ:'JWT'})+'.'+segment({
   iss:account.client_email,scope:tokenScope,aud:oauthUrl,iat:seconds,exp:seconds+3600
  });
  const pem=account.private_key.replace(/-----[^-]+-----|\s+/g,'');
  const key=await crypto.subtle.importKey('pkcs8',Uint8Array.from(atob(pem),letter=>letter.charCodeAt(0)),
   {name:'RSASSA-PKCS1-v1_5',hash:'SHA-256'},false,['sign']);
  const signature=new Uint8Array(await crypto.subtle.sign('RSASSA-PKCS1-v1_5',key,encoder.encode(signable)));
  const response=await fetcher(oauthUrl,{method:'POST',redirect:'error',signal:AbortSignal.timeout(5500),
   body:new URLSearchParams({grant_type:'urn:ietf:params:oauth:grant-type:jwt-bearer',assertion:signable+'.'+encode(signature)})});
  if(!response.ok)throw Error('oauth');
  const parsed=await response.json();
  if(!parsed.access_token||!Number.isFinite(parsed.expires_in))throw Error('oauth');
  savedToken={value:parsed.access_token,expires:now()+Math.max(0,parsed.expires_in-90)*1000};
  return savedToken.value;
 }
 return async req=>{
  if(req.method!=='POST')return new Response(null,{status:405});
  const authorization=req.headers.get('authorization')||'';
  const candidate=authorization.startsWith('Bearer ')?authorization.slice(7):'';
  // Supports legacy Edge secret and the Vault-backed pg_cron secret. The
  // latter is verified server-to-server via a service_role-only PostgREST RPC.
  // Never expose the Vault secret to Android, the browser or logs.
  let authorized=Boolean(cronSecret&&candidate&&candidate===cronSecret);
  if(!authorized&&candidate&&typeof verifyCron==='function'){
   try{authorized=await verifyCron(candidate)===true;}catch{authorized=false;}
  }
  if(!authorized)return new Response(null,{status:401});
  // The preflight is restricted by the same cron/Vault bearer as dispatch.
  // It never claims orders and never returns credential or device contents.
  const mode=(await req.clone().json().catch(()=>({})))?.action;
  if(!url||!serviceKey||!account?.private_key||!account?.client_email||!/^[-a-z0-9]+$/.test(account?.project_id||'')){
   if(mode==='preflight')return Response.json(
    {ready:false,phase:'firebase_credentials',dispatched:false},
    {status:503,headers:{'cache-control':'no-store'}});
   return Response.json({error:'FCM ainda não configurado'},{status:503});
  }
  try{
   // Obtain OAuth before claiming; missing or invalid credentials must
   // NEVER consume any pending courier delivery notification.
   const token=await googleToken();
   if(mode==='preflight'){
    return Response.json({ready:true,phase:'firebase_oauth',dispatched:false},
     {headers:{'cache-control':'no-store'}});
   }
   // Obtain OAuth before claiming; a missing credential does not consume deliveries.
   const jobs=await rpc('pitacco_claim_courier_push');
   async function deliver(event){
    // A missing/invalid capability must not downgrade old APKs into a data-only
    // message they cannot display in background.
    const protocol=await rpc('pitacco_courier_push_protocol',{p_token:event.token});
    const target='https://fcm.googleapis.com/v1/projects/'+account.project_id+'/messages:send';
    const response=await fetcher(target,{method:'POST',redirect:'error',signal:AbortSignal.timeout(5500),
     headers:{authorization:'Bearer '+token,'content-type':'application/json'},
     body:JSON.stringify(firebaseMessage({...event,protocol}))});
    const payload=response.ok?null:await response.json().catch(()=>null);
    const result=completionStatus(response.status,payload?.error?.details);
    if(result!=='retry')await rpc('pitacco_finish_courier_push',{p_event:event.event_id,p_token:event.token,p_result:result});
    return result;
   }
   const results=await Promise.allSettled(jobs.map(deliver));

   // Admin communications never invoke showAssignment/ShiftSoundPlayer.
   // Process an independent, owner-only audience queue with native silent
   // data messages; a campaign failure must never stop delivery assignments.
   let adminProcessed=0,adminSent=0,adminError=false;
   try{
    const adminJobs=await rpc('pitacco_claim_admin_courier_push');
    async function deliverAdmin(event){
     const endpoint='https://fcm.googleapis.com/v1/projects/'+account.project_id+'/messages:send';
     const response=await fetcher(endpoint,{method:'POST',redirect:'error',signal:AbortSignal.timeout(5500),
      headers:{authorization:'Bearer '+token,'content-type':'application/json'},
      body:JSON.stringify(adminFirebaseMessage(event))});
     const payload=response.ok?null:await response.json().catch(()=>null);
     const status=completionStatus(response.status,payload?.error?.details);
     // Queue completion is tied to exact event UUID + token.
     if(status!=='retry')await rpc('pitacco_finish_admin_courier_push',{
      p_event:event.event_id,p_token:event.token,p_result:status});
     return status;
    }
    const sent=await Promise.allSettled((adminJobs||[]).map(deliverAdmin));
    adminProcessed=sent.length;
    adminSent=sent.filter(row=>row.status==='fulfilled'&&row.value==='sent').length;
   }catch{adminError=true;}
   return Response.json({
    processed:results.length,
    sent:results.filter(row=>row.status==='fulfilled'&&row.value==='sent').length,
    admin_processed:adminProcessed,admin_sent:adminSent,admin_error:adminError
   });
  }catch{
   if(mode==='preflight')return Response.json(
    {ready:false,phase:'firebase_oauth',dispatched:false},
    {status:503,headers:{'cache-control':'no-store'}});
   return Response.json({error:'Não foi possível despachar notificações'},{status:502});
  }
 };
}
