"""Mount the menu appearance studio after existing navigation overlays without changing orders or Windows."""
from pathlib import Path

p=Path('web/src.jsx')
s=p.read_text(encoding='utf-8')
def once(old,new):
 global s
 n=s.count(old)
 assert n==1, f'Expected one storefront-studio anchor, found {n}: {old[:85]}'
 s=s.replace(old,new,1)

once("import StoreProfile from './StoreProfile.jsx';",
 "import StoreProfile from './StoreProfile.jsx';\nimport StoreDesignStudio from './StoreDesignStudio.jsx';")
once("['Minha Loja','Dados da loja'],['Área de entrega','Área de entrega'],",
 "['Minha Loja','Dados da loja'],['Aparência do cardápio','Estúdio de Cardápio'],['Área de entrega','Área de entrega'],")
once("['Minha Loja','Área de entrega','Pagamentos da loja','Agendamento','WhatsApp','Configurações','Equipe','Lojas']",
 "['Minha Loja','Aparência do cardápio','Área de entrega','Pagamentos da loja','Agendamento','WhatsApp','Configurações','Equipe','Lojas']")
once("['Minha Loja','Configurações','Agendamento','Área de entrega','Pagamentos da loja'].includes(tab)",
 "['Minha Loja','Configurações','Agendamento','Área de entrega','Pagamentos da loja','Aparência do cardápio'].includes(tab)")
needle="""<button className={tab==='Área de entrega'?'active':'secondary'} onClick={()=>setTab('Área de entrega')}>Área de entrega</button>"""
once(needle,"""<button className={tab==='Aparência do cardápio'?'active':'secondary'} onClick={()=>setTab('Aparência do cardápio')}>Aparência do cardápio</button>
 """+needle)
needle="{tab==='Minha Loja'&&active&&<StoreProfile key={selected} client={supabase} store={active} manager={manager} onSaved={loadStores}/>}\n"
once(needle,needle+""" {tab==='Aparência do cardápio'&&active&&!nativeAvailable()&&(manager
  ?<StoreDesignStudio key={selected} client={supabase} store={active} manager={manager}/>
  :<section className="panel">Somente gestores podem editar a aparência do cardápio.</section>)}\n""")
p.write_text(s,encoding='utf-8')
