const oauthUrl='https://oauth2.googleapis.com/token';
const tokenScope='https://www.googleapis.com/auth/firebase.messaging';
const encoder=new TextEncoder();
const encode=bytes=>btoa(String.fromCharCode(...bytes)).replaceAll('+','-').replaceAll('/','_').replace(/=+$/,'');
const segment=value=>encode(encoder.encode(JSON.stringify(value)));

export function firebaseMessage(event) {
 return {message:{
  token:event.token,
  notification:{title:'Pitacco Entregador',body:'A loja atribuiu uma nova entrega para você.'},
  android:{priority:'HIGH',ttl:'90s',notification:{channel_id:'pitacco_new_assignment_v1',tag:event.event_id}}
 }};
}

export function completionStatus(status, details) {
 if(status>=200&&status<300)return 'sent';
 if(details?.some(value=>value.errorCode==='UNREGISTERED'))return 'invalid';
 return status===400?'rejected':'retry';
}

export function createCourierPush({url,serviceKey,cronSecret,account,fetcher=fetch,now=()=>Date.now()}) {
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
  if(!cronSecret||req.headers.get('authorization')!=='Bearer '+cronSecret)return new Response(null,{status:401});
  if(!url||!serviceKey||!account?.private_key||!account?.client_email||!/^[-a-z0-9]+$/.test(account?.project_id||'')){
   return Response.json({error:'FCM ainda não configurado'},{status:503});
  }
  try{
   // Obtain OAuth before claiming; a missing credential does not consume deliveries.
   const token=await googleToken();
   const jobs=await rpc('pitacco_claim_courier_push');
   async function deliver(event){
    const target='https://fcm.googleapis.com/v1/projects/'+account.project_id+'/messages:send';
    const response=await fetcher(target,{method:'POST',redirect:'error',signal:AbortSignal.timeout(5500),
     headers:{authorization:'Bearer '+token,'content-type':'application/json'},body:JSON.stringify(firebaseMessage(event))});
    const payload=response.ok?null:await response.json().catch(()=>null);
    const result=completionStatus(response.status,payload?.error?.details);
    if(result!=='retry')await rpc('pitacco_finish_courier_push',{p_event:event.event_id,p_token:event.token,p_result:result});
    return result;
   }
   const results=await Promise.allSettled(jobs.map(deliver));
   return Response.json({processed:results.length,sent:results.filter(row=>row.status==='fulfilled'&&row.value==='sent').length});
  }catch{return Response.json({error:'Não foi possível despachar notificações'},{status:502});}
 };
}
