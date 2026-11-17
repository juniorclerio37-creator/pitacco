"""Mount the supplied orders design using existing backend operations, never mock data."""
from pathlib import Path
p=Path('web/Operations.jsx')
s=p.read_text(encoding='utf-8')
s="import Pedidos from './Pedidos.jsx';\n"+s
needle=" {manager&&desktop&&view==='Pedidos'&&<div className=\"operational-overview\""
assert s.count(needle)==1
mount=""" {manager&&view==='Pedidos'&&<Pedidos orders={orders} deliveries={deliveryRows} badges={orderBadges} stage={stage} busy={busy} onAccept={id=>act(()=>rpc('accept_order',{p_order:id}))} onAcceptIfood={id=>act(async()=>{
 const {data,error}=await client.functions.invoke('ifood-manual-accept',{body:{order_id:id}});
 if(error){
  let message=error.message||'Não foi possível enviar o aceite ao iFood.';
  try{const details=await error.context?.json();if(details?.error)message=details.error;}catch{}
  throw Error(message);
 }
 if(data?.status!=='requested'&&data?.status!=='already_requested')throw Error('Aceite não confirmado pelo servidor Pitacco.');
 setOrders(rows=>rows.map(order=>order.id===id?{...order,receipt:{...order.receipt,ifood_manual_accept:'requested'}}:order));
})} onDecision={(id,status,reason)=>act(async()=>{await rpc('pitacco_decide_pending_order',{p_order:id,p_status:status,p_reason:reason});setOrders(rows=>rows.map(order=>order.id===id?{...order,status}:order))})} onReady={id=>act(()=>rpc('set_order_preparation',{p_order:id,p_status:'ready'}))} onDetail={o=>{setDispatchOnly(false);setDetail(o)}} onAssign={o=>{setDispatchOnly(true);setDetail(o)}} onReprint={id=>act(()=>reprint(id))}/>}
"""
s=s.replace(needle,mount+needle,1)
# Keep the existing operations board available under the kitchen/expedition view.
needle="{manager&&['Pedidos','Cozinha e expedição'].includes(view)&&<>"
assert s.count(needle)==1
s=s.replace(needle,"{manager&&view==='Cozinha e expedição'&&<>",1)
p.write_text(s,encoding='utf-8')
