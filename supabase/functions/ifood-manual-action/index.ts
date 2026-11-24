// Manual iFood accept / cancellation for the Pitacco web and Windows clients.
// Responses from iFood are asynchronous. Only webhook events finalize an order.
const root = "https://merchant-api.ifood.com.br";
const uuid = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
const allowedOrigins = new Set([
  "https://app.pitacco.com.br",
  "https://admin.pitacco.com.br",
  "https://pitacco.com.br",
  "https://www.pitacco.com.br",
  "http://tauri.localhost",
  "https://tauri.localhost",
  "tauri://localhost",
  "http://localhost:1420",
]);
const env = (key: string) => Deno.env.get(key) || "";
const projectUrl = env("SUPABASE_URL");
const publishable = env("SUPABASE_ANON_KEY") || env("SUPABASE_PUBLISHABLE_KEY");
const service = env("SUPABASE_SERVICE_ROLE_KEY");
type ObjectData = Record<string, unknown>;
type Context = { actor: string; orderId: string };

function headersFor(request: Request): Headers {
  const headers = new Headers({
    "cache-control": "no-store",
    "content-type": "application/json; charset=utf-8",
    "vary": "Origin",
  });
  const origin = request.headers.get("origin");
  if (origin && allowedOrigins.has(origin)) {
    headers.set("access-control-allow-origin", origin);
    headers.set("access-control-allow-methods", "POST, OPTIONS");
    headers.set("access-control-allow-headers",
      "authorization, apikey, content-type, x-client-info, x-supabase-api-version");
  }
  return headers;
}
const reply = (req: Request, status: number, data: ObjectData): Response =>
  new Response(JSON.stringify(data), { status, headers: headersFor(req) });

