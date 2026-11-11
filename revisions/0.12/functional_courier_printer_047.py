"""Functional printer sector editing/removal and real courier payout search.
Preserve original backend RPCs and Windows print spooler.
"""
from pathlib import Path
# Printer controls are already modified by preceding overlays; do not rely on brittle string replacement.
p=Path('web/CourierFinance.jsx')
s=p.read_text(encoding='utf-8')
needle=" const [couriers,setCouriers]=useState([])"
assert s.count(needle)==1
s=s.replace(needle," const [search,setSearch]=useState('');\n"+needle,1)
needle="<h3>{view==='Relatório de motoboys'?'Relatório de entregadores':'Pagamento de entregadores'}</h3>"
assert s.count(needle)==1
s=s.replace(needle,needle+"<label className=\"field\">Buscar entregador<input aria-label=\"Buscar entregador\" value={search} onChange={e=>setSearch(e.target.value)} placeholder=\"Nome do entregador\"/></label>",1)
s=s.replace('{couriers.map(c=>{const rows=deliveries.filter','{couriers.filter(c=>c.name.toLowerCase().includes(search.toLowerCase())).map(c=>{const rows=deliveries.filter',1)
s=s.replace('{couriers.map(c=><option key={c.id}', '{couriers.filter(c=>c.name.toLowerCase().includes(search.toLowerCase())).map(c=><option key={c.id}',1)
p.write_text(s,encoding='utf-8')
