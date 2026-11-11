from pathlib import Path
p=Path('web/src.jsx')
s=p.read_text(encoding='utf-8')
s="import CourierWorkspace from './CourierWorkspace.jsx';\n"+s
needle="{manager&&active&&['Entregas','Entregadores','Minha Loja'].includes(tab)&&<LogisticsHub"
assert s.count(needle)==1
s=s.replace(needle,"{manager&&active&&tab==='Entregadores'&&<CourierWorkspace client={supabase} store={active} onRefresh={async()=>{await loadStores();await loadDeliveries()}}/>}\n{manager&&active&&['Entregas','Minha Loja'].includes(tab)&&<LogisticsHub",1)
# Avoid duplicate rate editor when the consolidated workspace already includes it.
needle="{tab==='Entregadores'&&active&&manager&&<CourierRates client={supabase} storeId={selected}/>}\n"
s=s.replace(needle,'')
p.write_text(s,encoding='utf-8')
p=Path('web/style.css')
with p.open('a',encoding='utf-8') as f:f.write("""
\n.courier-workspace{display:flex;flex-direction:column;gap:16px}
.courier-workspace header h2{margin:0;font-size:24px}
.courier-workspace header p{margin:4px 0;color:#64748b}
.courier-kpis{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px}
.courier-kpis article{border:1px solid #e5e7eb;border-radius:12px;padding:16px;background:#fff}
.courier-kpis small{display:block;color:#64748b;margin-bottom:7px}
.courier-kpis strong{font-size:23px}
.courier-nav{display:flex;flex-wrap:wrap;gap:8px}
.courier-nav button{padding:10px 13px;border:1px solid #e5e7eb;border-radius:9px;background:#fff}
.courier-nav button.active{background:#d71920;color:#fff;border-color:#d71920}
.courier-heading{display:flex;align-items:center;gap:12px;flex-wrap:wrap}
.courier-heading h3{margin-right:auto}
.courier-workspace table{width:100%;border-collapse:collapse}
.courier-workspace th,.courier-workspace td{padding:12px 8px;text-align:left;border-bottom:1px solid #e5e7eb}
@media(max-width:700px){.courier-kpis{grid-template-columns:repeat(2,minmax(0,1fr))}}
""")
