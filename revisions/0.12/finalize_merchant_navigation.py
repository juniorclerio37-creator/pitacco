"""Keep the merchant menu organized: assistance apart from shop identity, dispatch in deliveries."""
from pathlib import Path

path=Path('web/src.jsx')
source=path.read_text(encoding='utf-8')

def replace_once(old,new):
    global source
    actual=source.count(old)
    assert actual==1, f'Expected one merchant navigation anchor ({actual}): {old[:100]}'
    source=source.replace(old,new,1)

replace_once(
    "import StoreProfile from './StoreProfile.jsx';",
    "import StoreProfile from './StoreProfile.jsx';\nimport {StoreHelp} from './StoreReadiness.jsx';\nimport {LifeBuoy} from 'lucide-react';"
)
start=source.index('const nav=[')
end=source.index('];',start)
nav=source[start:end]
assert "'Ajuda e suporte'" not in nav
source=source[:end]+",['Ajuda e suporte',LifeBuoy,'Suporte']"+source[end:]

# The web menu's existing allow/feature checks handle this regular merchant page.
# In Windows mode only orders and printing remain visible.
anchor="{tab==='Minha Loja'&&active&&<StoreProfile key={selected} client={supabase} store={active} manager={manager} onSaved={loadStores}/>}"
replace_once(anchor,anchor+"\n{tab==='Ajuda e suporte'&&active&&!nativeAvailable()&&"
  "<StoreHelp key={selected} client={supabase} storeId={selected} canContact={manager}/>}"
)
replace_once(
    "['Entregas','Minha Loja'].includes(tab)&&<LogisticsHub",
    "tab==='Entregas'&&<LogisticsHub"
)

path.write_text(source,encoding='utf-8')
