"""Add WhatsApp settings to Administrar Loja navigation and page."""
from pathlib import Path
p=Path('web/src.jsx')
s=p.read_text(encoding='utf-8')
needle="import StoreProfile from './StoreProfile.jsx';"
assert s.count(needle)==1
s=s.replace(needle,needle+"\nimport WhatsAppSettings from './WhatsAppSettings.jsx';",1)
needle="['Minha Loja','Dados da loja'],"
assert s.count(needle)==1
s=s.replace(needle,needle+"['WhatsApp','WhatsApp automático'],",1)
needle="'Minha Loja','Configurações','Equipe'"
assert s.count(needle)==1
s=s.replace(needle,"'Minha Loja','WhatsApp','Configurações','Equipe'",1)
needle="{tab==='Minha Loja'&&active&&<StoreProfile"
assert s.count(needle)==1
s=s.replace(needle,"{tab==='WhatsApp'&&active&&<WhatsAppSettings key={selected} client={supabase} storeId={selected} storeName={active.name} manager={manager}/>}\n"+needle,1)
p.write_text(s,encoding='utf-8')
