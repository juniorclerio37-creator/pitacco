"""Unify store workspaces without changing order, payment or print business rules."""
from pathlib import Path

p=Path('web/src.jsx')
s=p.read_text(encoding='utf-8')
# Keep one Motoboys entry; show all three existing tools on its landing page.
needle="['Motoboys',Bike,'Principal']"
assert s.count(needle)==1
needle="'Motoboys':[['Entregadores','Cadastro de motoboys'],['Relatório de motoboys','Relatório de entregas'],['Pagamento de motoboys','Pagamentos e histórico']],"
assert s.count(needle)==1
s=s.replace(needle,"",1)
needle="{tab==='Assinaturas'&&active&&"
assert s.count(needle)==1
s=s.replace(needle,"{tab==='Entregadores'&&active&&manager&&<section className=\"courier-unified-tools\" aria-label=\"Relatórios e pagamentos de motoboys\"><CourierFinance client={supabase} storeId={selected} view=\"Relatório de motoboys\"/><CourierFinance client={supabase} storeId={selected} view=\"Pagamento de motoboys\"/></section>}\n"+needle,1)
# Financial launch and expenses share the same workspace, without duplicating forms.
needle="{tab==='Despesas'&&active&&"
assert s.count(needle)==1
s=s.replace(needle,"{['Despesas','Lançamentos'].includes(tab)&&active&&",1)
needle="'Financeiro':[['Assinaturas','Assinatura · R$ 59,90'],['Lançamentos','Lançamentos'],['Despesas','Despesas']]"
assert s.count(needle)==1
s=s.replace(needle,"'Financeiro':[]",1)
# Show store identity and printing as clear tabs within Administrar Loja.
needle="nativeAvailable()&&name==='Administrar Loja'?'Configurações'"
assert s.count(needle)==1
s=s.replace(needle,"nativeAvailable()&&name==='Administrar Loja'?'Minha Loja'",1)
# Store configuration remains reachable from its own main screen.
# Do not rewrite submenu text here: later navigation overlays may change it.

