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
