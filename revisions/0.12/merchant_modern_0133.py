"""Final approved modern merchant workspaces, preserving legacy operational functions."""
from pathlib import Path
p=Path('web/src.jsx');s=p.read_text(encoding='utf-8')
s="import {ModernIntegrations,ModernFinance,ModernCustomers} from './MerchantModern.jsx';\n"+s
def replace(old,new):
 global s
 assert s.count(old)==1, f'Modern layout anchor: {old[:100]} ({s.count(old)})'
 s=s.replace(old,new,1)
start=s.index("{tab==='Integrações'&&active&&")
end=s.index("{tab==='Lançamentos'&&active&&",start)
s=s[:start]+""" {tab==='Integrações'&&active&&<ModernIntegrations key={selected} client={supabase} storeId={selected} manager={manager} menu={storefront.menu} onMenu={()=>setTab('Pagamentos da loja')}/>}
"""+s[end:]
start=s.index("{tab==='Lançamentos'&&active&&")
# The old history is a single JSX fragment. Keep the next module untouched.
end=s.index("</>}",start)+4
assert 'Histórico financeiro' in s[start:end]
s=s[:start]+""" {tab==='Lançamentos'&&active&&<ModernFinance key={selected} client={supabase} store={active} loading={loading} onSave={e=>handleForm(e,'orders',f=>({store_id:selected,gross:Number(f.get('gross')),fees:Number(f.get('fees')),channel:f.get('channel')}))} onReports={()=>setTab('Relatórios')}/>}
"""+s[end:]
replace("<CustomersFromOrders key={navigationRoute} orders={orders} storeId={selected} blockedOnly={route.section==='bloqueados'}/>","<ModernCustomers key={selected+':'+navigationRoute} client={supabase} storeId={selected} blockedOnly={route.section==='bloqueados'}/>")
replace('+(menuCollapsed?" mn-sidebar-collapsed":"")','+(menuCollapsed?" mn-sidebar-collapsed":"")+(!isDriver&&["Integrações","Pagamentos da loja","Lançamentos","Clientes","Relatórios","Ocorrências"].includes(tab)?" modern-merchant":"")')
replace("<strong>{active?.name||'Pitacco'}</strong>","<strong>{!isDriver&&['Integrações','Pagamentos da loja','Lançamentos','Clientes','Relatórios','Ocorrências'].includes(tab)?'Pitacco':active?.name||'Pitacco'}</strong>")
# The global storefront sharing strip belongs exclusively to Visão Geral.
replace("{active&&<StorefrontShare","{active&&!isDriver&&navigationRoute==='Painel'&&<StorefrontShare")
# Give the incident page its own header; the route still inherits delivery permissions.
import re
headers=list(re.finditer(r'<h2>\{([^{}\n]*primary[^{}\n]*)\}</h2>',s))
assert len(headers)==1,'Expected one merchant workspace heading'
m=headers[0]
s=s[:m.start()]+"<h2>{tab==='Ocorrências'?'Central de Ocorrências':("+m.group(1)+")}</h2>"+s[m.end():]
p.write_text(s,encoding='utf-8')
