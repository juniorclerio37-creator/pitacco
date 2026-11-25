const fmt=new Intl.DateTimeFormat('pt-BR',{timeZone:'America/Sao_Paulo',dateStyle:'short',timeStyle:'short'});
export const scheduleInfo=(o={})=>{
 const r=o.receipt||o,raw=o.scheduled_for||r.scheduled_for||r.provider_scheduled_for;
 const stamp=Date.parse(raw);if(!Number.isFinite(stamp))return null;
 const release=Date.parse(o.scheduled_release_at||r.scheduled_release_at);
 const pickup=(r.logistics==='retirada'||/retirada|pickup|balc[aã]o/i.test(r.fulfillment_type||r.order_type||r.delivery_type||''));
 return {when:fmt.format(new Date(stamp)),modality:pickup?'Retirada':'Entrega',release:Number.isFinite(release)?fmt.format(new Date(release)):null,waiting:Number.isFinite(release)&&release>Date.now()};
};