"""Mount weekly opening hours inside Administrar Loja, independent of scheduling future orders."""
from pathlib import Path
p=Path('web/src.jsx')
s=p.read_text(encoding='utf-8')
def once(a,b):
 global s
 n=s.count(a)
 assert n==1,f'Opening-hours navigation anchor changed ({n}): {a[:95]}'
 s=s.replace(a,b,1)
once("import StoreDesignStudio from './StoreDesignStudio.jsx';",
 "import StoreDesignStudio from './StoreDesignStudio.jsx';\nimport StoreOpeningHours from './StoreOpeningHours.jsx';")
once("['Aparência do cardápio','Estúdio de Cardápio'],['Área de entrega','Área de entrega'],",
 "['Aparência do cardápio','Estúdio de Cardápio'],['Horário de funcionamento','Horário de funcionamento'],['Área de entrega','Área de entrega'],")
once("['Minha Loja','Aparência do cardápio','Área de entrega','Pagamentos da loja','Agendamento','WhatsApp','Configurações','Equipe','Lojas']",
 "['Minha Loja','Aparência do cardápio','Horário de funcionamento','Área de entrega','Pagamentos da loja','Agendamento','WhatsApp','Configurações','Equipe','Lojas']")
once("['Minha Loja','Configurações','Agendamento','Área de entrega','Pagamentos da loja','Aparência do cardápio'].includes(tab)",
 "['Minha Loja','Configurações','Agendamento','Área de entrega','Pagamentos da loja','Aparência do cardápio','Horário de funcionamento'].includes(tab)")
needle="""<button className={tab==='Aparência do cardápio'?'active':'secondary'} onClick={()=>setTab('Aparência do cardápio')}>Aparência do cardápio</button>"""
once(needle,needle+"""
 <button className={tab==='Horário de funcionamento'?'active':'secondary'}
   onClick={()=>setTab('Horário de funcionamento')}>Horário de funcionamento</button>""")
needle="{tab==='Aparência do cardápio'&&active&&!nativeAvailable()&&(manager"
assert s.count(needle)==1,'Storefront studio route not found'
s=s.replace(needle,
 """{tab==='Horário de funcionamento'&&active&&!nativeAvailable()&&(manager
 ?<StoreOpeningHours key={selected} client={supabase} store={active} manager={manager}/>
 :<section className="panel">Somente gestores podem editar o funcionamento da loja.</section>)}
 """+needle,1)
p.write_text(s,encoding='utf-8')
