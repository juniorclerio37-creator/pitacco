"""Remove the legacy administrative workspace from the merchant entry point."""
from pathlib import Path

path = Path('web/src.jsx')
source = path.read_text(encoding='utf-8')
start = source.index('if(admin&&platformWorkspace&&!nativeAvailable())')
end = source.index('return <div className={"app pitacco-theme-"+theme+',start)
source=source[:start]+source[end:]
source=source.replace("const [platformWorkspace,setPlatformWorkspace]=useState(()=>!nativeAvailable());","")
source=source.replace("useEffect(()=>{setPlatformWorkspace(!nativeAvailable())},[session?.user?.id]);\n","")
start = source.index('{admin&&!nativeAvailable()&&<button className="secondary admin-return"')
end = source.index('</button>}',start)+len('</button>}')
source=source[:start]+source[end:]
source=source.replace("const admin=profile?.role==='admin'","const admin=false")
source=source.replace("import Homologation from './Homologation.jsx';\n","").replace("import {ClipboardCheck} from 'lucide-react';\n","").replace("import BillingStatus,{BillingOverview} from './BillingStatus.jsx';","import BillingStatus from './BillingStatus.jsx';")
source="import {featureForTab,useStoreFeatures} from './storeFeatures.mjs';\n"+source
source="import {useStoreManagerAccess} from './storeAccess.mjs';\n"+source
manager_check="manager=admin||profile?.role==='gestor'||members.some(m=>m.user_id===session.user.id&&m.role==='gestor')"
assert source.count(manager_check)==1
source=source.replace(manager_check, "manager=nativeAvailable()?(admin||profile?.role==='gestor'||members.some(m=>m.user_id===session.user.id&&m.role==='gestor')):storeAccess.manager", 1)
tab_state="[tab,setTab]=useState('Pedidos')"
assert source.count(tab_state)==1
source=source.replace(tab_state,"[tab,setTab]=useState(()=>nativeAvailable()?'Pedidos':readMerchantTab())",1)
source=source.replace("const descriptions=", """const merchantTabs=new Set([...nav.map(([name])=>name),...Object.values(landing),
 ...Object.values(secondaryTabs).flat().map(([target])=>target),
 'Agendamento','Entregas','Entrega externa','Importar cardápio','Despesas','Assinaturas']);
function readMerchantTab(){
 const saved=new URL(window.location.href).searchParams.get('aba');
 return merchantTabs.has(saved)?saved:'Painel';
}
const descriptions=""",1)
needle='if(!supabase)return <SetupConnection/>;'
assert source.count(needle)==1
source=source.replace(needle,"""const featureSettings=useStoreFeatures(supabase,selected);
const storeAccess=useStoreManagerAccess(supabase,session?.user?.id,nativeAvailable()?null:selected);
const allowed=name=>{
 const feature=featureForTab(name);
 return nativeAvailable()||!feature||featureSettings?.[feature]===true;
};
useEffect(()=>{
 if(nativeAvailable())return;
 const location=new URL(window.location.href);
 if(tab==='Painel')location.searchParams.delete('aba');
 else if(merchantTabs.has(tab))location.searchParams.set('aba',tab);
 if(location.href!==window.location.href)window.history.replaceState(window.history.state,'',location.href);
},[tab]);
useEffect(()=>{if(featureSettings&&!allowed(tab))setTab('Painel')},[tab,featureSettings]);
"""+needle,1)
needle='Menu principal">{nav.filter'
assert source.count(needle)==1
source=source.replace(needle,'Menu principal">{nav.filter(([name])=>allowed(name)).filter',1)
needle="{manager&&!nativeAvailable()&&<button className={tab==='Agendamento'"
assert source.count(needle)==1
source=source.replace(needle,"{manager&&!nativeAvailable()&&allowed('Agendamento')&&<button className={tab==='Agendamento'",1)
# Guard the workspace as well as navigation when a module is removed.
needle='{active&&!isDriver&&!nativeAvailable()&&tab==='
start=source.index(needle)
end=source.index('</main>',start)
source=source[:start]+"""
{storeAccess.status==='loading'&&<div className="panel" role="status">Verificando acesso à loja…</div>}
{storeAccess.status==='error'&&<div className="panel"><p role="alert">Não foi possível verificar o acesso à loja.</p><button type="button" onClick={storeAccess.retry}>Tentar novamente</button></div>}
{storeAccess.status==='ready'&&allowed(tab)&&<>
"""+source[start:end]+'</>}\n'+source[end:]
# Also hide shortcuts for modules removed from the main menu.
dashboard=source.index('className="approved-dashboard"')
summary=source.index('<h3>Resumo financeiro</h3>',dashboard)
head,content,tail=source[:dashboard],source[dashboard:summary],source[summary:]
import re
content=re.sub(r"(<button[^>]*onClick=\{\(\)=>setTab\('(Produtos|Clientes|Fideliza\+|Entregadores|Lançamentos)'\)\}[^>]*>.*?</button>)",
               lambda found:"{allowed("+repr(found[2])+")&&"+found[1]+"}",content)
source=head+content+tail
source=source.replace('</React.Fragment>)}</nav>',"</React.Fragment>)}{!nativeAvailable()&&active&&featureSettings?.financeiro===false&&<button type=\"button\" onClick={()=>setTab('Assinaturas')}>Assinatura</button>}</nav>",1)
path.write_text(source,encoding='utf-8')
