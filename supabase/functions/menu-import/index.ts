import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import {createClient} from "npm:@supabase/supabase-js@2.112.3";
import {parsePublicMenu} from "./parser.mjs";

const origins=new Set(["https://app.pitacco.com.br","https://admin.pitacco.com.br","https://pitacco.com.br","http://localhost:5173","http://localhost:4179","http://127.0.0.1:5173"]);
const maxHtml=2_000_000,maxPhoto=5_000_000;
const dnsCache=new Map<string,Promise<boolean>>();
function cors(req:Request){
 const origin=req.headers.get("Origin")||"";
 return {"Access-Control-Allow-Origin":origins.has(origin)?origin:"https://app.pitacco.com.br",
  "Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type, traceparent, tracestate, baggage",
  "Access-Control-Allow-Methods":"POST, OPTIONS", "Vary":"Origin"};
}
function reply(req:Request,body:unknown,status=200){
 return new Response(JSON.stringify(body),{status,headers:{...cors(req),"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store"}});
}
function fail(message:string,status=400):never{const e=new Error(message) as Error&{status?:number};e.status=status;throw e}
function addressPublic(ip:string){
 if(/^[0-9.]+$/.test(ip)){
  const x=ip.split(".").map(Number);
  if(x.length!==4||x.some(n=>!Number.isInteger(n)||n<0||n>255))return false;
  const [a,b,c]=x;
  return !(a===0||a===10||a===127||a>=224||a===169&&b===254||
    a===172&&b>=16&&b<=31||a===192&&b===168||a===100&&b>=64&&b<=127||
    a===192&&b===0&&c===0||a===192&&b===0&&c===2||
    a===198&&b===18||a===198&&b===19||a===198&&b===51&&c===100||
    a===203&&b===0&&c===113);
 }
 const low=ip.toLowerCase();
 if(!/^[a-f0-9:]+$/.test(low))return false;
 if(low==="::"||low==="::1"||low.startsWith("fc")||low.startsWith("fd")||
    /^fe[89ab]/.test(low)||low.startsWith("2001:db8:")||low.startsWith("::ffff:"))return false;
 return true;
}
function publicUrl(text:unknown){
 if(typeof text!=="string"||text.length>2048)fail("Informe um link HTTPS público válido.");
 let u:URL;try{u=new URL(text)}catch{fail("Link inválido");}
 if(u.protocol!=="https:"||u.port||u.username||u.password||u.hash)fail("Use um endereço HTTPS público, sem login ou porta especial.");
 const host=u.hostname.toLowerCase();
 if(host.length>250||!/^[a-z0-9.-]+$/.test(host)||!host.includes(".")||
  host==="localhost"||host.endsWith(".local")||host.endsWith(".internal")||
  host.endsWith(".test")||host.endsWith(".invalid")||host.endsWith(".localhost")||
  /^([0-9.]+|[a-f0-9:]+)$/.test(host))fail("Endereços privados ou locais não são permitidos.");
 return u;
}
async function assertPublicDns(host:string){
 if(!dnsCache.has(host))dnsCache.set(host,(async()=>{
  const answers:string[]=[];
  for(const type of ["A","AAAA"]){
   let response:Response;
   try{response=await fetch("https://cloudflare-dns.com/dns-query?name="+encodeURIComponent(host)+"&type="+type,{
    headers:{Accept:"application/dns-json"},signal:AbortSignal.timeout(4500)});
   }catch{fail("Não foi possível confirmar que o endereço é público. Tente novamente.",422);}
   if(!response.ok)fail("DNS indisponível para validar o site.",422);
   const info=await response.json();
   if(info.Status!==0&&info.Status!==3)fail("O endereço do site não pôde ser verificado.",422);
   for(const item of info.Answer||[]){
    if(item.type===1||item.type===28)answers.push(item.data);
   }
  }
  if(!answers.length||answers.some(x=>!addressPublic(x)))fail("O endereço não aponta exclusivamente para servidores públicos.",422);
  return true;
 })());
 return await dnsCache.get(host);
}
async function loadPublic(url:string,limit:number,accept:string,referer?:string){
 let target=publicUrl(url);
 for(let redirect=0;redirect<4;redirect++){
  await assertPublicDns(target.hostname);
  const headers:Record<string,string>={
   "User-Agent":"Mozilla/5.0 (compatible; PitaccoMenuImporter/1.0)",
   "Accept":accept
  };
  // Referência pública do próprio cardápio, sem cookies ou autenticação externa.
  if(referer){try{headers.Referer=publicUrl(referer).origin+"/";}catch{}}
  const response=await fetch(target.toString(),{
   method:"GET",redirect:"manual",headers,signal:AbortSignal.timeout(15000)});
  if([301,302,303,307,308].includes(response.status)){
   const location=response.headers.get("location");
   if(!location)fail("O site redirecionou sem informar o novo endereço.",422);
   target=publicUrl(new URL(location,target).toString().split("#")[0]);continue;
  }
  if(!response.ok){
   if([401,403,429].includes(response.status))fail("O site restringiu a leitura automática. Exporte o cardápio como CSV ou JSON para continuar.",422);
   fail("Não foi possível acessar esse cardápio (HTTP "+response.status+").",422);
  }
  const declared=Number(response.headers.get("content-length")||"0");
  if(declared>limit)fail("O arquivo excede o limite permitido.",422);
  const reader=response.body?.getReader();if(!reader)fail("O site não retornou conteúdo.",422);
  const chunks:Uint8Array[]=[];let length=0;
  try{
   while(true){
    const {done,value}=await reader.read();if(done)break;
    length+=value.length;if(length>limit)fail("O arquivo excede o limite permitido.",422);
    chunks.push(value);
   }
  }finally{reader.releaseLock();}
  const bytes=new Uint8Array(length);let offset=0;
  for(const item of chunks){bytes.set(item,offset);offset+=item.length;}
  return {bytes,type:response.headers.get("content-type")||"",url:target.toString()};
 }
 fail("O site redirecionou muitas vezes.",422);
}
function imageExtension(data:Uint8Array){
 if(data.length<100)return "";
 if(data[0]===255&&data[1]===216&&data[2]===255)return "jpg";
 if(data[0]===137&&data[1]===80&&data[2]===78&&data[3]===71)return "png";
 if(String.fromCharCode(...data.slice(0,4))==="RIFF"&&String.fromCharCode(...data.slice(8,12))==="WEBP")return "webp";
 return "";
}
function isUuid(x:unknown){return typeof x==="string"&&/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(x)}
// Quando um SPA só entrega a estrutura da loja, consultar EXCLUSIVAMENTE
// a ficha pública usada pelo próprio cardápio, sem rotas administrativas.
// Links de vitrines do iFood não são credenciais de acesso ao catálogo.
// A API oficial requer um vínculo OAuth concedido pelo gestor da MESMA loja.
function ifoodMerchantFromUrl(link:URL):string|null{
 const domain=link.hostname.toLowerCase();
 if(domain!=="www.ifood.com.br"&&domain!=="ifood.com.br")return null;
 const match=link.pathname.match(/^\/delivery\/[^/]+\/[^/]+\/([a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12})(?:\/|$)/i);
 return match?match[1].toLowerCase():null;
}
async function checkIfoodSource(source:URL,merchantId:string,storeId:string,supa:ReturnType<typeof createClient>){
 const [connections,linkStatus]=await Promise.all([
  supa.rpc("pitacco_ifood_connections",{p_store:storeId}),
  supa.rpc("pitacco_ifood_linking_status")
 ]);
 const list=Array.isArray(connections.data)?connections.data:[];
 const production=list.filter((item:{test_only?:boolean})=>item&&item.test_only!==true);
 const matching=production.find((item:{merchant_id?:string})=>String(item.merchant_id||"").toLowerCase()===merchantId);
 const linkEnabled=linkStatus.data===true;
 let sourceStatus="ifood_not_connected",message="";
 if(connections.error){
  sourceStatus="ifood_connection_unavailable";
  message="Não foi possível conferir o vínculo oficial desta loja com o iFood. Consulte Integrações ou utilize um arquivo exportado.";
 }else if(!matching&&production.length){
  sourceStatus="ifood_merchant_mismatch";
  message="A loja selecionada possui outra conta iFood cadastrada. Confira se a loja e o link pertencem ao mesmo estabelecimento. Nenhum produto foi importado.";
 }else if(!matching){
  sourceStatus="ifood_not_connected";
  message="Esta loja ainda não autorizou o acesso do Pitacco ao seu catálogo iFood. O link compartilhado não dá permissão para consultar itens, fotos, preços ou complementos.";
 }else if(matching.enabled!==true){
  sourceStatus="ifood_connection_disabled";
  message="O vínculo iFood desta loja está pausado. Reative a conta autorizada antes de usar uma integração de catálogo.";
 }else{
  sourceStatus="ifood_catalog_integration_required";
  message="O vínculo de pedidos foi encontrado, mas a importação autenticada do catálogo ainda não está habilitada. Um link de cliente não fornece os dados completos de produtos e complementos.";
 }
 const warnings=[message];
 if(sourceStatus==="ifood_not_connected"&&linkEnabled)
  warnings.push("Vincule primeiro o estabelecimento em Integrações → iFood, autorizando pelo Portal do Parceiro. Em seguida, a importação precisará da leitura oficial do catálogo.");
 else if(sourceStatus==="ifood_not_connected"&&!linkEnabled)
  warnings.push("O cadastro de novos vínculos iFood ainda aguarda homologação no Pitacco. Até sua liberação, use uma exportação do cardápio em CSV, JSON ou ZIP.");
 else
  warnings.push("Para importar sem alterar o cadastro atual, utilize um arquivo CSV, JSON ou ZIP com produtos e complementos. A prévia será mostrada antes de publicar.");
 return {products:[],sourceStatus,sourceProvider:"ifood",sourceTitle:"Cardápio iFood",
  sourceMerchantId:merchantId,canLinkIfood:linkEnabled,
  method:"conta de marketplace",counts:{products:0,groups:0,options:0,withPhotos:0},
  warnings,url:source.toString()};
}

