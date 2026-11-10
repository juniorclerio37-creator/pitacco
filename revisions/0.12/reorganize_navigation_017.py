"""Reorganize primary navigation, preserve existing pages and operational behavior."""
from pathlib import Path
p=Path('web/src.jsx')
s=p.read_text(encoding='utf-8')
start=s.index('const nav=[');end=s.index(';\nconst descriptions=',start)
s=s[:start]+"""const nav=[['Visão Geral',LayoutDashboard,'Principal'],['Pedidos',ShoppingBag,'Principal'],['Motoboys',Bike,'Principal'],['Meu Cardápio',Package,'Principal'],['Integrações',Plug,'Principal'],['Fideliza+',CreditCard,'Principal'],['Administrar Loja',Settings,'Principal'],['Caixa',Wallet,'Principal']];
const secondaryTabs={'Pedidos':[['Pedidos','Gestor de pedidos'],['Cozinha e expedição','Cozinha e expedição']],'Motoboys':[['Entregas','Entregas e rotas'],['Entregadores','Equipe de motoboys'],['Entrega externa','Entrega parceira']],'Meu Cardápio':[['Produtos','Editor de cardápio']],'Administrar Loja':[['Minha Loja','Dados da loja'],['Assinaturas','Assinatura · R$ 59,90'],['Configurações','Impressão e aceite'],['Equipe','Usuários'],['Lançamentos','Lançamentos'],['Despesas','Despesas'],['Lojas','Estabelecimentos']]};
const primaryOf=t=>t==='Caixa'?'Caixa':t==='Painel'?'Visão Geral':t==='Cozinha e expedição'?'Pedidos':t==='Entregas'||t==='Entregadores'||t==='Entrega externa'?'Motoboys':t==='Produtos'||t==='Importar cardápio'?'Meu Cardápio':['Minha Loja','Configurações','Equipe','Lançamentos','Despesas','Lojas','Assinaturas'].includes(t)?'Administrar Loja':t;
const landing={'Caixa':'Caixa','Pedidos':'Pedidos','Visão Geral':'Painel','Motoboys':'Entregas','Meu Cardápio':'Produtos','Administrar Loja':'Minha Loja'};
"""+s[end+1:]
s=s.replace("['Painel',LayoutDashboard,'Operação']","['Visão Geral',LayoutDashboard,'Principal']")
needle="const isDriver=profile?.role==='entregador';"
assert s.count(needle)==1
s=s.replace(needle,"const primary=primaryOf(tab);\n"+needle,1)
needle="<nav aria-label=\"Menu principal\">{nav.filter"
assert s.count(needle)==1
start=s.index(needle);end=s.index('</nav>',start)+len('</nav>')
s=s[:start]+"""<nav aria-label="Menu principal">{nav.filter(([name])=>!nativeAvailable()||['Visão Geral','Pedidos','Motoboys','Caixa','Administrar Loja'].includes(name)).filter(([name])=>!isDriver||name==='Motoboys').map(([name,Icon])=><React.Fragment key={name}><button className={primary===name?'active':''} onClick={()=>{setTab(nativeAvailable()&&name==='Administrar Loja'?'Configurações':landing[name]||name);setMessage('')}}><Icon size={18}/>{name}</button>{primary===name&&secondaryTabs[name]&&!isDriver&&<div className="nav-submenu">{secondaryTabs[name].filter(([target])=>!nativeAvailable()||target==='Configurações').filter(([target])=>target!=='Equipe'||manager).filter(([target])=>target!=='Lojas'||admin).map(([target,label])=><button key={target} className={tab===target?'active':''} onClick={()=>{setTab(target);setMessage('')}}>{label}</button>)}</div>}</React.Fragment>)}</nav>"""+s[end:]
s=s.replace("<h2>{tab}</h2>","<h2>{primary}</h2>",1)
s=s.replace("setTab('Configurações')}><Printer","setTab('Configurações')}><Printer",1)
s=s.replace("setTab('Painel')}}>Abrir loja","setTab('Painel')}}>Abrir loja",1)
p.write_text(s,encoding='utf-8')
p=Path('web/Operations.jsx');s=p.read_text(encoding='utf-8')
s=s.replace("onNavigate('Configurações')","onNavigate('Configurações')")
p.write_text(s,encoding='utf-8')
