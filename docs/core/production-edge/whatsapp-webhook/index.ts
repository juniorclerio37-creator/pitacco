// Pitacco Meta webhook. Verify GET challenge and signed POST before persisting delivery receipts.
// Secrets: META_WEBHOOK_VERIFY_TOKEN, META_APP_SECRET. Supabase built-in server credentials.
import {createClient} from "npm:@supabase/supabase-js@2.57.0";
const enc=new TextEncoder();
const hex=(b:Uint8Array)=>Array.from(b,x=>x.toString(16).padStart(2,"0")).join("");
const equal=(a:string,b:string)=>{if(a.length!==b.length)return false;let d=0;for(let i=0;i<a.length;i++)d|=a.charCodeAt(i)^b.charCodeAt(i);return d===0};
async function signed(body:string,sig:string,secret:string){
 if(!/^sha256=[0-9a-f]{64}$/i.test(sig))return false;
 const k=await crypto.subtle.importKey("raw",enc.encode(secret),{name:"HMAC",hash:"SHA-256"},false,["sign"]);
 const hash=await crypto.subtle.sign("HMAC",k,enc.encode(body));
 return equal("sha256="+hex(new Uint8Array(hash)),sig.toLowerCase());
}
Deno.serve(async req=>{
 const url=new URL(req.url);
 if(req.method==="GET"){
  const token=Deno.env.get("META_WEBHOOK_VERIFY_TOKEN");
  const supplied=url.searchParams.get("hub.verify_token");
  const challenge=url.searchParams.get("hub.challenge");
  if(!token)return new Response("Not configured",{status:503});
  if(url.searchParams.get("hub.mode")==="subscribe"&&supplied&&equal(supplied,token)&&challenge!==null)
   return new Response(challenge,{headers:{"Content-Type":"text/plain"}});
  return new Response("Forbidden",{status:403});
 }
 if(req.method!=="POST")return new Response("Method not allowed",{status:405,headers:{"Allow":"GET, POST"}});
 const secret=Deno.env.get("META_APP_SECRET");
 if(!secret)return new Response("Not configured",{status:503});
 const raw=await req.text();
 if(raw.length>1048576)return new Response("Payload too large",{status:413});
 if(!await signed(raw,req.headers.get("x-hub-signature-256")||"",secret))return new Response("Unauthorized",{status:401});
 let payload:any;
 try{payload=JSON.parse(raw)}catch{return new Response("Invalid JSON",{status:400})}
 if(payload?.object!=="whatsapp_business_account"||!Array.isArray(payload.entry))return new Response("Invalid payload",{status:400});
 const rows:Record<string,unknown>[]=[];
 for(const entry of payload.entry.slice(0,100)){
  for(const change of (Array.isArray(entry?.changes)?entry.changes:[]).slice(0,100)){
   if(change?.field!=="messages")continue;
   const phone=change?.value?.metadata?.phone_number_id;
   if(typeof phone!=="string"||!/^[0-9]{5,30}$/.test(phone))continue;
   for(const s of (Array.isArray(change?.value?.statuses)?change.value.statuses:[]).slice(0,100)){
    if(typeof s?.id!=="string"||!/^wamid\.[A-Za-z0-9_\-=.]{4,500}$/.test(s.id))continue;
    const status=["sent","delivered","read","failed","deleted"].includes(s.status)?s.status:"unknown";
    const stamp=typeof s.timestamp==="string"&&/^\d{9,12}$/.test(s.timestamp)?Number(s.timestamp):null;
    const err=s.errors?.[0]?.code;
    rows.push({meta_message_id:s.id,phone_number_id:phone,delivery_status:status,meta_timestamp:stamp?new Date(stamp*1000).toISOString():null,error_code:typeof err==="number"?String(err):null});
   }
  }
 }
 if(rows.length){
  const endpoint=Deno.env.get("SUPABASE_URL"),key=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if(!endpoint||!key)return new Response("Database unavailable",{status:503});
  const admin=createClient(endpoint,key,{auth:{persistSession:false,autoRefreshToken:false}});
  const {error}=await admin.from("pitacco_whatsapp_delivery_events").upsert(rows,{onConflict:"meta_message_id,delivery_status",ignoreDuplicates:true});
  if(error)return new Response("Storage unavailable",{status:503});
 }
 return new Response("EVENT_RECEIVED",{status:200,headers:{"Content-Type":"text/plain"}});
});