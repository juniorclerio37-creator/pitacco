"""Replace basic products view with catalog studio, retain import code for future official integration."""
from pathlib import Path
p=Path('web/src.jsx')
s=p.read_text(encoding='utf-8')
needle="import Operations from './Operations.jsx';"
assert s.count(needle)==1
s=s.replace(needle,needle+"\nimport MenuStudio from './MenuStudio.jsx';",1)
start=s.index("{tab==='Produtos'&&active&&")
end=s.index("{tab==='Despesas'&&active&&",start)
s=s[:start]+"{tab==='Produtos'&&active&&<MenuStudio client={supabase} storeId={selected} products={products} onRefresh={loadDetails}/>}\n"+s[end:]
p.write_text(s,encoding='utf-8')