async function inspectPublicDynamicCatalog(sourceUrl:string,parsed:ReturnType<typeof parsePublicMenu>){
 if(parsed.products.length)return parsed;
 let page:URL;try{page=new URL(sourceUrl)}catch{return parsed}
 if(!["instadelivery.com.br","www.instadelivery.com.br"].includes(page.hostname))return parsed;
 const slug=page.pathname.split("/").filter(Boolean)[0]||"";
 if(!/^[a-zA-Z0-9_-]{3,80}$/.test(slug))return parsed;
 try{
  const api="https://app.instadelivery.com.br/api/stores/by-slug/"+encodeURIComponent(slug);
  const response=await loadPublic(api,maxHtml,"application/json");
  if(!response.type.includes("json"))return parsed;
  const data=JSON.parse(new TextDecoder().decode(response.bytes));
  if(!data||typeof data!=="object"||!Array.isArray(data.groups))return parsed;
  // A própria resposta pública pode futuramente conter itens estruturados.
  const extra=parsePublicMenu(JSON.stringify(data),response.url,"application/json");
  if(extra.products.length)return {...extra,url:sourceUrl,method:"dados públicos do cardápio"};
  const categories=data.groups.filter((g:Record<string,unknown>)=>
   g&&typeof g==="object"&&g.deleted_at==null&&Number(g.is_invisible||0)!==1).length;
  return {...parsed,sourceStatus:"products_not_public",sourceTitle:String(data.name||"").slice(0,120),
   counts:{...parsed.counts,categories},
   warnings:[
    "A loja e "+categories+" categoria(s) foram encontradas, mas esse endereço não disponibilizou produtos aos visitantes. No acesso público, nenhum item com nome e preço foi apresentado.",
    "Confira se o cardápio de origem exibe os produtos para um cliente sem login. Para importar agora, utilize um arquivo CSV, JSON ou ZIP exportado pela loja."
   ]};
 }catch{
  // A ficha auxiliar pode não estar disponível; preservar o diagnóstico do HTML.
  return parsed;
 }
}

