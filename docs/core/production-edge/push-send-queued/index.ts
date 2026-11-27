import { createClient } from "npm:@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";
const url=Deno.env.get("SUPABASE_URL")||"";
const key=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")||"";
const vapidPublic=Deno.env.get("PITACCO_VAPID_PUBLIC_KEY")||"";
const vapidPrivate=Deno.env.get("PITACCO_VAPID_PRIVATE_KEY")||"";
const vapidSubject=Deno.env.get("PITACCO_VAPID_SUBJECT")||"mailto:suporte@pitacco.com.br";
const json=(obj:unknown,status=200)=>new Response(JSON.stringify(obj),{status,headers:{"content-type":"application/json","cache-control":"no-store"}});
const validPushHost=(endpoint:string)=>{try{const u=new URL(endpoint);return u.protocol==="https:"&&u.username===""&&u.password===""&&(u.hostname==="fcm.googleapis.com"||u.hostname==="updates.push.services.mozilla.com"||u.hostname==="web.push.apple.com"||u.hostname.endsWith(".push.apple.com")||u.hostname==="push.services.mozilla.com"||u.hostname==="updates.push.services.mozilla.org"||u.hostname==="push.services.mozilla.org")}catch{return false}};
Deno.serve(async(req)=>{
 if(req.method!=="POST")return json({error:"Method not allowed"},405);
 const supplied=req.headers.get("apikey")||"";
 if(!key||!supplied.startsWith("sb_secret_")||supplied.length>512)return json({error:"Unauthorized"},401);
 const verification=await fetch(url+"/rest/v1/rpc/pitacco_push_service_authorized",{method:"POST",headers:{"apikey":supplied,"authorization":"Bearer "+supplied,"content-type":"application/json"},body:"{}"}).catch(()=>null);
 if(!verification||!verification.ok||await verification.text()!=="true")return json({error:"Unauthorized"},401);
 if(!vapidPublic||!vapidPrivate)return json({error:"VAPID secrets not configured"},503);
 webpush.setVapidDetails(vapidSubject.includes(":")?vapidSubject:"mailto:"+vapidSubject,vapidPublic,vapidPrivate);
 const supabase=createClient(url,key,{auth:{persistSession:false}});
 const {data:jobs,error}=await supabase.rpc("pitacco_claim_push_events",{p_limit:20});
 if(error)return json({error:"Queue unavailable"},500);
 let sent=0,failed=0,removed=0;
 for(const job of jobs||[]){
  try{
   const {data:checkout,error:ce}=await supabase.from("public_checkouts").select("tracking_token,expires_at").eq("order_id",job.order_id).maybeSingle();
   if(ce)throw ce;
   if(!checkout||new Date(checkout.expires_at).getTime()<Date.now()){await supabase.rpc("pitacco_finish_push_event",{p_id:job.id,p_success:true});continue}
   const {data:subs,error:se}=await supabase.from("public_order_push_subscriptions").select("id,endpoint,p256dh,auth_secret").eq("order_id",job.order_id).limit(100);
   if(se)throw se;
   let errors=0;
   for(const sub of subs||[]){
    if(!validPushHost(sub.endpoint)){errors++;continue}
    try{
     const payload=JSON.stringify({title:"Pitacco — "+job.title,body:job.body,url:"/acompanhar/?token="+checkout.tracking_token,tag:"pitacco-"+job.order_id+"-"+job.event_key});
     await webpush.sendNotification({endpoint:sub.endpoint,keys:{p256dh:sub.p256dh,auth:sub.auth_secret}},payload,{TTL:3600,urgency:"normal"});
     sent++;
    }catch(e){
     if(e?.statusCode===404||e?.statusCode===410){await supabase.from("public_order_push_subscriptions").delete().eq("id",sub.id);removed++}
     else errors++;
    }
   }
   if(errors)throw Error(String(errors)+" push endpoints failed");
   const {error:ack}=await supabase.rpc("pitacco_finish_push_event",{p_id:job.id,p_success:true});
   if(ack)throw ack;
  }catch(e){
   failed++;
   await supabase.rpc("pitacco_finish_push_event",{p_id:job.id,p_success:false,p_error:String(e?.message||e).slice(0,400)});
  }
 }
 return json({processed:(jobs||[]).length,sent,failed,removed});
});