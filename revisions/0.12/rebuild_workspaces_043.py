"""Structural rebuild of store workspaces, preserving existing functional components."""
from pathlib import Path

p=Path('web/src.jsx')
s=p.read_text(encoding='utf-8')

# Replace the previous stacked motoboy tools with three separate screens.
stack_start="{tab==='Entregadores'&&active&&manager&&<section className=\"courier-unified-tools\""
start=s.find(stack_start)
if start<0: raise RuntimeError('Courier stack anchor missing')
end=s.find("</section>}",start)
if end<0: raise RuntimeError('Courier stack closing tag missing')
s=s[:start]+s[end+len("</section>}"):]

# The existing CourierFinance views stay intact and are navigated separately.
anchor="{tab==='Assinaturas'&&active&&"
if s.count(anchor)!=1: raise RuntimeError('Finance anchor missing')
courier_tabs="""{['Entregadores','Relatório de motoboys','Pagamento de motoboys'].includes(tab)&&active&&manager&&<div className="pitacco-section-tabs" role="group" aria-label="Áreas dos motoboys"><button className={tab==='Entregadores'?'active':''} onClick={()=>setTab('Entregadores')}>Cadastro e entregas</button><button className={tab==='Relatório de motoboys'?'active':''} onClick={()=>setTab('Relatório de motoboys')}>Relatórios</button><button className={tab==='Pagamento de motoboys'?'active':''} onClick={()=>setTab('Pagamento de motoboys')}>Pagamentos</button></div>}
"""
s=s.replace(anchor,courier_tabs+anchor,1)

# Orders are operational: expose their existing separate workspaces as tabs.
anchor="{tab==='Painel'&&active&&"
if s.count(anchor)!=1: raise RuntimeError('Overview anchor missing')
order_tabs="""{['Pedidos','Cozinha e expedição'].includes(tab)&&active&&<div className="pitacco-section-tabs" role="group" aria-label="Áreas de pedidos"><button className={tab==='Pedidos'?'active':''} onClick={()=>setTab('Pedidos')}>Gestor de pedidos</button><button className={tab==='Cozinha e expedição'?'active':''} onClick={()=>setTab('Cozinha e expedição')}>Cozinha e expedição</button></div>}
"""
s=s.replace(anchor,order_tabs+anchor,1)

# Semantic grouping for screen-specific layout, not a global recoloring.
s=s.replace("pitacco-workspace--'+(tab==='Painel'", "pitacco-workspace--'+(tab==='Painel'")
p.write_text(s,encoding='utf-8')

p=Path('web/style.css')
s=p.read_text(encoding='utf-8')
s+="""

/* 0.13 workspace rebuild: independent navigation and structured content regions. */
.app:not(.pitacco-admin-shell) {--workspace-gap:20px}
.app:not(.pitacco-admin-shell) aside{width:252px;min-width:252px;flex-shrink:0;border-right:1px solid var(--line,#e3e7ed)}
.app:not(.pitacco-admin-shell) aside nav{padding:12px 10px;gap:4px}
.app:not(.pitacco-admin-shell) aside nav>button{border-radius:10px;min-height:45px;padding:11px 14px}
.app:not(.pitacco-admin-shell) main.pitacco-workspace{min-width:0;max-width:none;width:100%;padding:26px clamp(20px,2.5vw,44px) 60px}
.pitacco-workspace>header{margin-bottom:22px;padding-bottom:18px;border-bottom:1px solid var(--line,#e3e7ed)}
.pitacco-workspace>header h2{font-size:clamp(23px,2vw,30px);letter-spacing:-.025em}
.pitacco-section-tabs{display:flex;gap:8px;flex-wrap:wrap;align-items:center;border-bottom:1px solid var(--line,#e3e7ed);margin:0 0 22px;padding:0 0 12px}
.pitacco-section-tabs button{padding:11px 17px;border-radius:9px;background:transparent;border:1px solid transparent;box-shadow:none;font-weight:650}
.pitacco-section-tabs button.active{background:var(--surface,#fff);border-color:var(--line,#e3e7ed);box-shadow:0 2px 9px #14253a12}
.pitacco-workspace--couriers .pitacco-section-tabs+.panel,
.pitacco-workspace--orders .pitacco-section-tabs+.panel{margin-top:0}
.pitacco-workspace .panel{border-radius:14px;min-width:0}
.pitacco-workspace .panel table{width:100%}
.pitacco-workspace .panel form{min-width:0}
.pitacco-workspace--overview .approved-dashboard{display:flex;flex-direction:column;gap:20px}
.pitacco-workspace--overview .approved-hero{display:flex;align-items:center;justify-content:space-between;gap:20px;flex-wrap:wrap}
.pitacco-workspace--overview .approved-grid{display:grid;grid-template-columns:minmax(0,1.6fr) minmax(280px,1fr);gap:20px;align-items:start}
.pitacco-workspace--overview .approved-grid>.panel{margin:0;min-width:0}
.pitacco-workspace--overview .metrics{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:14px}
.pitacco-workspace--overview .metrics article{min-width:0}
.pitacco-workspace--settings .store-settings-tabs{margin-bottom:24px}
@media(max-width:1050px){.pitacco-workspace--overview .metrics{grid-template-columns:repeat(2,minmax(0,1fr))}.pitacco-workspace--overview .approved-grid{grid-template-columns:1fr}}
@media(max-width:760px){.app:not(.pitacco-admin-shell) aside{width:auto;min-width:0}.app:not(.pitacco-admin-shell) main.pitacco-workspace{padding:18px 14px 40px}.pitacco-workspace--overview .metrics{grid-template-columns:1fr 1fr}}
"""
p.write_text(s,encoding='utf-8')
