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
needle="'Administrar Loja':[['Minha Loja','Dados da loja'],['Configurações','Impressão e aceite'],['Equipe','Usuários'],['Lojas','Estabelecimentos']]"
assert s.count(needle)==1
s=s.replace(needle,"'Administrar Loja':[]",1)
needle="{tab==='Minha Loja'&&active&&<StoreProfile"
assert s.count(needle)==1
s=s.replace(needle,"{['Minha Loja','Configurações'].includes(tab)&&active&&<div className=\"store-settings-tabs\" role=\"group\" aria-label=\"Configurações da loja\"><button className={tab==='Minha Loja'?'active':'secondary'} onClick={()=>setTab('Minha Loja')}>Identidade da loja</button><button className={tab==='Configurações'?'active':'secondary'} onClick={()=>setTab('Configurações')}>Impressão e aceite</button></div>}\n"+needle,1)
# Avoid presenting a blank placeholder as an actual store logo.
p.write_text(s,encoding='utf-8')

p=Path('web/Operations.jsx')
s=p.read_text(encoding='utf-8')
needle="const currency=n=>"
assert s.count(needle)==1
s=s.replace(needle,"const displayOrderNumber=o=>o?.receipt?.display_number||o?.receipt?.external_order_number||o?.receipt?.order_number||o?.receipt?.display_id||o?.receipt?.number||'Número pendente';\n"+needle,1)
old="(o.receipt?.display_number||o.receipt?.external_order_number||o.receipt?.order_number||o.receipt?.display_id||o.receipt?.number||o.id.slice(0,8))"
assert s.count(old)>=2
s=s.replace(old,"displayOrderNumber(o)")
needle="paymentOrder.id.slice(0,8)"
assert s.count(needle)==1
s=s.replace(needle,"displayOrderNumber(paymentOrder)",1)
p.write_text(s,encoding='utf-8')