Deno.serve(async req=>{
 if(req.method==="OPTIONS")return new Response("ok",{headers:cors(req)});
 if(req.method!=="POST")return reply(req,{error:"Método não permitido"},405);
 try{
  const auth=req.headers.get("Authorization")||"";
  const token=auth.match(/^Bearer\s+(.+)$/i)?.[1];
  if(!token)fail("Entre na sua conta para importar o cardápio.",401);
  const key=Deno.env.get("SUPABASE_ANON_KEY")||Deno.env.get("SUPABASE_PUBLISHABLE_KEY")||"";
  const supa=createClient(Deno.env.get("SUPABASE_URL")||"",key,{global:{headers:{Authorization:auth}}});
  const {data:{user},error:authError}=await supa.auth.getUser(token);
  if(authError||!user)fail("Sessão expirada. Entre novamente.",401);
  const payload=await req.json();
  if(!isUuid(payload.store_id))fail("Selecione uma loja válida.");
  const {data:allowed,error:aclError}=await supa.rpc("pitacco_menu_import_allowed",{p_store:payload.store_id});
  if(aclError||allowed!==true)fail("Acesso negado ao catálogo desta loja.",403);
  if(payload.action==="scan"){
   const link=publicUrl(payload.url);
   const ifoodMerchant=ifoodMerchantFromUrl(link);
   if(ifoodMerchant){
    const inspected=await checkIfoodSource(link,ifoodMerchant,payload.store_id,supa);
    return reply(req,inspected);
   }
   const result=await loadPublic(link.toString(),maxHtml,"text/html,application/json;q=0.9,*/*;q=0.2");
   if(!result.type.includes("html")&&!result.type.includes("json")&&!result.type.includes("text"))fail("A URL não contém um cardápio legível.",422);
   let parsed=parsePublicMenu(new TextDecoder().decode(result.bytes),result.url,result.type);
   if(!parsed.products.length)parsed=await inspectPublicDynamicCatalog(result.url,parsed);
   return reply(req,{...parsed,url:result.url});
  }
  if(payload.action==="photos"){
   const photos=payload.photos;
   if(!Array.isArray(photos)||photos.length<1||photos.length>6)fail("Envie de 1 a 6 fotos por lote.");
   const result=[];
   for(const photo of photos){
    const id=String(photo.id||"").slice(0,120);
    try{
     const u=publicUrl(photo.url);
     const file=await loadPublic(u.toString(),maxPhoto,"image/webp,image/png,image/jpeg,image/*;q=0.8",payload.source_url);
     const extension=imageExtension(file.bytes);
     if(!extension)throw Error("Formato de imagem não permitido");
     const path="products/"+payload.store_id+"/"+crypto.randomUUID()+"."+extension;
     const mime=extension==="jpg"?"image/jpeg":"image/"+extension;
     const {error:storageError}=await supa.storage.from("pitacco-media").upload(path,file.bytes,{contentType:mime,upsert:false});
     if(storageError)throw Error(storageError.message);
     const {data:link}=supa.storage.from("pitacco-media").getPublicUrl(path);
     result.push({id,url:link.publicUrl});
    }catch(err){result.push({id,error:(err as Error).message||"Foto indisponível"});}
   }
   return reply(req,{photos:result});
  }
  fail("Ação de importação desconhecida.");
 }catch(error){
  const e=error as Error&{status?:number};
  return reply(req,{error:e.message||"Falha ao importar o cardápio."},e.status||400);
 }
});
