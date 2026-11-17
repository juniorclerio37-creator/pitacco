"""Do not confuse kitchen-ready or iFood's external event with courier delivery.

Applied after every 0.12 overlay, shared by the Windows installer and merchant web.
"""
from pathlib import Path

p=Path('web/orderBoard.mjs'); s=p.read_text(encoding='utf-8')
old=""" if(order.preparation_status==='completed'||delivery?.status==='entregue')return 'completed';
 if(delivery?.status==='retirada')return 'delivery';"""
new=""" if(delivery?.status==='entregue')return 'completed';
 if(delivery?.status==='retirada')return 'delivery';
 // The provider may have closed its order independently of the courier's local proof.
 if(order.source==='ifood'&&order.receipt?.ifood_status==='CONCLUDED')return 'completed';
 // The kitchen finishing preparation MUST NOT mark a delivery as completed.
 if(order.preparation_status==='completed')return 'ready';"""
assert s.count(old)==1,'Unexpected order board status mapping'
s=s.replace(old,new)
p.write_text(s,encoding='utf-8')

p=Path('web/Pedidos.jsx');s=p.read_text(encoding='utf-8')
old="const canAssign=(order,delivery)=>order.status==='accepted'&&delivery?.logistics_provider==='loja'&&delivery.status==='pendente'&&!delivery.courier_id;"
new="""const iFoodProviderClosed=order=>order?.source==='ifood'&&['CONCLUDED','CANCELLED'].includes(order?.receipt?.ifood_status);
const canAssign=(order,delivery)=>order.status==='accepted'&&!iFoodProviderClosed(order)&&delivery?.logistics_provider==='loja'&&delivery.status==='pendente'&&!delivery.courier_id;"""
assert s.count(old)==1,'Unexpected dispatch business condition'
s=s.replace(old,new)
old="{o.receipt?.ifood_manual_cancel==='requested'&&<span role=\"status\">Cancelamento solicitado ao iFood</span>}"
new=old+"""
     {iFoodProviderClosed(o)&&<span role="status">iFood encerrou o pedido. {delivery?.status==='entregue'?'Entrega registrada no Pitacco.':'A entrega local ainda não tem confirmação de conclusão. Não despache novamente.'}</span>}"""
assert s.count(old)==1,'Missing iFood status badges'
s=s.replace(old,new)
old="<section className=\"pedidos-items\"><h4>Itens"
new="""{iFoodProviderClosed(current)&&<p role="status">Status do iFood: {current.receipt?.ifood_status==='CONCLUDED'?'Concluído pela plataforma':'Cancelado'}. {currentDelivery?.status==='entregue'?'Entrega finalizada no Pitacco.':'Não confundir com confirmação do código no Pitacco.'}</p>}<section className="pedidos-items"><h4>Itens"""
assert s.count(old)==1,'Missing detail section'
s=s.replace(old,new)
p.write_text(s,encoding='utf-8')

p=Path('web/Operations.jsx');s=p.read_text(encoding='utf-8')
old="<div className=\"logistics-state\"><small>Preparo: {o.preparation_status==='ready'?'pronto':o.preparation_status==='completed'?'concluído':o.status==='pending'?'aguardando aceite':'em preparo'}</small>"
new="""<div className="logistics-state"><small>Preparo: {o.preparation_status==='ready'?'pronto':o.preparation_status==='completed'?'finalizado (não significa entregue)':o.status==='pending'?'aguardando aceite':'em preparo'}</small>{o.source==='ifood'&&o.receipt?.ifood_status==='CONCLUDED'&&<small role="status">iFood encerrou o pedido (evento recebido). {deliveryRows.find(d=>d.order_id===o.id)?.status==='entregue'?'Entrega registrada.':'Entrega no Pitacco ainda sem conclusão validada.'}</small>}"""
assert s.count(old)==1,'Unexpected operations card layout'
s=s.replace(old,new)
p.write_text(s,encoding='utf-8')
print('iFood ready/provider terminal/courier delivered statuses separated in Windows and portal')