async function requestRpc(name: string, body: ObjectData): Promise<unknown> {
  const result = await fetch(new URL("/rest/v1/rpc/" + name, projectUrl), {
    method: "POST",
    headers: {
      "apikey": service,
      "authorization": "Bearer " + service,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(6500),
    redirect: "error",
  });
  const data = result.status === 204 ? null : await result.json().catch(() => null);
  if (!result.ok) {
    const error = data && typeof data.message === "string"
      ? data.message : "Falha ao validar o pedido no Pitacco.";
    throw Object.assign(new Error(error), { code: result.status });
  }
  return data;
}
async function validateUser(request: Request): Promise<string> {
  const authorization = request.headers.get("authorization") || "";
  if (!/^Bearer \S+$/.test(authorization)) throw Object.assign(new Error("Faça login no Pitacco."),{ code:401 });
  const result = await fetch(new URL("/auth/v1/user", projectUrl), {
    headers: { "apikey": publishable, authorization },
    signal: AbortSignal.timeout(6500),
    redirect: "error",
  });
  if (!result.ok) throw Object.assign(new Error("Sessão expirada. Entre novamente no Pitacco."), { code:401 });
  const user = await result.json();
  if (!uuid.test(user?.id ?? "")) throw Object.assign(new Error("Conta inválida."), { code:401 });
  return user.id;
}
async function getIfoodToken(): Promise<string> {
  const response = await fetch(root + "/authentication/v1.0/oauth/token", {
    method: "POST",
    body: new URLSearchParams({
      clientId: env("IFOOD_CLIENT_ID"),
      clientSecret: env("IFOOD_CLIENT_SECRET"),
      grantType: "client_credentials",
    }),
    signal: AbortSignal.timeout(8000),
    redirect: "error",
  });
  if (!response.ok) throw Object.assign(new Error("Autenticação iFood indisponível."),{ code:503 });
  const payload = await response.json();
  if (typeof payload.accessToken !== "string" || !payload.accessToken) {
    throw Object.assign(new Error("Token iFood inválido."),{ code:503 });
  }
  return payload.accessToken;
}
async function fetchReasons(externalId: string, token: string):
  Promise<Array<{code: string; description: string}>> {
  const response = await fetch(root + "/order/v1.0/orders/" + externalId + "/cancellationReasons", {
    headers: { authorization: "Bearer " + token },
    signal: AbortSignal.timeout(8000),
    redirect: "error",
  });
  if (response.status === 204) return [];
  if (!response.ok) {
    console.warn("ifood cancellation reasons upstream HTTP", response.status);
    const message = response.status === 401 || response.status === 403
      ? "O iFood recusou a autorização para consultar motivos de cancelamento."
      : response.status === 404 || response.status === 409 || response.status === 422
      ? "O iFood não disponibilizou motivos para este pedido no estado atual."
      : "Consulta dos motivos de cancelamento indisponível no iFood (HTTP " + response.status + ").";
    throw Object.assign(new Error(message), {code:409});
  }
  const body = await response.json().catch(() => null);
  const rows = Array.isArray(body) ? body : body?.reasons;
  if (!Array.isArray(rows)) {
    console.warn("ifood cancellation reasons unexpected format", body && typeof body === "object" ? Object.keys(body).slice(0,12) : typeof body);
    throw Object.assign(new Error("O iFood retornou os motivos em um formato não reconhecido."),{code:409});
  }
  const reasons = rows.flatMap((row: unknown) => {
    if (!row || typeof row !== "object") return [];
    const r = row as Record<string,unknown>;
    const raw = r.code ?? r.cancelCodeId ?? r.cancellationCode;
    const code = typeof raw === "string" || typeof raw === "number" ? String(raw) : "";
    if (!/^[0-9]{2,6}$/.test(code) || typeof r.description !== "string" || !r.description.trim()) return [];
    return [{code,description:r.description.slice(0,150)}];
  }).slice(0,100);
  console.info("ifood cancellation reasons parsed", {count:reasons.length,format:Array.isArray(body)?"array":"reasons"});
  if (rows.length && !reasons.length) throw Object.assign(new Error("Nenhum código válido foi reconhecido na resposta do iFood."),{code:409});
  return reasons;
}
async function markFailure(action: "accept"|"cancel", orderId:string, category:string):Promise<void>{
  const endpoint=action==="accept"?"pitacco_ifood_manual_failure":"pitacco_ifood_manual_cancel_failure";
  const body=action==="accept"
    ?{p_order:orderId,p_code:category}
    :{p_order:orderId,p_error:category};
  try { await requestRpc(endpoint,body); } catch { /* audit is best effort, do not leak credentials */ }
}
function requestInfo(value: unknown): {status:string; external_order_id?:string;merchant_id?:string} {
  if (!value || typeof value !== "object") throw Error("Pedido sem autorização.");
  return value as {status:string;external_order_id?:string;merchant_id?:string};
}

Deno.serve(async (request: Request):Promise<Response> => {
  if (request.method === "OPTIONS") {
    const headers = headersFor(request);
    return new Response(null, {status: request.headers.get("origin") && !allowedOrigins.has(request.headers.get("origin")!) ? 403 : 204, headers});
  }
  if (request.method !== "POST") return reply(request,405,{error:"Use POST."});
  const origin=request.headers.get("origin");
  if(origin && !allowedOrigins.has(origin))return reply(request,403,{error:"Origem não autorizada."});
  if(!projectUrl || !publishable || !service ||
    !env("IFOOD_CLIENT_ID") || !env("IFOOD_CLIENT_SECRET"))
    return reply(request,503,{error:"O servidor iFood ainda não está configurado."});

  let params: {action?:unknown;order_id?:unknown;reason?:unknown};
  try{
    const raw=await request.text();
    if(raw.length>4096)throw Error();
    params=JSON.parse(raw);
  }catch{return reply(request,400,{error:"Solicitação inválida."});}
  if(!params || !["accept","reasons","cancel"].includes(String(params.action)) ||
    typeof params.order_id!=="string" || !uuid.test(params.order_id)) {
    return reply(request,400,{error:"Pedido ou ação inválidos."});
  }
  const action=params.action as "accept"|"reasons"|"cancel";
  const orderId=params.order_id;
  if(action==="cancel" &&
     (typeof params.reason!=="string"||!/^[0-9]{2,6}$/.test(params.reason))) {
    return reply(request,400,{error:"Selecione um motivo de cancelamento válido."});
  }
  let actor:string;
  try{actor=await validateUser(request);}
  catch(e){return reply(request,(e as {code?:number}).code||401,{error:(e as Error).message});}

  let claimed=false;
  try{
    const lookup=requestInfo(await requestRpc("pitacco_ifood_manual_access",{
      p_order:orderId,p_actor:actor,
    }));
    if(!uuid.test(lookup.external_order_id||""))return reply(request,409,{error:"Vínculo iFood indisponível."});
    if(action==="reasons"&&
        (lookup as unknown as ObjectData).cancel_pending===true)
      return reply(request,409,{error:"Já existe cancelamento aguardando o iFood."});
    if(action==="reasons"&&
        (lookup as unknown as ObjectData).accept_pending===true)
      return reply(request,409,{error:"Já existe aceite aguardando o iFood."});

    if(action==="accept"){
      const claim=requestInfo(await requestRpc("pitacco_ifood_manual_request",{
        p_order:orderId,p_actor:actor,
      }));
      if(claim.status==="already_requested")
        return reply(request,202,{status:"already_requested"});
      if(claim.status!=="requested"||claim.external_order_id!==lookup.external_order_id)
        return reply(request,409,{error:"Não foi possível reservar o aceite."});
      claimed=true;
      const token=await getIfoodToken();
      const response=await fetch(root+"/order/v1.0/orders/"+claim.external_order_id+"/confirm",{
        method:"POST",
        headers:{authorization:"Bearer "+token},
        signal:AbortSignal.timeout(8000),
        redirect:"error",
      });
      if(response.status!==202){
        await markFailure("accept",orderId,"confirm-"+response.status);
        return reply(request,response.status===400||response.status===404||response.status===409?409:503,{
          error:"O iFood não aceitou a confirmação. Verifique o pedido na plataforma.",
        });
      }
      return reply(request,202,{status:"requested",message:"Aguardando evento CONFIRMED."});
    }
    const token=await getIfoodToken();
    const reasons=await fetchReasons(lookup.external_order_id,token);
    if(action==="reasons")return reply(request,200,{reasons});
    const reason=params.reason as string;
    const selectedReason=reasons.find(item=>item.code===reason);
    if(!selectedReason)
      return reply(request,409,{error:"Motivo não autorizado pelo iFood para este pedido."});
    const claim=requestInfo(await requestRpc("pitacco_ifood_manual_cancel_request",{
      p_order:orderId,p_actor:actor,p_reason:reason,
    }));
    if(claim.status==="already_requested")return reply(request,202,{status:"already_requested"});
    if(claim.status!=="requested"||claim.external_order_id!==lookup.external_order_id)
      return reply(request,409,{error:"Não foi possível reservar o cancelamento."});
    claimed=true;
    const provider=await fetch(root+"/order/v1.0/orders/"+claim.external_order_id+"/requestCancellation",{
      method:"POST",
      headers:{authorization:"Bearer "+token,"content-type":"application/json"},
      body:JSON.stringify({cancellationCode:reason,reason:selectedReason.description}),
      signal:AbortSignal.timeout(8000),
      redirect:"error",
    });
    if(provider.status!==202){
      const detail=await provider.json().catch(()=>null);
      const candidates=[detail?.message,detail?.error?.message,detail?.error?.details,detail?.errors?.[0]?.message].filter(v=>typeof v==="string");
      const raw=candidates.join(" ").toLowerCase();
      const category=/time|prazo|expired|expir/.test(raw)?"deadline":/cancelcode|cancellationcode|reason|motivo|field|required|invalid|mandatory/.test(raw)?"validation":/status|state|estado/.test(raw)?"order-state":"unknown";
      console.warn("ifood cancellation rejected", {status:provider.status,category,fields:detail&&typeof detail==="object"?Object.keys(detail).slice(0,12):[]});
      await markFailure("cancel",orderId,"cancel-"+provider.status+"-"+category);
      return reply(request,provider.status===400||provider.status===404||provider.status===409?409:503,{
        error:category==="deadline"?"O iFood informa que o prazo para cancelamento terminou.":category==="validation"?"O iFood rejeitou os dados do cancelamento (HTTP "+provider.status+").":category==="order-state"?"O iFood não permite cancelar no estado atual do pedido.":"O iFood recusou o cancelamento (HTTP "+provider.status+"). Confira o estado do pedido.",
      });
    }
    return reply(request,202,{status:"requested",message:"Aguardando evento CANCELLED ou CANCELLATION_REQUEST_FAILED."});
  }catch(e){
    // Unknown network outcomes must not be silently retried, as the iFood may
    // already have accepted the request. The UI reports "status uncertain".
    if(claimed){
      return reply(request,503,{error:"O resultado da operação está pendente. Confira o iFood antes de tentar novamente."});
    }
    const code=(e as {code?:number}).code;
    console.warn("ifood manual action failed", {action,code:code||0,category:e instanceof Error?e.name:"unknown"});
    return reply(request,code===401||code===403?403:code===400||code===409?409:503,{
      error:code===401||code===403?"Sem autorização para este pedido.":
        code===400||code===409?(e as Error).message:"Integração iFood temporariamente indisponível.",
    });
  }
});
