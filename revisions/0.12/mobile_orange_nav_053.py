"""Mobile-first navigation with orange accents. Keep all existing workspaces and actions."""
from pathlib import Path
p=Path('web/src.jsx')
s=p.read_text(encoding='utf-8')
needle="const [tab,setTab]="
assert needle in s
s=s.replace(needle,"const [mobileMenuOpen,setMobileMenuOpen]=useState(false);\n"+needle,1)
needle='return <div className="app"><aside>'
assert s.count(needle)==1
s=s.replace(needle,'''return <div className={"app pitacco-responsive-shell"+(mobileMenuOpen?" mobile-menu-open":"")}>
<button type="button" className="pitacco-menu-backdrop" aria-label="Fechar menu" onClick={()=>setMobileMenuOpen(false)}/>
<div className="pitacco-mobile-header"><span className="pitacco-mobile-brand"><span className="pitacco-mobile-bag">▣</span><span><strong>Pitacco</strong><small>{active?.name||"Minha loja"}</small></span></span><button type="button" aria-label="Abrir menu" aria-expanded={mobileMenuOpen} onClick={()=>setMobileMenuOpen(v=>!v)}><Menu size={23}/></button></div>
<aside>''',1)
# Use existing lucide icon already available, add Menu to named imports.
needle='Truck,Settings,Plug,Printer}'
assert s.count(needle)==1
s=s.replace(needle,'Truck,Settings,Plug,Printer,Menu}',1)
needle="onClick={()=>{setTab(name);setMessage('')}}"
assert s.count(needle)>=1
s=s.replace(needle,"onClick={()=>{setTab(name);setMessage('');setMobileMenuOpen(false)}}")
needle='</main></div>}'
assert s.count(needle)==1
s=s.replace(needle,'''</main>
<nav className="pitacco-mobile-bottom" aria-label="Navegação rápida">
{[['Painel','Início',LayoutDashboard],['Pedidos','Pedidos',ShoppingBag],['Entregadores','Motoboys',Bike]].filter(([name])=>!nativeAvailable()||desktopOperationalTabs.has(name)).map(([name,label,Icon])=><button key={name} type="button" className={tab===name?'active':''} onClick={()=>{setTab(name);setMobileMenuOpen(false);window.scrollTo({top:0,behavior:'instant'})}}><Icon size={20}/><span>{label}</span></button>)}
<button type="button" className={mobileMenuOpen?'active':''} onClick={()=>setMobileMenuOpen(v=>!v)} aria-label="Menu completo"><Menu size={20}/><span>Menu</span></button>
</nav>
</div>}''',1)
p.write_text(s,encoding='utf-8')
p=Path('web/style.css')
s=p.read_text(encoding='utf-8')
s+="""

/* Pitacco mobile navigation: preserve all modules and orange branding. */
.pitacco-mobile-header,.pitacco-mobile-bottom,.pitacco-menu-backdrop{display:none}
.pitacco-responsive-shell{--pt-mobile-orange:#e87524;--pt-mobile-orange-dark:#bc5416}
.pitacco-responsive-shell aside nav button.active{background:var(--pt-mobile-orange)!important;color:#fff!important;box-shadow:none!important}
@media(max-width:900px){
 .pitacco-responsive-shell{display:block!important;min-width:0}
 .pitacco-responsive-shell .pitacco-mobile-header{position:sticky;top:0;z-index:120;display:flex;align-items:center;justify-content:space-between;gap:12px;height:64px;padding:8px 16px;background:#fff;border-bottom:1px solid #ece8e4;box-shadow:0 2px 8px #00000008}
 .pitacco-mobile-brand{display:flex;align-items:center;gap:10px;min-width:0;color:#24242b}
 .pitacco-mobile-brand>span:last-child{display:flex;flex-direction:column;min-width:0}
 .pitacco-mobile-brand strong{font-size:17px;line-height:1.25}
 .pitacco-mobile-brand small{font-size:12px;color:#737373;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:210px}
 .pitacco-mobile-bag{display:grid;place-items:center;background:var(--pt-mobile-orange);color:#fff;border-radius:10px;width:36px;height:36px}
 .pitacco-mobile-header button{background:transparent!important;color:#26232a!important;border:0!important;box-shadow:none!important;padding:8px!important}
 .pitacco-responsive-shell aside{position:fixed!important;top:0!important;left:0!important;bottom:0!important;z-index:140!important;display:flex!important;flex-direction:column!important;width:min(310px,86vw)!important;min-width:0!important;max-height:100dvh!important;overflow-y:auto!important;transform:translateX(-105%);transition:transform .2s ease;padding-top:22px!important}
 .pitacco-responsive-shell.mobile-menu-open aside{transform:translateX(0)}
 .pitacco-responsive-shell .pitacco-menu-backdrop{display:block;position:fixed;inset:0;z-index:130;background:#0008;border:0;opacity:0;pointer-events:none}
 .pitacco-responsive-shell.mobile-menu-open .pitacco-menu-backdrop{opacity:1;pointer-events:auto}
 .pitacco-responsive-shell main{width:100%!important;max-width:none!important;min-width:0!important;margin:0!important;padding:18px 14px 94px!important}
 .pitacco-responsive-shell main>header{margin:0 0 16px!important;padding:0 0 12px!important;gap:10px}
 .pitacco-responsive-shell main>header h2{font-size:24px!important}
 .pitacco-responsive-shell main>header p{margin:4px 0 0!important}
 .pitacco-responsive-shell main .panel{margin-top:12px}
 .pitacco-responsive-shell .pitacco-mobile-bottom{position:fixed;bottom:0;left:0;right:0;z-index:120;display:flex;justify-content:space-around;align-items:stretch;background:#fff;border-top:1px solid #ece8e4;padding:5px 4px max(7px,env(safe-area-inset-bottom))}
 .pitacco-mobile-bottom button{display:flex!important;flex:1;align-items:center;justify-content:center;flex-direction:column;gap:3px;min-width:0;padding:7px 2px!important;background:transparent!important;border:0!important;box-shadow:none!important;color:#777!important;font-size:11px!important}
 .pitacco-mobile-bottom button.active{color:var(--pt-mobile-orange-dark)!important}
 .pitacco-mobile-bottom button span{font-size:11px;font-weight:650}
}
"""
p.write_text(s,encoding='utf-8')
