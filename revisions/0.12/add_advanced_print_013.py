"""Add per-sector source/category filters and five original receipt presets."""
from pathlib import Path
p=Path('web/Operations.jsx')
s=p.read_text(encoding='utf-8')
needle="import DeliveryDialog,"
assert s.count(needle)==1
s=s.replace(needle,"import {RECEIPT_TEMPLATES} from './receiptTemplates.mjs';\n"+needle,1)
needle="const [editingSector,setEditingSector]=useState(null)"
assert s.count(needle)==1
s=s.replace(needle,"const [printerSources,setPrinterSources]=useState(''),[printerCategories,setPrinterCategories]=useState('');\n "+needle,1)
needle="enabled:true},{onConflict:'store_id,sector'}"
assert s.count(needle)==1
s=s.replace(needle,"enabled:true,sources:printerSources.split(',').map(x=>x.trim()).filter(Boolean),categories:printerCategories.split(',').map(x=>x.trim()).filter(Boolean)},{onConflict:'store_id,sector'}",1)
needle="<form key={editingSector?.sector||'new'} onSubmit={savePrinter}>"
assert s.count(needle)==1
s=s.replace(needle,needle+'''<label className="field">Origens (separadas por vírgula, vazio = todas)<input value={printerSources} onChange={e=>setPrinterSources(e.target.value)} placeholder="proprio,ifood,99food,keeta"/></label><label className="field">Categorias dos produtos (separadas por vírgula, vazio = todas)<input value={printerCategories} onChange={e=>setPrinterCategories(e.target.value)} placeholder="Bebidas,Sobremesas"/></label>''',1)
needle='onClick={()=>setEditingSector(s)}>Editar'
assert s.count(needle)==1
s=s.replace(needle,"onClick={()=>{setEditingSector(s);setPrinterSources((s.sources||[]).join(','));setPrinterCategories((s.categories||[]).join(','))}}>Editar",1)
needle='<h3>Modelo HTML da comanda</h3>'
assert s.count(needle)==1
s=s.replace(needle,needle+'''<label className="field">Modelos prontos<select aria-label="Modelo de comprovante" defaultValue="" onChange={e=>{if(e.target.value)setTemplateHtml(RECEIPT_TEMPLATES[e.target.value])}}><option value="">Selecionar modelo</option><option value="simples">Simples</option><option value="completo">Completo</option><option value="cozinha">Cozinha</option><option value="expedicao">Expedição</option><option value="entregador">Entregador</option></select></label>''',1)
p.write_text(s,encoding='utf-8')
