"""Expose Fideliza+ view in the existing operations router without touching print flow."""
from pathlib import Path
p=Path('web/Operations.jsx')
s=p.read_text(encoding='utf-8')
needle="import DeliveryDialog,"
assert s.count(needle)==1
s=s.replace(needle,"import Fideliza from './Fideliza.jsx';\n"+needle,1)
needle="const visible=view==='Pedidos'||view==='Cozinha e expedição'||view==='Configurações';"
assert s.count(needle)==1
s=s.replace(needle,"const visible=view==='Pedidos'||view==='Cozinha e expedição'||view==='Configurações'||view==='Fideliza+';",1)
needle=" <div className=\"connection-bar\">"
assert s.count(needle)==1
s=s.replace(needle," {view==='Fideliza+'&&<Fideliza client={client} storeId={storeId} manager={manager}/>}\n"+needle,1)
p.write_text(s,encoding='utf-8')
