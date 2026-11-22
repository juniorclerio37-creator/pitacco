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
