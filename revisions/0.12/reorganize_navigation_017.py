"""Reorganize primary navigation, preserve existing pages and operational behavior."""
from pathlib import Path
p=Path('web/src.jsx')
s=p.read_text(encoding='utf-8')
start=s.index('const nav=[');end=s.index(';\nconst descriptions=',start)
s=s[:start]+"""const nav=[['Visão Geral',LayoutDashboard,'Principal'],['Pedidos',ShoppingBag,'Principal'],['Motoboys',Bike,'Principal'],['Meu Cardápio',Package,'Principal'],['Integrações',Plug,'Principal'],['Fideliza+',CreditCard,'Principal'],['Administrar Loja',Settings,'Principal'],['Financeiro',Wallet,'Principal'],['Caixa',Wallet,'Principal']];
const secondaryTabs={'Pedidos':[['Pedidos','Gestor de pedidos'],['Cozinha e expedição','Cozinha e expedição']],'Motoboys':[['Entregadores','Cadastro de motoboys'],['Relatório de motoboys','Relatório de entregas'],['Pagamento de motoboys','Pagamentos e histórico']],'Meu Cardápio':[['Produtos','Editor de cardápio']],'Administrar Loja':[['Minha Loja','Dados da loja'],['Configurações','Impressão e aceite'],['Equipe','Usuários'],['Lojas','Estabelecimentos']],'Financeiro':[['Assinaturas','Assinatura · R$ 59,90'],['Lançamentos','Lançamentos'],['Despesas','Despesas']]};
const primaryOf=t=>t==='Caixa'?'Caixa':t==='Painel'?'Visão Geral':t==='Cozinha e expedição'?'Pedidos':['Entregadores','Relatório de motoboys','Pagamento de motoboys'].includes(t)?'Motoboys':t==='Entregas'||t==='Entrega externa'?'Pedidos':t==='Produtos'||t==='Importar cardápio'?'Meu Cardápio':['Assinaturas','Lançamentos','Despesas'].includes(t)?'Financeiro':['Minha Loja','Configurações','Equipe','Lojas'].includes(t)?'Administrar Loja':t;
const landing={'Caixa':'Caixa','Pedidos':'Pedidos','Visão Geral':'Painel','Motoboys':'Entregadores','Financeiro':'Lançamentos','Meu Cardápio':'Produtos','Administrar Loja':'Minha Loja'};
"""+s[end+1:]
s=s.replace("['Painel',LayoutDashboard,'Operação']","['Visão Geral',LayoutDashboard,'Principal']")
needle="const isDriver=profile?.role==='entregador';"
assert s.count(needle)==1
s=s.replace(needle,"const primary=primaryOf(tab);\n"+needle,1)
needle="<nav aria-label=\"Menu principal\">{nav.filter"
assert s.count(needle)==1
start=s.index(needle);end=s.index('</nav>',start)+len('</nav>')
s=s[:start]+"""<nav aria-label="Menu principal">{nav.filter(([name])=>!nativeAvailable()||['Visão Geral','Pedidos','Motoboys','Caixa','Administrar Loja','Financeiro','Fideliza+'].includes(name)).filter(([name])=>!isDriver||name==='Motoboys').map(([name,Icon])=><React.Fragment key={name}><button className={primary===name?'active':''} onClick={()=>{setTab(nativeAvailable()&&name==='Administrar Loja'?'Configurações':landing[name]||name);setMessage('')}}><Icon size={18}/>{name}</button>{primary===name&&secondaryTabs[name]&&!isDriver&&<div className="nav-submenu">{secondaryTabs[name].filter(([target])=>!nativeAvailable()||['Configurações','Entregadores','Relatório de motoboys','Pagamento de motoboys','Assinaturas','Lançamentos','Despesas'].includes(target)).filter(([target])=>target!=='Equipe'||manager).filter(([target])=>target!=='Lojas'||admin).map(([target,label])=><button key={target} className={tab===target?'active':''} onClick={()=>{setTab(target);setMessage('')}}>{label}</button>)}</div>}</React.Fragment>)}</nav>"""+s[end:]
s=s.replace("<h2>{tab}</h2>","<h2>{primary}</h2>",1)
s=s.replace("setTab('Configurações')}><Printer","setTab('Configurações')}><Printer",1)
s=s.replace("setTab('Painel')}}>Abrir loja","setTab('Painel')}}>Abrir loja",1)
p.write_text(s,encoding='utf-8')
p=Path('web/Operations.jsx');s=p.read_text(encoding='utf-8')
s=s.replace("onNavigate('Configurações')","onNavigate('Configurações')")
p.write_text(s,encoding='utf-8')
