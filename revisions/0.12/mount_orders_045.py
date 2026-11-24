"""Mount the supplied orders design using existing backend operations, never mock data."""
from pathlib import Path
p=Path('web/Operations.jsx')
s=p.read_text(encoding='utf-8')
s="import Pedidos from './Pedidos.jsx';\n"+s
# Persist the dispatch policy from the store, not the marketplace.
policy_anchor=" const [settingsTab,setSettingsTab]=useState('Impressoras')"
assert s.count(policy_anchor)==1
policy_hook=""" const [dispatchPolicy,setDispatchPolicy]=useState('manual');
 useEffect(()=>{
  let active=true;
  if(!storeId)return;
  client.from('stores').select('dispatch_mode').eq('id',storeId).single()
   .then(({data,error})=>{
    if(active&&!error)setDispatchPolicy(data?.dispatch_mode||'manual');
   }).catch(()=>{});
  return ()=>{active=false;};
 },[client,storeId]);
"""
s=s.replace(policy_anchor,policy_hook+policy_anchor,1)
needle=" {manager&&desktop&&view==='Pedidos'&&<div className=\"operational-overview\""
assert s.count(needle)==1
mount=""" {manager&&view==='Pedidos'&&<Pedidos client={client} storeId={storeId} orders={orders} popupLayout={desktop} deliveries={deliveryRows} couriers={courierRows} badges={orderBadges} acceptMode={settings.find(s=>s.source==='ifood'&&s.enabled)?.mode||'manual'} dispatchMode={dispatchPolicy} stage={stage} busy={busy} actionError={error} onAccept={id=>act(()=>rpc('accept_order',{p_order:id}))} onAcceptIfood={id=>act(async()=>{
 const {data,error}=await client.functions.invoke('ifood-manual-action',{body:{action:'accept',order_id:id}});
 if(error){
  let message=error.message||'Não foi possível enviar o aceite ao iFood.';
  try{const details=await error.context?.json();if(details?.error)message=details.error;}catch{}
  throw Error(message);
 }
 if(data?.status!=='requested'&&data?.status!=='already_requested')throw Error('Aceite não confirmado pelo servidor Pitacco.');
 setOrders(rows=>rows.map(order=>order.id===id?{...order,receipt:{...order.receipt,ifood_manual_accept:'requested'}}:order));
})} onGetIfoodReasons={async id=>{
 const {data,error}=await client.functions.invoke('ifood-manual-action',{body:{action:'reasons',order_id:id}});
 if(error){
  let message=error.message||'Não foi possível consultar os motivos.';
  try{const details=await error.context?.json();if(details?.error)message=details.error;}catch{}
  throw Error(message);
 }
 return Array.isArray(data?.reasons)?data.reasons:[];
}} onRejectIfood={async(id,reason)=>{
 setBusy(true);setError('');
 try{
  const {data,error}=await client.functions.invoke('ifood-manual-action',{body:{action:'cancel',order_id:id,reason}});
  if(error){
   let message=error.message||'Não foi possível solicitar o cancelamento no iFood.';
   try{const details=await error.context?.json();if(details?.error)message=details.error;}catch{}
   throw Error(message);
  }
  if(data?.status!=='requested'&&data?.status!=='already_requested')throw Error('O iFood não recebeu a solicitação de cancelamento.');
  setOrders(rows=>rows.map(order=>order.id===id?{...order,receipt:{...order.receipt,ifood_manual_cancel:'requested'}}:order));
  return true;
 }catch(e){setError(e.message||String(e));return false;}
 finally{setBusy(false);}
}} onDecision={async(id,status,reason)=>{setBusy(true);setError('');try{if(status==='cancelled')await rpc('pitacco_cancel_active_order',{p_order:id,p_reason:reason});else await rpc('pitacco_decide_pending_order',{p_order:id,p_status:status,p_reason:reason});setOrders(rows=>rows.map(order=>order.id===id?{...order,status}:order));return true}catch(e){setError(e.message||String(e));return false}finally{setBusy(false)}}} onReady={id=>act(()=>rpc('set_order_preparation',{p_order:id,p_status:'ready'}))} onPickup={id=>act(()=>rpc('set_order_preparation',{p_order:id,p_status:'completed'}))} onConclude={id=>act(()=>rpc('pitacco_manager_confirm_verified_delivery',{p_order:id}))} onDetail={o=>{setDispatchOnly(false);setDetail(o)}} onAssign={o=>{setDispatchOnly(true);setDetail(o)}} onReprint={id=>act(()=>reprint(id))}/>}
"""
s=s.replace(needle,mount+needle,1)
# Keep the existing operations board available under the kitchen/expedition view.
needle="{manager&&['Pedidos','Cozinha e expedição'].includes(view)&&<>"
assert s.count(needle)==1
s=s.replace(needle,"{manager&&view==='Cozinha e expedição'&&<>",1)
p.write_text(s,encoding='utf-8')
