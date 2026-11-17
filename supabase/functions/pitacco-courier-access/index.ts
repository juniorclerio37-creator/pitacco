// Pitacco Entregador — administração de acessos; nunca distribuir a service_role ao navegador.
// Endpoints autenticados via JWT do Supabase; acesso gestor restrito ao estabelecimento.
import { createClient } from "npm:@supabase/supabase-js@2.57.0";

const url = Deno.env.get("SUPABASE_URL") ?? "";
const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const allowedOrigins = new Set([
  "https://pitacco.com.br", "https://www.pitacco.com.br",
  "https://app.pitacco.com.br", "https://entregador.pitacco.com.br",
  ...(Deno.env.get("PITACCO_ALLOWED_ORIGINS") ?? "").split(",").map(v => v.trim()).filter(Boolean),
]);
const idPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
function normalizePhone(value) {
  const digits = String(value ?? "").replace(/\D/g, "");
  const national = digits.startsWith("55") && digits.length === 13 ? digits.slice(2) : digits;
  if (!/^[1-9][0-9]9[0-9]{8}$/.test(national)) throw new Error("Telefone com DDD inválido");
  return "+55" + national;
}
function temporaryPassword() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#";
  const random = new Uint32Array(20);
  crypto.getRandomValues(random);
  return Array.from(random, number => chars[number % chars.length]).join("");
}
function json(req, status, body) {
  const origin = req.headers.get("origin") ?? "";
  const headers = { "Content-Type": "application/json", "Cache-Control": "no-store", "Vary": "Origin" };
  if (allowedOrigins.has(origin)) headers["Access-Control-Allow-Origin"] = origin;
  return new Response(JSON.stringify(body), {status, headers});
}
async function authorizeStore(userId, storeId) {
  if (!idPattern.test(String(storeId ?? ""))) return false;
  // Owner has access to every existing store, while members are scoped by store_id.
  // This RPC is service_role-only; actor is always derived from verified Auth JWT.
  const { data, error } = await admin.rpc("pitacco_can_manage_courier_store", {
    p_actor: userId,
    p_store: storeId,
  });
  if (error) throw error;
  return data === true;
}
async function myCourier(userId) {
  const {data, error} = await admin.from("couriers")
    .select("id,user_id,name,phone,store_id,active,available")
    .eq("user_id", userId).maybeSingle();
  if (error) throw error;
  return data;
}
async function registerDriver(body, actor) {
  const {storeId, name} = body;
  const cleanedName = String(name ?? "").trim();
  const phone = normalizePhone(body.phone);
  if (!idPattern.test(String(storeId ?? "")) || cleanedName.length < 2 || cleanedName.length > 100) {
    return [400, {error:"Informe loja, nome e telefone válidos"}];
  }
  if (!await authorizeStore(actor, storeId)) return [403, {error:"Sem permissão para esta loja"}];
  const password = temporaryPassword();
  const {data: created, error: authError} = await admin.auth.admin.createUser({
    phone, password, phone_confirm: true,
    user_metadata: {full_name: cleanedName},
    app_metadata: {pitacco_role: "courier"},
  });
  if (authError || !created?.user) return [409, {error:"Não foi possível cadastrar o telefone. Verifique se já existe um cadastro."}];
  const userId = created.user.id;
  try {
    const {data: profile, error: profileError} = await admin.from("profiles")
      .update({role:"entregador",full_name:cleanedName}).eq("id",userId).select("id").single();
    if (profileError || !profile) throw new Error("Perfil não disponível");
    const {data: courier, error: courierError} = await admin.from("couriers")
      .insert({user_id:userId,name:cleanedName,phone,fleet_type:"propria",store_id:storeId,active:true,available:false})
      .select("id,name,phone,store_id").single();
    if (courierError || !courier) throw new Error("Cadastro de entregador não disponível");
    const {error: stateError} = await admin.from("pitacco_courier_auth_state")
      .insert({user_id:userId,store_id:storeId,must_change_password:true,credentials_issued_at:new Date().toISOString()});
    if (stateError) throw new Error("Controle de credencial não disponível");
    return [201,{courier,temporaryPassword:password,mustChangePassword:true}];
  } catch (e) {
    // A criação da conta é revertida se o vínculo com a loja não puder ser concluído.
    const {error: rollbackError} = await admin.auth.admin.deleteUser(userId);
    if (rollbackError) console.error("Falha ao reverter cadastro do entregador", { userId });
    console.error("Erro no cadastro do entregador", String(e));
    return [500,{error:"Cadastro não concluído. Tente novamente."}];
  }
}
async function resetDriver(body, actor) {
  const {storeId, courierId} = body;
  if (!idPattern.test(String(storeId ?? "")) || !idPattern.test(String(courierId ?? ""))) return [400,{error:"Dados inválidos"}];
  if (!await authorizeStore(actor, storeId)) return [403,{error:"Sem permissão para esta loja"}];
  const {data:courier,error} = await admin.from("couriers")
    .select("id,user_id,active,store_id").eq("id",courierId).eq("store_id",storeId).maybeSingle();
  if (error || !courier) return [404,{error:"Entregador não encontrado nesta loja"}];
  const {data: state,error: stateErr} = await admin.from("pitacco_courier_auth_state")
    .update({must_change_password:true}).eq("user_id",courier.user_id).eq("store_id",storeId).select("user_id").maybeSingle();
  if (stateErr || !state) return [409,{error:"Cadastro de acesso incompleto; solicite suporte"}];
  const password = temporaryPassword();
  const {error:authError} = await admin.auth.admin.updateUserById(courier.user_id,{password});
  if (authError) return [500,{error:"Não foi possível redefinir a senha"}];
  const {error:finishErr} = await admin.from("pitacco_courier_auth_state")
    .update({must_change_password:true,credentials_issued_at:new Date().toISOString(),password_changed_at:null})
    .eq("user_id",courier.user_id).eq("store_id",storeId);
  if (finishErr) return [500,{error:"Senha redefinida, mas acesso bloqueado. Redefina novamente."}];
  return [200,{courierId,temporaryPassword:password,mustChangePassword:true}];
}
async function reactivateDriver(body, actor) {
  const {storeId, courierId} = body;
  if (!idPattern.test(String(storeId ?? "")) || !idPattern.test(String(courierId ?? ""))) return [400,{error:"Dados inválidos"}];
  if (!await authorizeStore(actor,storeId)) return [403,{error:"Sem permissão para esta loja"}];
  const {data: courier,error:findError}=await admin.from("couriers")
    .select("id,active").eq("id",courierId).eq("store_id",storeId).maybeSingle();
  if (findError || !courier) return [404,{error:"Entregador não encontrado"}];
  if (courier.active) return [409,{error:"Entregador já está ativo"}];
  const [code,out]=await resetDriver(body,actor);
  if (code!==200) return [code,out];
  const {error}=await admin.from("couriers")
    .update({active:true,available:false}).eq("id",courierId).eq("store_id",storeId);
  if (error) return [500,{error:"Senha redefinida, porém reativação incompleta. Solicite suporte."}];
  return [200,{courierId,active:true,temporaryPassword:out.temporaryPassword,mustChangePassword:true}];
}
async function listDrivers(body, actor) {
  const storeId = body.storeId;
  if (!await authorizeStore(actor,storeId)) return [403,{error:"Sem permissão para esta loja"}];
  const {data,error}=await admin.from("couriers").select("id,name,phone,active,available")
    .eq("store_id",storeId).order("name");
  if (error) throw error;
  return [200,{couriers:data??[]}];
}
async function disableDriver(body, actor) {
  const {storeId,courierId} = body;
  if (!idPattern.test(String(storeId ?? "")) || !idPattern.test(String(courierId ?? ""))) return [400,{error:"Dados inválidos"}];
  if (!await authorizeStore(actor,storeId)) return [403,{error:"Sem permissão para esta loja"}];
  const {data:courier,error:findError} = await admin.from("couriers").select("user_id")
    .eq("id",courierId).eq("store_id",storeId).maybeSingle();
  if (findError || !courier) return [404,{error:"Entregador não encontrado"}];
  const {error:stateError} = await admin.from("pitacco_courier_auth_state")
    .update({must_change_password:true}).eq("user_id",courier.user_id);
  if (stateError) return [500,{error:"Não foi possível bloquear credenciais"}];
  const {error} = await admin.from("couriers").update({active:false,available:false})
    .eq("id",courierId).eq("store_id",storeId);
  if (error) return [500,{error:"Não foi possível desativar o entregador"}];
  return [200,{courierId,active:false}];
}
async function driverStatus(actor) {
  const courier=await myCourier(actor);
  if (!courier || !courier.active) return [403,{error:"Entregador não cadastrado ou desativado"}];
  const {data:state,error} = await admin.from("pitacco_courier_auth_state")
    .select("must_change_password").eq("user_id",actor).maybeSingle();
  if (error || !state) return [403,{error:"Acesso ainda não configurado"}];
  return [200,{courier:{id:courier.id,storeId:courier.store_id,name:courier.name},
    mustChangePassword:state.must_change_password}];
}
async function changePassword(body, actor, user) {
  const courier=await myCourier(actor);
  if (!courier || !courier.active) return [403,{error:"Entregador não autorizado"}];
  const current=String(body.currentPassword??"");
  const next=String(body.newPassword??"");
  if (next.length < 12 || next.length > 128 || !/[a-z]/.test(next) || !/[A-Z]/.test(next) ||
      !/[0-9]/.test(next) || current===next) return [400,{error:"Use uma nova senha de 12 caracteres, com letras maiúsculas, minúsculas e números"}];
  if (!anonKey || !user.phone) return [503,{error:"Verificação de senha indisponível"}];
  const checkClient=createClient(url,anonKey,{auth:{persistSession:false,autoRefreshToken:false}});
  const {data:proof,error:proofError}=await checkClient.auth.signInWithPassword({
    phone:user.phone,password:current
  });
  if (proofError || proof?.user?.id!==actor) return [401,{error:"Senha atual incorreta"}];
  const {data: state,error:stateError}=await admin.from("pitacco_courier_auth_state")
    .select("must_change_password").eq("user_id",actor).maybeSingle();
  if (stateError || !state) return [403,{error:"Acesso não configurado"}];
  const {error:authError}=await admin.auth.admin.updateUserById(actor,{password:next});
  if (authError) return [500,{error:"Não foi possível trocar a senha"}];
  const {error:upsertError}=await admin.from("pitacco_courier_auth_state")
    .update({must_change_password:false,password_changed_at:new Date().toISOString()})
    .eq("user_id",actor).eq("store_id",courier.store_id);
  if (upsertError) return [500,{error:"Senha alterada, mas liberação pendente. Procure a loja."}];
  return [200,{passwordChanged:true,signInAgain:true}];
}
Deno.serve(async(req)=>{
  const origin=req.headers.get("origin")??"";
  if (origin && !allowedOrigins.has(origin)) return json(req,403,{error:"Origem não autorizada"});
  if (req.method==="OPTIONS") {
    return new Response(null,{status:204,headers:{
      "Access-Control-Allow-Origin": origin,
      "Access-Control-Allow-Headers":"authorization,apikey,content-type,x-client-info",
      "Access-Control-Allow-Methods":"POST,OPTIONS",
      "Access-Control-Max-Age":"600","Vary":"Origin",
    }});
  }
  if (req.method!=="POST") return json(req,405,{error:"Método não permitido"});
  if (!url || !serviceKey) return json(req,503,{error:"Serviço indisponível"});
  if (Number(req.headers.get("content-length")??0)>8192) return json(req,413,{error:"Requisição muito grande"});
  const bearer=req.headers.get("authorization")??"";
  const jwt=/^Bearer (.+)$/i.exec(bearer)?.[1]??"";
  if (!jwt) return json(req,401,{error:"Autenticação necessária"});
  try {
    const {data:session,error:sessionError}=await admin.auth.getUser(jwt);
    if (sessionError || !session?.user) return json(req,401,{error:"Sessão inválida"});
    const body=await req.json();
    const action=String(body?.action??"");
    let result;
    if (["create","reset","list","disable","reactivate"].includes(action)) {
      if (action==="create") result=await registerDriver(body,session.user.id);
      if (action==="reset") result=await resetDriver(body,session.user.id);
      if (action==="list") result=await listDrivers(body,session.user.id);
      if (action==="disable") result=await disableDriver(body,session.user.id);
      if (action==="reactivate") result=await reactivateDriver(body,session.user.id);
    } else if(action==="status") result=await driverStatus(session.user.id);
    else if(action==="change-password") result=await changePassword(body,session.user.id,session.user);
    else return json(req,400,{error:"Operação desconhecida"});
    return json(req,result[0],result[1]);
  }catch(err){
    console.error("Erro em pitacco-courier-access",String(err));
    return json(req,500,{error:"Não foi possível concluir a operação"});
  }
});
