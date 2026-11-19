"""Make the repaired order-print/reprint pipeline observable in the Windows UI.

Do not change Windows test_printer; that command is a separate diagnostic path.
Never claim physical paper success from successful server queueing.
"""
from pathlib import Path
p=Path('web/Operations.jsx')
s=p.read_text(encoding='utf-8')
old=" const [settingsTab,setSettingsTab]=useState('Impressoras')"
assert s.count(old)==1,'Windows printer settings changed'
s=s.replace(old," const [printRequestFeedback,setPrintRequestFeedback]=useState('');\n"+old,1)
old=" async function reprint(orderId){const key=orderId;"
assert s.count(old)==1,'Windows reprint callback changed'
s=s.replace(old," async function reprint(orderId){setPrintRequestFeedback('');const key=orderId;",1)
old="reprintRequests.current.delete(key)}"
assert s.count(old)==1,'Windows reprint completion changed'
s=s.replace(old,"reprintRequests.current.delete(key);setPrintRequestFeedback('Comanda solicitada à fila do Pitacco. O envio não confirma impressão física; confira o papel da impressora.');}",1)
old="{manager&&view==='Pedidos'&&<Pedidos merchantLayout={!desktop} client={client} storeId={storeId} orders={orders}"
assert s.count(old)==1,'Merchant Pedidos mounting changed'
new="""{manager&&view==='Pedidos'&&printRequestFeedback&&<p role="status" className="notice">{printRequestFeedback}</p>}
 {manager&&view==='Pedidos'&&<Pedidos merchantLayout={!desktop} client={client} storeId={storeId} orders={orders}"""
s=s.replace(old,new,1)
p.write_text(s,encoding='utf-8')
print('Order printing keeps native queue and shows truthful reprint feedback')
