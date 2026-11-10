// Supabase Edge Function: whatsapp-connect-start
// Secrets: META_APP_ID, META_EMBEDDED_CONFIG_ID. SUPABASE_URL and keys injected by Supabase.
// Uses service role only for creating a short-lived anti-CSRF session.
import { createClient } from 'npm:@supabase/supabase-js@2';
const headers={'Access-Control-Allow-Origin':Deno.env.get('PITACCO_WEB_ORIGIN')||'https://pitacco.com.br','Access-Control-Allow-Headers':'authorization,apikey,content-type','Access-Control-Allow-Methods':'POST,OPTIONS','Content-Type':'application/json'};
const response=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers});
Deno.serve(async req=>{
 if(req.method==='OPTIONS')return new Response(null,{headers});
 if(req.method!=='POST')return response({error:'Método não permitido'},405);
 try{
  const bearer=req.headers.get('Authorization')||'';
  if(!bearer.startsWith('Bearer '))return response({error:'Autenticação necessária'},401);
  const url=Deno.env.get('SUPABASE_URL')!,anon=Deno.env.get('SUPABASE_ANON_KEY')!,service=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const userClient=createClient(url,anon,{global:{headers:{Authorization:bearer}}});
  const {data:{user},error:authError}=await userClient.auth.getUser();
  if(authError||!user)return response({error:'Sessão inválida'},401);
  const {store_id}=await req.json();
  if(typeof store_id!=='string'||! /^[0-9a-f-]{36}$/i.test(store_id))return response({error:'Loja inválida'},400);
  const {data:allowed,error:permissionError}=await userClient.rpc('is_store_manager',{p_store_id:store_id});
  // Some existing installations expose is_store_manager as SQL helper, not RPC.
  // Fail closed until permission RPC is confirmed, never grant access on error.
  if(permissionError||allowed!==true)return response({error:'Sem permissão para esta loja'},403);
  const appId=Deno.env.get('META_APP_ID'),configId=Deno.env.get('META_EMBEDDED_CONFIG_ID');
  if(!appId||!configId)return response({error:'Meta ainda não configurada no servidor'},503);
  const raw=new Uint8Array(32);crypto.getRandomValues(raw);
  const state=Array.from(raw,b=>b.toString(16).padStart(2,'0')).join('');
  const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(state));
  const stateHash=Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,'0')).join('');
  const admin=createClient(url,service);
  const {error}=await admin.from('store_whatsapp_onboarding_sessions').insert({store_id,requested_by:user.id,state_hash:stateHash,expires_at:new Date(Date.now()+10*60_000).toISOString()});
  if(error)throw error;
  return response({app_id:appId,config_id:configId,state,expires_in:600});
 }catch(e){return response({error:'Falha ao iniciar conexão'},500)}
});
