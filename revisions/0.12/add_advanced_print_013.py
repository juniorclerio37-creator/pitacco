"""Add per-sector source/category filters and five original receipt presets."""
from pathlib import Path
p=Path('web/Operations.jsx')
s=p.read_text(encoding='utf-8')
needle="import DeliveryDialog,"
assert s.count(needle)==1
s=s.replace(needle,"import {CUPOM_80MM_HTML} from './cupom80mm.mjs';\n"+needle,1)
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
s=s.replace(needle,needle+'''<div className="quick-actions"><button type="button" className="secondary" onClick={()=>setTemplateHtml(CUPOM_80MM_HTML)}>Usar modelo padrão 80 mm</button><span>Ou personalize o HTML no editor abaixo.</span></div>''',1)
p.write_text(s,encoding='utf-8')
