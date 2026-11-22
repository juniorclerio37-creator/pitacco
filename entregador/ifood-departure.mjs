// Envia ao iFood somente os pedidos de ENTREGA PRÓPRIA quando o motoboy
// efetivamente sair da loja. Nunca envia despacho na coleta nem na entrega parceira.
export function isMerchantIfoodDelivery(d){
 return d?.source==="ifood"&&d.logistics_provider==="loja";
}
export function ifoodDispatchTargets(deliveries,selected){
 if(!selected)return[];
 const route=selected.batch_id
  ?(Array.isArray(deliveries)?deliveries:[]).filter(d=>
    d.batch_id===selected.batch_id&&d.store_id===selected.store_id
    &&d.courier_id===selected.courier_id)
  :[selected];
 const unique=new Map();
 for(const d of route){
  if(!isMerchantIfoodDelivery(d)||!d.id||!d.collected_at||
    !["aceita","retirada"].includes(d.status))continue;
  unique.set(d.id,d);
 }
 return [...unique.values()];
}
export function ifoodDispatchOutcome(value){
 const state=value?.provider_state;
 if(state==="confirmed")return "confirmed";
 if(state==="submitted")return "submitted";
 return "pending";
}

/**
 * Persist departure before contacting iFood. If local departure fails no event
 * is emitted. Each provider failure is reported without rolling back an actual
 * departure or advancing the order to delivered.
 */
export async function recordDepartureAndDispatch({depart,dispatch,deliveries,selected}){
 await depart();
 const targets=ifoodDispatchTargets(deliveries,selected);
 let confirmed=0,submitted=0,pending=0;
 const problems=[];
 for(const stop of targets){
  try{
   const outcome=ifoodDispatchOutcome(await dispatch(stop));
   if(outcome==="confirmed")confirmed++;
   else if(outcome==="submitted")submitted++;
   else pending++;
  }catch(err){problems.push(String(err?.message||"Falha na sincronização iFood"));}
 }
 return {targets,confirmed,submitted,pending,problems};
}
