// Server-only Meta Embedded Signup completion. No Meta tokens returned to clients.
import { createClient } from 'npm:@supabase/supabase-js@2.57.0';
const GRAPH='https://graph.facebook.com/v27.0';
const origin=Deno.env.get('PITACCO_WEB_ORIGIN')||'https://pitacco.com.br';
const cors={'Access-Control-Allow-Origin':origin,'Access-Control-Allow-Headers':'authorization,apikey,content-type','Access-Control-Allow-Methods':'POST,OPTIONS','Content-Type':'application/json','Vary':'Origin'};
const reply=(data:unknown,status=200)=>new Response(JSON.stringify(data),{status,headers:cors});
const hex=(bytes:Uint8Array)=>Array.from(bytes,x=>x.toString(16).padStart(2,'0')).join('');
const validId=(v:unknown)=>typeof v==='string'&&/^\d{5,25}$/.test(v);
async function graph(path:string,token:string,init?:RequestInit){
  const res=await fetch(GRAPH+path,{...init,headers:{Authorization:'Bearer '+token,...init?.headers}});
  const json=await res.json().catch(()=>({}));
  if(!res.ok)throw new Error('Meta Graph API recusou operação');
  return json;
}
Deno.serve(async(req)=>{
  if(req.method==='OPTIONS')return new Response(null,{headers:cors});
  if(req.method!=='POST')return reply({error:'Método não permitido'},405);
  if(req.headers.get('Origin')&&req.headers.get('Origin')!==origin)return reply({error:'Origem não permitida'},403);
  const appId=Deno.env.get('META_APP_ID')||'1670524024746336';
  const appSecret=Deno.env.get('META_APP_SECRET');
  const encryptionHex=Deno.env.get('WHATSAPP_TOKEN_ENCRYPTION_KEY');
  if(!appSecret||!encryptionHex||!/^[0-9a-fA-F]{64}$/.test(encryptionHex))return reply({error:'Servidor ainda não configurado para finalizar conexões'},503);
  const bearer=req.headers.get('Authorization')||'';
  if(!bearer.startsWith('Bearer '))return reply({error:'Autenticação necessária'},401);
  const url=Deno.env.get('SUPABASE_URL')!,anon=Deno.env.get('SUPABASE_ANON_KEY')!,service=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const userClient=createClient(url,anon,{global:{headers:{Authorization:bearer}}});
  const {data:{user},error:authError}=await userClient.auth.getUser();
  if(authError||!user)return reply({error:'Sessão inválida'},401);
  let body:Record<string,unknown>;
  try{body=await req.json()}catch{return reply({error:'Dados inválidos'},400)}
  const {store_id,state,code,waba_id,phone_number_id}=body;
  if(typeof store_id!=='string'||!/^[0-9a-f-]{36}$/i.test(store_id)||typeof state!=='string'||!/^[0-9a-f]{64}$/.test(state)||typeof code!=='string'||code.length<8||code.length>2048||!validId(waba_id)||!validId(phone_number_id))return reply({error:'Dados de cadastro inválidos'},400);
  const {data:allowed,error:permError}=await userClient.rpc('pitacco_can_manage_store',{p_store_id:store_id});
  if(permError||allowed!==true)return reply({error:'Sem permissão para esta loja'},403);
  const admin=createClient(url,service);
  const stateHash=hex(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(state))));
  const {data:session,error:sessionError}=await admin.from('store_whatsapp_onboarding_sessions').select('id').eq('store_id',store_id).eq('requested_by',user.id).eq('state_hash',stateHash).is('consumed_at',null).gt('expires_at',new Date().toISOString()).maybeSingle();
  if(sessionError||!session)return reply({error:'Sessão expirada ou já utilizada'},409);
  // Atomic claim prevents parallel callbacks reusing the same OAuth state.
  const {data:claimed,error:claimError}=await admin.from('store_whatsapp_onboarding_sessions').update({consumed_at:new Date().toISOString()}).eq('id',session.id).is('consumed_at',null).select('id').maybeSingle();
  if(claimError||!claimed)return reply({error:'Sessão já utilizada'},409);
  try{
    const params=new URLSearchParams({client_id:appId,client_secret:appSecret,code:String(code)});
    const exchange=await fetch(GRAPH+'/oauth/access_token?'+params.toString(),{method:'GET'});
    const exchanged=await exchange.json().catch(()=>({}));
    if(!exchange.ok||typeof exchanged.access_token!=='string')throw new Error('Falha na troca do código pela Meta');
    const token=exchanged.access_token as string;
    // Confirm the authorized token can actually see the WABA and the phone belongs to it.
    let next:string|null=GRAPH+'/'+waba_id+'/phone_numbers?fields=id,display_phone_number&limit=100';
    let phone:string|null=null;
    for(let page=0;next&&page<10;page++){
      const target=new URL(next);
      if(target.origin!==new URL(GRAPH).origin)throw new Error('Paginação Meta inválida');
      const data=await graph(target.pathname+target.search,token);
      const match=Array.isArray(data.data)?data.data.find((p:{id?:string})=>p.id===phone_number_id):null;
      if(match){phone=match.display_phone_number||null;break}
      next=typeof data.paging?.next==='string'?data.paging.next:null;
    }
    if(!phone)throw new Error('Número não pertence à conta WhatsApp autorizada');
    const subscribed=await graph('/'+waba_id+'/subscribed_apps',token,{method:'POST'});
    if(subscribed.success!==true)throw new Error('Assinatura do webhook não confirmada');
    const rawKey=new Uint8Array(encryptionHex.match(/.{2}/g)!.map(x=>parseInt(x,16)));
    const key=await crypto.subtle.importKey('raw',rawKey,{name:'AES-GCM'},false,['encrypt']);
    const iv=crypto.getRandomValues(new Uint8Array(12));
    const cipher=new Uint8Array(await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:new TextEncoder().encode(store_id)},key,new TextEncoder().encode(token)));
    const {error:credentialsError}=await admin.from('store_whatsapp_credentials').upsert({store_id,token_ciphertext:hex(cipher),token_iv:hex(iv),updated_at:new Date().toISOString()});
    if(credentialsError)throw new Error('Não foi possível proteger a credencial');
    const {error:connectionError}=await admin.from('store_whatsapp_connections').upsert({store_id,waba_id,phone_number_id,display_phone_number:phone,connection_status:'connected',connected_at:new Date().toISOString(),disconnected_at:null,updated_at:new Date().toISOString()});
    if(connectionError)throw new Error('Não foi possível registrar a conexão');
    return reply({connected:true,display_phone_number:phone});
  }catch(_error){
    // Do not log tokens, authorization codes or Meta API bodies.
    return reply({error:'A Meta não confirmou a conexão. Inicie um novo cadastro e tente novamente.'},502);
  }
});
