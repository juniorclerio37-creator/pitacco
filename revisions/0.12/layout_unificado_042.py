"""Consolidate store workspaces and prevent nested operational navigation."""
from pathlib import Path
p=Path('web/src.jsx')
s=p.read_text(encoding='utf-8')
# Keep all existing functional views. The workspace header contains local tabs,
# while the sidebar remains a short, stable list of departments.
needle="{tab==='Despesas'&&active&&"
# A previous overlay intentionally renders expenses in both financial views.
assert needle not in s
needle="{['Despesas','Lançamentos'].includes(tab)&&active&&"
assert s.count(needle)==1
tabs="""{['Lançamentos','Despesas','Assinaturas'].includes(tab)&&active&&<div className="pitacco-local-tabs" role="group" aria-label="Seções financeiras"><button className={tab==='Lançamentos'?'active':''} onClick={()=>setTab('Lançamentos')}>Lançamentos</button><button className={tab==='Despesas'?'active':''} onClick={()=>setTab('Despesas')}>Despesas</button><button className={tab==='Assinaturas'?'active':''} onClick={()=>setTab('Assinaturas')}>Assinatura</button></div>}\n"""
s=s.replace(needle,tabs+needle,1)
# Avoid showing expenses in the launch tab: a distinct view with one clear job.
s=s.replace("{['Despesas','Lançamentos'].includes(tab)&&active&&","{tab==='Despesas'&&active&&",1)
# Navigation categories have their own content tabs; nested menu duplicates them.
needle="primary===name&&secondaryTabs[name]&&!isDriver&&"
assert s.count(needle)==1
s=s.replace(needle,"primary===name&&secondaryTabs[name]&&!isDriver&&!['Financeiro','Motoboys','Administrar Loja'].includes(name)&&",1)
# One page title per workspace; remove the duplicated heading emitted by
# the old operations navigation layer while retaining the global heading.
# The workspace's local section heading remains for accessibility.
# Printing errors belong in the printing screen, not in loyalty or CRM.
p_ops=Path('web/Operations.jsx')
ops=p_ops.read_text(encoding='utf-8')
old='{error&&<p role="alert" className="notice error">{error}</p>}'
assert ops.count(old)==1
ops=ops.replace(old,"{error&&(!String(error).startsWith('Impressão:')||view==='Configurações')&&<p role=\"alert\" className=\"notice error\">{error}</p>}",1)
# A printer exception must not remain a global operation error after the
# printer recovers; retain the error only on the printing workspace.
old="setError('Impressão: '+String(printError?.message||printError));"
assert ops.count(old)==1
ops=ops.replace(old,"setError('Impressão: '+String(printError?.message||printError));",1)
p_ops.write_text(ops,encoding='utf-8')
# Store identity and printer controls are separate tabs in the settings page.
p.write_text(s,encoding='utf-8')
p=Path('web/style.css')
s=p.read_text(encoding='utf-8')
s+='\n'+Path('revisions/0.12/layout_unificado_042.css').read_text(encoding='utf-8')
p.write_text(s,encoding='utf-8')


# Replace the old generic overview with the approved four-zone dashboard.
p=Path('web/src.jsx')
s=p.read_text(encoding='utf-8')
start=s.index("{tab==='Painel'&&active&&<>")
end=s.index("{tab==='Lojas'&&",start)
overview="""{tab==='Painel'&&active&&<div className="approved-dashboard"><div className="approved-hero"><div><h3>Olá! 👋</h3><p>Acompanhe o movimento da sua loja e acesse as principais funções.</p></div><div className="approved-actions"><button onClick={()=>setTab('Pedidos')}><Plus size={18}/> Nova venda</button><button className="secondary" onClick={()=>setTab('Pedidos')}><ShoppingBag size={18}/> Ver pedidos</button><button className="secondary" onClick={()=>setTab('Produtos')}><Package size={18}/> Cardápio</button></div></div><section className="metrics"><article><span>Pedidos registrados</span><strong>{orders.length}</strong></article><article><span>Faturamento bruto</span><strong>{money(gross)}</strong></article><article><span>Entregas registradas</span><strong>{deliveries.length}</strong></article><article><span>Saldo estimado*</span><strong>{money(gross-fees-totalExpenses)}</strong></article></section><div className="approved-grid"><section className="panel"><div className="approved-panel-title"><h3>Últimos pedidos</h3><button className="secondary" onClick={()=>setTab('Pedidos')}>Ver todos</button></div><div className="approved-table-scroll"><table><thead><tr><th>Pedido</th><th>Canal</th><th>Valor</th><th>Data</th></tr></thead><tbody>{orders.slice(0,6).map(o=><tr key={o.id}><td>{o.receipt?.display_number||o.receipt?.order_number||'—'}</td><td>{o.channel||'Loja'}</td><td>{money(o.gross)}</td><td>{o.created_at?new Date(o.created_at).toLocaleDateString('pt-BR'):'—'}</td></tr>)}{!orders.length&&<tr><td colSpan={4}>Nenhum pedido registrado.</td></tr>}</tbody></table></div></section><section className="panel"><h3>Acessos rápidos</h3><div className="approved-shortcuts"><button onClick={()=>setTab('Pedidos')}><ShoppingBag size={19}/>Pedidos</button><button onClick={()=>setTab('Clientes')}><Users size={19}/>Clientes</button><button onClick={()=>setTab('Fideliza+')}><CreditCard size={19}/>Fideliza+</button><button onClick={()=>setTab('Entregadores')}><Bike size={19}/>Motoboys</button><button onClick={()=>setTab('Configurações')}><Printer size={19}/>Impressão</button><button onClick={()=>setTab('Lançamentos')}><Wallet size={19}/>Financeiro</button></div></section><section className="panel"><h3>Resumo financeiro</h3><div className="approved-finance"><div><span>Faturamento</span><strong>{money(gross)}</strong></div><div><span>Taxas</span><strong>{money(fees)}</strong></div><div><span>Despesas</span><strong>{money(totalExpenses)}</strong></div></div><p>*Saldo estimado não é lucro líquido quando há custos não cadastrados.</p></section><section className="panel"><h3>Status da operação</h3><div className="approved-status"><button onClick={()=>setTab('Pedidos')}><ShoppingBag size={18}/>Pedidos <span>Ver pedidos ›</span></button><button onClick={()=>setTab('Configurações')}><Printer size={18}/>Impressão <span>Configurar ›</span></button><button onClick={()=>setTab('Entregadores')}><Bike size={18}/>Motoboys <span>Gerenciar ›</span></button></div></section></div></div>}
"""
s=s[:start]+overview+s[end:]
p.write_text(s,encoding='utf-8')
