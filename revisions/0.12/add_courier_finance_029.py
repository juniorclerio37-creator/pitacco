from pathlib import Path
p=Path('web/src.jsx')
s=p.read_text(encoding='utf-8')
s="import CourierFinance from './CourierFinance.jsx';\n"+s
needle="{tab==='Assinaturas'&&active&&"
assert needle in s
s=s.replace(needle,"{['Relatório de motoboys','Pagamento de motoboys'].includes(tab)&&active&&manager&&<CourierFinance client={supabase} storeId={selected} view={tab}/>}\n"+needle,1)
p.write_text(s,encoding='utf-8')
