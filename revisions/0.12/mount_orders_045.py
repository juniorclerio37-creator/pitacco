"""Mount the supplied orders design using existing backend operations, never mock data."""
from pathlib import Path
p=Path('web/Operations.jsx')
s=p.read_text(encoding='utf-8')
s="import Pedidos from './Pedidos.jsx';\n"+s
needle=" {manager&&desktop&&view==='Pedidos'&&<div className=\"operational-overview\""
assert s.count(needle)==1
mount=""" {manager&&view==='Pedidos'&&<Pedidos orders={orders} stage={stage} busy={busy} onAccept={id=>act(()=>rpc('accept_order',{p_order:id}))} onReady={id=>act(()=>rpc('set_order_preparation',{p_order:id,p_status:'ready'}))} onDetail={o=>{setDispatchOnly(false);setDetail(o)}} onReprint={id=>act(()=>reprint(id))}/>}
"""
s=s.replace(needle,mount+needle,1)
# Keep the existing operations board available under the kitchen/expedition view.
needle="{manager&&['Pedidos','Cozinha e expedição'].includes(view)&&<>"
assert s.count(needle)==1
s=s.replace(needle,"{manager&&view==='Cozinha e expedição'&&<>",1)
p.write_text(s,encoding='utf-8')
