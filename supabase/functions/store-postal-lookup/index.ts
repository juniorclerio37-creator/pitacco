import {createClient} from 'npm:@supabase/supabase-js@2.57.0';
import {resolvePostalAddress} from './postal-provider.mjs';
const origins=new Set(['https://pitacco.com.br','https://www.pitacco.com.br','https://app.pitacco.com.br','http://tauri.localhost','https://tauri.localhost']);
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
Deno.serve(async(req)=>{
 const origin=req.headers.get('origin')||'';
 const headers={'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','Vary':'Origin',
  ...(origins.has(origin)?{'Access-Control-Allow-Origin':origin,'Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type','Access-Control-Allow-Methods':'POST, OPTIONS'}:{})};
 const respond=(status:number,data:unknown)=>new Response(JSON.stringify(data),{status,headers});
 if(!origins.has(origin))return respond(403,{error:'Origem não autorizada.'});
 if(req.method==='OPTIONS')return new Response(null,{status:204,headers});
 if(req.method!=='POST')return respond(405,{error:'Método não permitido.'});
 const token=(req.headers.get('authorization')||'').replace(/^Bearer\s+/i,'');
 if(!token)return respond(401,{error:'Sessão inválida.'});
 try{
  const body=await req.json(),cep=String(body.cep??''),store=String(body.store_id??'');
  if(!/^\d{8}$/.test(cep)||!uuid.test(store))return respond(400,{error:'CEP ou loja inválidos.'});
  const url=Deno.env.get('SUPABASE_URL'),key=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if(!url||!key)return respond(503,{error:'Consulta de CEP indisponível.'});
  const db=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
  const {data:identity,error:authError}=await db.auth.getUser(token);
  if(authError||!identity.user)return respond(401,{error:'Sessão inválida.'});
  const permission=await db.rpc('pitacco_can_manage_courier_store',{p_actor:identity.user.id,p_store:store});
  if(permission.error||permission.data!==true)return respond(403,{error:'Sem permissão para consultar dados desta loja.'});
  const limit=await db.rpc('pitacco_service_delivery_quote_limit',{p_scope:'store-postal-'+identity.user.id,p_max:60,p_minutes:60});
  if(limit.error)return respond(503,{error:'Consulta de CEP indisponível.'});
  if(!limit.data)return respond(429,{error:'Aguarde antes de consultar outro CEP.'});
  const result=await resolvePostalAddress(cep);
  return respond(result.status,result.status===200?{cep:result.cep,address:result.address}:{error:result.error});
 }catch{return respond(503,{error:'Consulta de CEP indisponível.'});}
});
