
const reply=(status:number,body:unknown)=>Response.json(body,{status,headers:{"cache-control":"no-store","access-control-allow-origin":"https://app.pitacco.com.br","access-control-allow-headers":"authorization, apikey, content-type, x-client-info","access-control-allow-methods":"POST, OPTIONS"}});
const env=Deno.env.get("ASAAS_ENVIRONMENT"),api=Deno.env.get("ASAAS_API_KEY"),base=Deno.env.get("SUPABASE_URL"),service=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const asaas=async(path:string,method="GET",body?:unknown)=>{
 const r=await fetch("https://api.asaas.com/v3"+path,{method,headers:{access_token:api!,"content-type":"application/json",accept:"application/json","user-agent":"Pitacco/1.0"},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(10000)});
 if(!r.ok)throw Error("provider");return await r.json();
};
const rpc=async(name:string,args:unknown)=>{
 const r=await fetch(base+"/rest/v1/rpc/"+name,{method:"POST",headers:{apikey:service!,Authorization:"Bearer "+service,"content-type":"application/json"},body:JSON.stringify(args),signal:AbortSignal.timeout(8000)});
 if(!r.ok)throw Error("database");return await r.json();
};
Deno.serve(async req=>{
 if(req.method==="OPTIONS")return reply(200,{});
 if(req.method!=="POST")return reply(405,{error:"Método indisponível"});
 if(env!=="production"||!api||!base||!service)return reply(503,{error:"Asaas indisponível"});
 const auth=req.headers.get("authorization")||"";
 if(!auth.startsWith("Bearer ")||auth==="Bearer "+service)return reply(401,{error:"Autenticação necessária"});
 try{
  const user=await fetch(base+"/auth/v1/user",{headers:{apikey:service,authorization:auth},signal:AbortSignal.timeout(8000)});
  if(!user.ok)return reply(401,{error:"Sessão inválida"});
  const actor=(await user.json()).id;
  const raw=await req.text();if(raw.length>4096)return reply(413,{error:"Requisição inválida"});
  const input=JSON.parse(raw),invoice=input.invoice_id,document=String(input.document||"").replace(/\D/g,"");
  if(!uuid.test(invoice)||document.length>14)return reply(400,{error:"Dados inválidos"});
  const ctx=await rpc("pitacco_asaas_prepare_customer",{p_actor:actor,p_invoice:invoice,p_document:document});
  let customer=ctx.customer_id;
  if(!customer){
   const ref="pitacco:store:"+ctx.store_id;
   const list=await asaas("/customers?limit=100&externalReference="+encodeURIComponent(ref));
   const hits=(list.data||[]).filter((x:any)=>x.externalReference===ref&&!x.deleted);
   if(list.hasMore||hits.length>1)return reply(409,{error:"Cadastro exige conciliação"});
   let item=hits[0];
   if(!item&&ctx.allow_create)item=await asaas("/customers","POST",{name:ctx.name,cpfCnpj:document,externalReference:ref,notificationDisabled:true});
   if(!item||item.externalReference!==ref||String(item.cpfCnpj||"").replace(/\D/g,"")!==document||!/^cus_[A-Za-z0-9_-]{1,100}$/.test(item.id))return reply(409,{error:"Cadastro exige conciliação"});
   customer=item.id;
   await rpc("pitacco_asaas_bind_customer",{p_store:ctx.store_id,p_customer:customer});
  }
  const charge=await rpc("pitacco_asaas_reserve_charge",{p_actor:actor,p_invoice:invoice,p_customer:customer});
  const ref="pitacco:invoice:"+invoice;
  let item;
  if(charge.payment_id)item=await asaas("/payments/"+encodeURIComponent(charge.payment_id));
  else{
   const list=await asaas("/payments?limit=100&externalReference="+encodeURIComponent(ref));
   const hits=(list.data||[]).filter((x:any)=>x.externalReference===ref&&!x.deleted);
   if(list.hasMore||hits.length>1)return reply(409,{error:"Cobrança exige conciliação"});
   item=hits[0];
   if(!item&&charge.allow_create)item=await asaas("/payments","POST",{customer,billingType:"PIX",value:charge.amount_cents/100,dueDate:charge.due_date,description:charge.kind==="monthly"?"Pitacco — mensalidade":"Pitacco — comissão semanal",externalReference:ref});
  }
  if(!item||item.deleted||item.externalReference!==ref||item.customer!==customer||Math.round(item.value*100)!==charge.amount_cents||item.billingType!=="PIX"||!/^pay_[A-Za-z0-9_-]{1,100}$/.test(item.id))return reply(409,{error:"Cobrança exige conciliação"});
  await rpc("pitacco_asaas_bind_charge",{p_invoice:invoice,p_customer:customer,p_payment:item.id});
  if(["RECEIVED","CONFIRMED"].includes(item.status)){const outcome=await rpc("pitacco_asaas_settle_commercial_invoice",{p_payment_id:item.id,p_customer_id:customer,p_invoice:invoice,p_amount_cents:charge.amount_cents});return reply(200,{status:outcome});}
  if(!["PENDING","OVERDUE"].includes(item.status))return reply(409,{error:"Situação da cobrança exige conciliação"});
  const qr=await asaas("/payments/"+encodeURIComponent(item.id)+"/pixQrCode");
  return reply(200,{status:item.status,amount_cents:charge.amount_cents,payload:qr.payload,encodedImage:qr.encodedImage,expirationDate:qr.expirationDate});
 }catch{return reply(503,{error:"Não foi possível concluir. Consulte a cobrança novamente; não será emitida outra automaticamente após uma tentativa inconclusiva."});}
});