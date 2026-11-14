"""Keep the store workspace accessible without a full-width sidebar on mobile."""
from pathlib import Path

path = Path('web/src.jsx')
source = path.read_text(encoding='utf-8')

def replace(old, new):
    global source
    if source.count(old) != 1:
        raise ValueError(f'Trecho esperado na navegação: {old}')
    source = source.replace(old, new, 1)

replace("Truck,Settings,Plug,Printer}from'lucide-react'", "Truck,Settings,Plug,Printer,Menu}from'lucide-react'")
replace("const [platformWorkspace,setPlatformWorkspace]", """const [mobileMenuOpen,setMobileMenuOpen]=useState(false);
const [platformWorkspace,setPlatformWorkspace]""")
replace('return <div className={"app pitacco-theme-"+theme}><aside>', """return <div className={"app pitacco-theme-"+theme+(nativeAvailable()?"":" pitacco-mobile-workspace")}>
{!nativeAvailable()&&<>
<header className="pitacco-mobile-top">
 <span><ShoppingBag size={19} aria-hidden="true"/><strong>{active?.name||'Pitacco'}</strong></span>
 <button type="button" className="secondary" aria-controls="pitacco-store-navigation" aria-expanded={mobileMenuOpen} aria-label={mobileMenuOpen?'Fechar menu':'Abrir menu'} onClick={()=>setMobileMenuOpen(open=>!open)}><Menu size={21}/></button>
</header>
{mobileMenuOpen&&<button type="button" className="pitacco-mobile-backdrop" aria-label="Fechar navegação" onClick={()=>setMobileMenuOpen(false)}/>}
</>}
<aside id="pitacco-store-navigation" className={mobileMenuOpen?'pitacco-mobile-drawer-open':''} onKeyDown={event=>{if(event.key==='Escape')setMobileMenuOpen(false)}}>""")
replace("landing[name]||name);setMessage('')", "landing[name]||name);setMessage('');setMobileMenuOpen(false)")
replace("setTab(target);setMessage('')", "setTab(target);setMessage('');setMobileMenuOpen(false)")
path.write_text(source, encoding='utf-8')

with Path('web/style.css').open('a', encoding='utf-8') as css:
    css.write("""
.pitacco-mobile-top,.pitacco-mobile-backdrop{display:none}
@media(max-width:800px){
 .app.pitacco-mobile-workspace{display:block;min-width:0}
 .app.pitacco-mobile-workspace>.pitacco-mobile-top{
  position:sticky;top:0;z-index:120;display:flex;align-items:center;justify-content:space-between;
  gap:12px;padding:10px 16px;min-height:56px;background:#fff8f3;color:#30251f;border-bottom:1px solid #ecd9ce;
 }
 .pitacco-mobile-top>span{display:flex;align-items:center;gap:9px;min-width:0}
 .pitacco-mobile-top>span svg{color:#d45420;flex:none}
 .pitacco-mobile-top strong{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
 .app.pitacco-mobile-workspace>.pitacco-mobile-backdrop{
  display:block;position:fixed;inset:56px 0 0;z-index:121;background:#21181080;border:0;border-radius:0;
 }
 .app.pitacco-mobile-workspace>aside{
  position:fixed;inset:56px auto 0 0;z-index:122;display:none;flex-direction:column;
  width:min(320px,90vw);min-width:0;max-height:calc(100dvh - 56px);overflow:auto;
 }
 .app.pitacco-mobile-workspace>aside.pitacco-mobile-drawer-open{display:flex}
 .app.pitacco-mobile-workspace>main{width:100%;min-width:0}
 .app.pitacco-theme-dark>.pitacco-mobile-top{background:#211e1d;color:#fff5ef;border-color:#423630}
}
""")
