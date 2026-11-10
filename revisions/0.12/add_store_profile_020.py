"""Mount store-specific profile editor in Administrar Loja."""
from pathlib import Path
p=Path('web/src.jsx')
s=p.read_text(encoding='utf-8')
needle="import MenuStudio from './MenuStudio.jsx';"
assert s.count(needle)==1
s=s.replace(needle,needle+"\nimport StoreProfile from './StoreProfile.jsx';",1)
needle="{tab==='Produtos'&&active&&<MenuStudio"
assert s.count(needle)==1
s=s.replace(needle,"{tab==='Minha Loja'&&active&&<StoreProfile key={selected} client={supabase} store={active} manager={manager} onSaved={loadStores}/>}\n"+needle,1)
p.write_text(s,encoding='utf-8')
