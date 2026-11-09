export const columns=[['analysis','Em análise'],['preparing','Em preparo'],['ready','Pronto'],['delivery','Em entrega']];
export function orderStage(order,delivery){
 if(delivery?.status==='cancelada')return 'cancelled';
 if(order.preparation_status==='completed'||delivery?.status==='entregue')return 'completed';
 if(delivery?.status==='retirada')return 'delivery';
 if(order.status==='pending')return 'analysis';
 if(order.status==='accepted')return order.preparation_status==='ready'?'ready':'preparing';
 return 'historical';
}
export function matchesOrder(order,query){const q=query.trim().toLocaleLowerCase('pt-BR');return !q||[order.id,order.receipt?.customer,order.receipt?.phone].some(v=>String(v||'').toLocaleLowerCase('pt-BR').includes(q));}
