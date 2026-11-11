from pathlib import Path
p=Path('web/src.jsx')
s=p.read_text(encoding='utf-8')
s="import CourierRates from './CourierRates.jsx';\n"+s
needle="{['Relatório de motoboys','Pagamento de motoboys'].includes(tab)&&active&&manager&&<CourierFinance"
assert s.count(needle)==1
s=s.replace(needle,"{tab==='Entregadores'&&active&&manager&&<CourierRates client={supabase} storeId={selected}/>}\n"+needle,1)
p.write_text(s,encoding='utf-8')
p=Path('web/Operations.jsx')
s=p.read_text(encoding='utf-8')
s="import ReceiptEditor from './ReceiptEditor.jsx';\n"+s
needle="   {desktop&&<div className=\"panel\"><h3>Fila persistente deste computador</h3>"
assert s.count(needle)==1, 'printer panel changed; review mount point'
s=s.replace(needle,'   {manager&&<ReceiptEditor client={client} storeId={storeId} sectors={sectors}/>}\\n'+needle,1)
p.write_text(s,encoding='utf-8')
