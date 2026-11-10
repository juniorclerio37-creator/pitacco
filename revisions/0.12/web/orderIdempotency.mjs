// Stable source-scoped identity for deduplication. Use with a database UNIQUE(store_id,source,external_id).
const clean=s=>String(s??'').trim();
export function marketplaceIdentity({storeId,source,externalOrderId}){
 const store=clean(storeId),origin=clean(source).toLowerCase(),external=clean(externalOrderId);
 if(!store||!['ifood','99food','keeta'].includes(origin)||!external)throw Error('Identidade externa incompleta');
 return {store_id:store,source:origin,external_order_id:external};
}
export function idempotencyKey({storeId,source,externalOrderId,eventType}){
 const x=marketplaceIdentity({storeId,source,externalOrderId}),event=clean(eventType);
 if(!event)throw Error('Evento obrigatório');
 return JSON.stringify([x.store_id,x.source,x.external_order_id,event]);
}
export function shouldAutoPrint({status,alreadySubmitted,manualReprint=false}){
 if(manualReprint)return true;
 return status==='accepted'&&!alreadySubmitted;
}
