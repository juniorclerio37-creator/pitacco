// Experimental bridge to the unchanged original Edge Function.
// No Core token is sent to the legacy provider; both identities must match.
// This client does not mutate order state or retry provider mutations.
const UUID=/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const CODE=/^[0-9]{2,6}$/;
export function createIfoodActions({store,actor,legacyClient}){
 if(!UUID.test(store??'')||!UUID.test(actor??'')||typeof legacyClient?.auth?.getUser!=='function'||typeof legacyClient?.functions?.invoke!=='function')throw new TypeError('Sessão iFood inválida.');
 let active=true;
 const busy=new Set(),pending=new Map(),reasonsByOrder=new Map();
 function stop(){active=false;reasonsByOrder.clear();pending.clear();}
 function check(order){
  if(!active)throw Error('Sessão encerrada.');
  if(!UUID.test(order?.id??'')||order.store_id!==store||order.source!=='ifood'||order.status!=='pending')throw Error('Pedido não disponível para esta ação.');
  if(order.receipt?.ifood_manual_accept==='requested'||order.receipt?.ifood_manual_cancel==='requested'||pending.has(order.id))throw Error('Aguardando reconciliação com o iFood.');
  if(busy.has(order.id))throw Error('Operação já em andamento.');
 }
 async function invoke(order,action,reason){
  check(order);
  const id=order.id;
  if(action==='cancel'&&(!CODE.test(reason??'')||!reasonsByOrder.get(id)?.has(reason)))throw Error('Selecione um motivo oficial atualizado.');
  busy.add(id);
  let sent=false;
  try{
   const {data:user,error:authError}=await legacyClient.auth.getUser();
   if(!active)throw Error('Sessão encerrada.');
   if(authError||user?.user?.id!==actor)throw Error('Sessão original não corresponde ao operador.');
   // The server independently revalidates order, merchant, actor and reason.
   sent=true;
   const {data,error}=await legacyClient.functions.invoke('ifood-manual-action',{body:{action,order_id:id,...(action==='cancel'?{reason}:{})}});
   if(!active)throw Error('Sessão encerrada.');
   if(error||!data)throw Error('Resposta indisponível.');
   if(action==='reasons'){
    if(!Array.isArray(data.reasons)||data.reasons.length>100||data.reasons.some(r=>!CODE.test(r?.code??'')||typeof r.description!=='string'||!r.description.trim()||r.description.length>150)||new Set(data.reasons.map(r=>r.code)).size!==data.reasons.length)throw Error('Motivos inválidos.');
    const reasons=data.reasons.map(r=>({code:r.code,description:r.description}));
    reasonsByOrder.set(id,new Set(reasons.map(r=>r.code)));
    return {reasons};
   }
   if(!['requested','already_requested'].includes(data.status))throw Error('Resposta inesperada.');
   pending.set(id,action);
   reasonsByOrder.delete(id);
   return {state:'awaiting_official_event',action};
  }catch(e){
   reasonsByOrder.delete(id);
   if(active&&sent&&action!=='reasons'){
    pending.set(id,action);
    return {state:'uncertain',action};
   }
   throw e;
  }finally{busy.delete(id);}
 }
 return {accept:o=>invoke(o,'accept'),reasons:o=>invoke(o,'reasons'),cancel:(o,code)=>invoke(o,'cancel',code),stop};
}
