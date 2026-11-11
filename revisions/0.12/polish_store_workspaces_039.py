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


# Make store profile available as a tab, not a nested sidebar section.
needle="{tab==='Minha Loja'&&active&&<StoreProfile"
assert s.count(needle)==1
tabs="{['Minha Loja','Configurações'].includes(tab)&&active&&<div className=\\"store-settings-tabs\\" role=\\"group\\" aria-label=\\"Configurações da loja\\"><button className={tab==='Minha Loja'?'active':'secondary'} onClick={()=>setTab('Minha Loja')}>Identidade da loja</button><button className={tab==='Configurações'?'active':'secondary'} onClick={()=>setTab('Configurações')}>Impressão e aceite</button></div>}\n"
s=s.replace(needle,tabs+needle,1)
p.write_text(s,encoding='utf-8')

# Readable order number: keep UUID internal for deduplication only.
p=Path('web/Operations.jsx')
s=p.read_text(encoding='utf-8')
needle="const currency=n=>"
assert s.count(needle)==1
s=s.replace(needle,"const displayOrderNumber=o=>o?.receipt?.display_number||o?.receipt?.external_order_number||o?.receipt?.order_number||o?.receipt?.display_id||o?.receipt?.number||'Número pendente';\n"+needle,1)
old="(o.receipt?.display_number||o.receipt?.external_order_number||o.receipt?.order_number||o.receipt?.display_id||o.receipt?.number||o.id.slice(0,8))"
assert s.count(old)>=2
s=s.replace(old,"displayOrderNumber(o)")
needle="paymentOrder.id.slice(0,8)"
if needle in s:s=s.replace(needle,"displayOrderNumber(paymentOrder)")
p.write_text(s,encoding='utf-8')

# Save store identity through a scoped backend RPC.
p=Path('web/StoreProfile.jsx')
s=p.read_text(encoding='utf-8')
needle="const {data,error}=await client.from('stores').update(row).eq('id',store.id).select('id').single();"
assert s.count(needle)==1
s=s.replace(needle,"const {error}=await client.rpc('pitacco_update_store_identity',{p_store_id:store.id,p_data:row});",1)
needle="if(error)throw error;if(data.id!==store.id)throw Error('Loja incorreta.');"
assert s.count(needle)==1
s=s.replace(needle,"if(error)throw error;",1)
p.write_text(s,encoding='utf-8')
