"""Keep Windows focused on order handling and printing; preserve full web SaaS."""
from pathlib import Path
p=Path('web/src.jsx')
s=p.read_text(encoding='utf-8')
needle="const desktopOperationalTabs=new Set(['Painel','Pedidos','Cozinha e expedição','Entregas','Entregadores','Caixa','Lançamentos','Configurações']);"
assert s.count(needle)==1
s=s.replace(needle,"const desktopOperationalTabs=new Set(['Pedidos','Cozinha e expedição','Configurações']);",1)
needle="useEffect(()=>{if(!supabase)return;supabase.auth.getSession()"
assert s.count(needle)==1
s=s.replace(needle,"useEffect(()=>{if(nativeAvailable()&&!desktopOperationalTabs.has(tab))setTab('Pedidos')},[tab]);\n"+needle,1)
# Do not modify the web build: nativeAvailable() distinguishes Tauri from browser.
p.write_text(s,encoding='utf-8')
