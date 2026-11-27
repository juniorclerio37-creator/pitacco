export const columns=[['analysis','Novo'],['preparing','Em preparo'],['ready','Pronto'],['delivery','Em entrega']];
export function orderStage(order,delivery){
 if(order.status==='rejected')return 'rejected';
 if(order.status==='cancelled'||delivery?.status==='cancelada')return 'cancelled';
 if(delivery?.status==='entregue')return 'completed';
 if(delivery?.status==='retirada'||order.receipt?.ifood_status==='DISPATCHED')return 'delivery';
 // The provider may have closed its order independently of the courier's local proof.
 if(order.source==='ifood'&&order.receipt?.ifood_status==='CONCLUDED')return 'completed';
 // The kitchen finishing preparation MUST NOT mark a delivery as completed.
 if(order.preparation_status==='completed')return order.source==='proprio'&&order.receipt?.logistics==='retirada'?'completed':'ready';
 if(order.status==='pending')return 'analysis';
 if(order.status==='accepted'&&order.scheduled_for&&order.preparation_status!=='ready'&&Date.parse(order.scheduled_release_at)>Date.now())return 'analysis';
 if(order.status==='accepted')return order.preparation_status==='ready'?'ready':'preparing';
 return 'historical';
}
export function matchesOrder(order,query){const q=query.trim().toLocaleLowerCase('pt-BR');return !q||[order.id,order.receipt?.display_number,order.receipt?.external_order_number,order.receipt?.order_number,order.receipt?.display_id,order.receipt?.number,order.receipt?.customer,order.receipt?.phone].some(v=>String(v||'').toLocaleLowerCase('pt-BR').includes(q));}
