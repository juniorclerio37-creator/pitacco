from pathlib import Path
p=Path('web/src.jsx')
s=p.read_text(encoding='utf-8')
needle="import Operations from './Operations.jsx';"
assert needle in s
s=s.replace(needle,needle+"\nimport CustomerBlocks from './CustomerBlocks.jsx';",1)
needle="{active&&!isDriver&&<Operations"
assert needle in s
s=s.replace(needle,"{active&&!isDriver&&tab==='Bloqueios de clientes'&&<CustomerBlocks client={supabase} storeId={selected}/>}\n"+needle,1)
p.write_text(s,encoding='utf-8')
