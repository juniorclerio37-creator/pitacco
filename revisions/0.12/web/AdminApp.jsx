import React,{useEffect,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {createClient} from '@supabase/supabase-js';
import {LayoutDashboard, Store, Package, CreditCard, ClipboardCheck, LogOut, Settings, ShoppingBag, Bike, ListChecks, Menu, Sun, Moon, Activity} from 'lucide-react';
import {connectionConfig} from './config.mjs';
import OwnerSubscriptions from './OwnerSubscriptions.jsx';
import OwnerDashboard from './OwnerDashboard.jsx';
import Homologation from './Homologation.jsx';
import Owner99Food from './Owner99Food.jsx';
import OwnerIfood from './OwnerIfood.jsx';
import OwnerFeatures from './OwnerFeatures.jsx';
import StoreProfile from './StoreProfile.jsx';
import OwnerCatalog from './OwnerCatalog.jsx';
import OwnerMenuSettings from './OwnerMenuSettings.jsx';
import ScheduleSettings from './ScheduleSettings.jsx';
import OwnerFinance from './OwnerFinance.jsx';
import OwnerCommercialFinance from './OwnerCommercialFinance.jsx';
import OwnerPlans from './OwnerPlans.jsx';
import OwnerOperations from './OwnerOperations.jsx';
import OwnerAppReleases from './OwnerAppReleases.jsx';
import OwnerCourierCampaigns from './OwnerCourierCampaigns.jsx';
import SupportCenter from './SupportCenter.jsx';
import IncidentCenter from './IncidentCenter.jsx';
import PitaccoIntelligence from './PitaccoIntelligence.jsx';
import OwnerIncidentNotifier from './OwnerIncidentNotifier.jsx';
import './style.css';
import './super-admin.css';
import './control-center.css';
import {Search,TrendingUp,Users,MapPin,Plug,ShieldCheck,Bell,Megaphone,SlidersHorizontal,PanelLeftClose,PanelLeftOpen,ArrowUpRight,Headphones,Wallet,Monitor,Command,ChevronRight,LockKeyhole,ArrowLeft,Layers} from 'lucide-react';
import {controlGroups,controlTitle,canControl} from './controlCenter.mjs';
import {ControlBrand,ControlSearch} from './ControlChrome.jsx';
import ControlDashboard from './ControlDashboard.jsx';
import ControlAppCatalog from './ControlAppCatalog.jsx';
import ControlDirectory from './ControlDirectory.jsx';
import ControlAlerts from './ControlAlerts.jsx';
import {ControlData,ControlSecurity,ControlFeatureRollout,ControlUpdatePolicy} from './ControlWorkspaces.jsx';

const adminHost='admin.pitacco.com.br';
const preview=import.meta.env.VITE_PITACCO_HOMOLOGACAO==='1';
const config=preview?connectionConfig(import.meta.env):{
 url:'https://mdevzehqcpcgxspwbiyz.supabase.co',key:'sb_publishable_JLIp1y5II26GrztrKDNIyQ_ryETrCuj'
};
const client=(preview||location.hostname===adminHost)&&config.url&&config.key?createClient(config.url,config.key):null;
const storefrontOrigin=preview?(import.meta.env.VITE_PITACCO_HOMOLOG_SITE_ORIGIN||''):'https://pitacco.com.br';
const controlIcons={'Painel geral':LayoutDashboard,Crescimento:TrendingUp,Estabelecimentos:Store,Usuários:Users,Assinaturas:CreditCard,'Financeiro do Pitacco':Wallet,'Cobranças e inadimplência':ClipboardCheck,Pedidos:ShoppingBag,Entregadores:Bike,'Mapa de operações':MapPin,Homologação:Plug,'Módulos do lojista':Layers,'Central de Aplicativos':Monitor,'Saúde da plataforma':Activity,Auditoria:ShieldCheck,'Pitacco Intelligence':Command,'Central de Diagnósticos':Bell,'Suporte e incidentes':Headphones,Comunicados:Megaphone,'Configurações gerais':SlidersHorizontal,'Administradores e permissões':LockKeyhole};
const operations={Pedidos:'orders',Entregadores:'couriers',Auditoria:'audit'};
function initialTheme(){
 try{return localStorage.getItem('pitacco.admin.theme')==='dark'?'dark':'light';}
 catch{return 'light';}
}

function OwnerCopyStore({client,store,stores,onCopied}){
 const [mode,setMode]=useState('duplicate'),[name,setName]=useState(store.name+' — cópia'),[target,setTarget]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState(''),[result,setResult]=useState(null),[request,setRequest]=useState(()=>crypto.randomUUID());
 const reset=()=>{setRequest(crypto.randomUUID());setResult(null);setError('');};
 async function copy(event){
  event.preventDefault();if(busy||result)return;
  const destination=stores.find(s=>s.id===target);
  if(mode==='catalog'&&!destination)return;
  if(!window.confirm(mode==='duplicate'?'Criar um novo estabelecimento com o catálogo de '+store.name+'?':'Copiar o cardápio de '+store.name+' para '+destination.name+'? O destino deve ter catálogo vazio. A identidade e os pagamentos serão preservados.'))return;
  setBusy(true);setError('');
  try{
   const manifest=await client.rpc('pitacco_owner_copy_media_manifest',{p_source:store.id,p_target:mode==='catalog'?target:null,p_request:request});
   if(manifest.error)throw manifest.error;
   for(const file of manifest.data||[]){
    if(file.exists)continue;
    const copied=await client.storage.from('pitacco-media').copy(file.source,file.target);
    if(copied.error)throw copied.error;
   }
   const {data,error}=await client.rpc('pitacco_owner_copy_catalog',{p_source:store.id,p_target:mode==='catalog'?target:null,p_new_name:mode==='duplicate'?name.trim():null,p_request:request});
   if(error)throw error;
   if(!data?.store_id)throw Error('O servidor não confirmou a cópia.');
   setResult(data);
  }catch(err){setError(err?.message||'Não foi possível concluir a cópia.');}
  finally{setBusy(false);}
 }
 return <section className="panel" aria-label="Duplicar loja ou clonar cardápio">
  <h3>Duplicação e clonagem</h3>
  <p>Loja de origem: <strong>{store.name}</strong></p>
  <form onSubmit={copy}>
   <label><input type="radio" name="copy-mode" checked={mode==='duplicate'} disabled={busy} onChange={()=>{setMode('duplicate');reset();}}/> Duplicar loja</label>
   <label><input type="radio" name="copy-mode" checked={mode==='catalog'} disabled={busy} onChange={()=>{setMode('catalog');reset();}}/> Clonar cardápio para outra loja</label>
   {mode==='duplicate'?<label>Nome da nova loja<input required minLength={3} maxLength={100} value={name} disabled={busy} onChange={e=>{setName(e.target.value);reset();}}/></label>:<label>Loja de destino<select required value={target} disabled={busy} onChange={e=>{setTarget(e.target.value);reset();}}><option value="">Selecione a loja de destino</option>{stores.filter(s=>s.id!==store.id).map(s=><option key={s.id} value={s.id}>{s.name}</option>)}</select></label>}
   <p>Copia produtos, preços, categorias, complementos, pizzas, combos, aparência e banners, mantendo a disponibilidade original. O destino precisa ter catálogo vazio. Identidade, pagamentos, contatos e redes sociais do destino são preservados. Revise imagens e textos promocionais que possam mencionar a loja original. Custos e estoque não são copiados.</p>
   {mode==='duplicate'&&<p>A nova loja terá endereço, titularidade, usuários, assinatura e integrações próprios, a configurar posteriormente. O cardápio ficará desativado.</p>}
   <button disabled={busy||!!result||(mode==='catalog'&&!target)}>{busy?'Copiando…':mode==='duplicate'?'Duplicar estabelecimento':'Clonar cardápio'}</button>
  </form>
  {error&&<p role="alert">{error}</p>}
  {result&&<div role="status"><strong>Cópia concluída.</strong><p>{result.products} produtos, {result.groups} grupos, {result.options} complementos e {result.pizzas} pizzas e {result.combos||0} combos.</p><button type="button" onClick={()=>onCopied(result.store_id)}>Abrir loja de destino</button></div>}
 </section>;
}

function AdminApp(){
 const [session,setSession]=useState(undefined),[verified,setVerified]=useState(null);
 const [stores,setStores]=useState([]),[storeId,setStoreId]=useState(''),[page,setPage]=useState('Painel geral');
 const [theme,setTheme]=useState(initialTheme),[sidebar,setSidebar]=useState(()=>!window.matchMedia('(max-width: 800px)').matches);
 const [storeSearch,setStoreSearch]=useState('');
 const [storeTab,setStoreTab]=useState('Visão geral');
 const [error,setError]=useState(''),[busy,setBusy]=useState(false);
 const [adminEmailLogin,setAdminEmailLogin]=useState(false),[context,setContext]=useState({}),[accessRevision,recheckAccess]=useState(0);

 useEffect(()=>{
  if(!client)return;
  const {data:{subscription}}=client.auth.onAuthStateChange((_event,next)=>setSession(next));
  return()=>subscription.unsubscribe();
 },[]);
 useEffect(()=>{
  let live=true;
  if(session){
   Promise.all([client.rpc('pitacco_is_platform_owner'),client.rpc('pitacco_control_access')]).then(([owner,access])=>{
    if(!live)return;
    const root=!owner.error&&owner.data===true;
    const state=access.data?.allowed===true?access.data:null;
    setVerified({id:session.user.id,allowed:root||!!state,owner:root||state?.owner===true,role:state?.role||'owner',modules:state?.modules||[],aal:state?.aal||'aal1',error:root||state?null:owner.error?.message||access.error?.message});
   }).catch(()=>{if(live)setVerified({id:session.user.id,allowed:false,error:'Falha na consulta de acesso'});});
  }
  return()=>{live=false;};
 },[session,accessRevision]);
 const authorized=!!session&&verified?.id===session.user.id&&verified.allowed;
 async function loadStores(isCurrent=()=>true){
  if(!verified?.owner){const r=await client.rpc('pitacco_control_stores',{p_page:0});if(r.error)throw r.error;if(isCurrent())setStores(r.data?.rows||[]);return;}
  const all=[];
  for(let page=0;;page++){
   const {data,error}=await client.from('stores').select('*').order('name').order('id').range(page*100,page*100+99);
   if(error)throw error;
   all.push(...data);
   if(data.length<100)break;
  }
  if(!isCurrent())return;
  setStores(all);
  setStoreId(old=>all.some(store=>store.id===old)?old:'');
 }
 useEffect(()=>{
  let live=true,running=false;
  if(!authorized){setStores([]);setStoreId('');return;}
  async function refreshStores(){
   if(running)return;running=true;
   try{await loadStores(()=>live)}catch(failure){if(live)setError(failure.message)}finally{running=false}
  }
  const refreshVisible=()=>{if(document.visibilityState==='visible')void refreshStores()};
  void refreshStores();const timer=setInterval(refreshVisible,15000);
  window.addEventListener('focus',refreshVisible);window.addEventListener('pitacco:store-identity',refreshVisible);
  return()=>{live=false;clearInterval(timer);window.removeEventListener('focus',refreshVisible);window.removeEventListener('pitacco:store-identity',refreshVisible)};
 },[authorized,session?.user?.id,verified?.owner]);

 async function signIn(event){
  event.preventDefault();
  setBusy(true);setError('');
  const form=new FormData(event.currentTarget);
  try{
   if(adminEmailLogin){
    const {error}=await client.auth.signInWithPassword({email:String(form.get('email')).trim(),password:String(form.get('password'))});
    if(error)throw error;return;
   }
   const response=await fetch(new URL('/functions/v1/platform-owner-login',config.url),{
    method:'POST',headers:{apikey:config.key,'content-type':'application/json'},
    body:JSON.stringify({username:String(form.get('username')).trim(),password:String(form.get('password'))})
   });
   if(response.status===401){setError('Usuário ou senha inválidos.');return;}
   if(response.status===429){setError('Muitas tentativas. Aguarde e tente novamente.');return;}
   if(!response.ok)throw new Error();
   const {access_token,refresh_token}=await response.json();
   const {error}=await client.auth.setSession({access_token,refresh_token});
   if(error)throw error;
  }catch{setError('Não foi possível entrar no Pitacco Admin. Tente novamente.');}
  finally{setBusy(false);}
 }
 async function signOut(){
  const {error}=await client.auth.signOut();
  if(error)setError(error.message);
  else {setVerified(null);setError('');setPage('Painel geral');}
 }
 if(!client)return <main className="setup"><h1>Pitacco Control Center</h1><p>Endereço administrativo indisponível.</p></main>;
 if(session===undefined||(session&&verified?.id!==session.user.id))return <main className="setup" role="status">Validando acesso…</main>;
 if(!session)return <main className="setup">
  <img className="auth-logo" src="/pitacco-brand-013.svg" alt="Pitacco"/>
  <h1>Pitacco Control Center</h1>
  <div className="cc-login-tabs"><button type="button" aria-pressed={!adminEmailLogin} onClick={()=>setAdminEmailLogin(false)}>Proprietário</button><button type="button" aria-pressed={adminEmailLogin} onClick={()=>setAdminEmailLogin(true)}>Equipe administrativa</button></div>
  <form onSubmit={signIn}>
   {adminEmailLogin?<><label htmlFor="admin-email">E-mail administrativo</label><input id="admin-email" name="email" type="email" autoComplete="username" required/></>:<><label htmlFor="owner-username">Usuário</label><input id="owner-username" name="username" inputMode="numeric" pattern="[0-9]{11}" maxLength={11} autoComplete="username" required/></>}
   <label htmlFor="owner-password">Senha</label><input id="owner-password" name="password" type="password" autoComplete="current-password" required/>
   <button disabled={busy}>{busy?'Entrando…':'Entrar'}</button>
  </form>
  {error&&<p role="alert">{error}</p>}
 </main>;
 if(!authorized)return <main className="setup">
  <h1>Pitacco Control Center</h1>
  <p role="alert">{verified.error?'Não foi possível verificar sua autorização.':'Acesso exclusivo do proprietário do Pitacco e administradores autorizados.'}</p>
  <button type="button" onClick={signOut}>Sair</button>
 </main>;
 function openStore(id){
  const row=typeof id==='object'?id:null;const target=row?.id||id;
  if(row)setStores(current=>current.some(s=>s.id===target)?current:[...current,row]);
  setStoreId(target);setStoreTab('Visão geral');setPage('Estabelecimentos');
 }
 function changePage(next,nextContext={}){
  const entry=controlGroups.flatMap(([,items])=>items).find(r=>r[0]===next);
  if(entry&&!canControl(entry,verified)){setError('Seu perfil não permite abrir este módulo.');return;}
  if(next==='Estabelecimentos')setStoreId('');
  setContext(nextContext);setError('');setPage(next);
  if(window.matchMedia('(max-width: 800px)').matches)setSidebar(false);
 }
 function toggleTheme(){
  const next=theme==='dark'?'light':'dark';
  setTheme(next);
  try{localStorage.setItem('pitacco.admin.theme',next);}catch{}
 }
 const store=stores.find(item=>item.id===storeId);
 const results=stores.filter(item=>item.name.toLocaleLowerCase('pt-BR').includes(storeSearch.trim().toLocaleLowerCase('pt-BR')));
 const ThemeIcon=theme==='dark'?Sun:Moon;
 return <div className={`app pitacco-admin-shell super-admin cc-shell pitacco-theme-${theme}${sidebar?'':' admin-collapsed cc-collapsed'}`}>
  <aside id="admin-sidebar">
   <ControlBrand/>
   <button type="button" className="cc-sidebar-toggle" aria-label="Recolher menu administrativo" onClick={()=>setSidebar(value=>!value)}>{sidebar?<PanelLeftClose size={19}/>:<PanelLeftOpen size={19}/>}</button>
   <nav aria-label="Administração geral">{controlGroups.map(([group,entries])=>{
    const pages=entries.filter(r=>canControl(r,verified));if(!pages.length)return null;
    return <section className="cc-nav-group" key={group}><h3>{group}</h3>{pages.map(([name])=>{const Icon=controlIcons[name]||Settings;return <button key={name} type="button" title={controlTitle(name)} aria-label={controlTitle(name)} aria-current={page===name?'page':undefined} className={page===name?'active':''} onClick={()=>changePage(name)}><Icon size={19}/><span>{controlTitle(name)}</span>{page===name&&<i/>}</button>})}</section>;
   })}</nav>
   <div className="cc-sidebar-footer"><button type="button" onClick={()=>changePage(verified.owner?'Auditoria':'Minha segurança')}><span className="cc-avatar">{verified.owner?'P':'A'}</span><span><strong>{verified.owner?'Proprietário':'Equipe Pitacco'}</strong><small>{verified.aal==='aal2'?'Sessão protegida com 2FA':'Verificar segundo fator'}</small></span><ShieldCheck size={17}/></button><button type="button" className="logout" aria-label="Sair" onClick={signOut}><LogOut size={17}/><span>Sair</span></button></div>
  </aside>
  <main className="pitacco-workspace pitacco-workspace--admin cc-main">
   <header className="admin-top cc-topbar"><div className="cc-topbar-left"><button type="button" className="secondary cc-icon" aria-label="Menu administrativo" aria-controls="admin-sidebar" aria-expanded={sidebar} onClick={()=>setSidebar(value=>!value)}><Menu size={20}/></button><div className="cc-breadcrumb"><span>Control Center</span><ChevronRight size={14}/><strong>{controlTitle(page)}</strong></div></div>
    <ControlSearch client={client} access={verified} onNavigate={changePage} onStore={openStore} stores={stores}/>
    <div className="admin-top-actions cc-topbar-actions">{verified.owner&&<OwnerIncidentNotifier compact client={client} onOpen={()=>changePage('Central de Diagnósticos')}/>}<button type="button" className="secondary cc-icon" aria-label={theme==='dark'?'Ativar modo claro':'Ativar modo escuro'} onClick={toggleTheme}><ThemeIcon size={19}/></button><button type="button" className="cc-avatar cc-account" aria-label="Segurança da minha conta" onClick={()=>changePage(verified.owner?'Auditoria':'Minha segurança')}>P</button></div>
   </header>
   <div className="cc-page-body">
   {error&&<p role="alert">{error}</p>}
   {['Painel geral','Crescimento'].includes(page)&&<ControlDashboard key={page} client={client} owner={verified.owner} access={verified} growth={page==='Crescimento'} onStore={openStore} onNavigate={changePage}/>}
   {operations[page]&&verified.owner&&<><OwnerOperations key={page+JSON.stringify(context)} client={client} stores={stores} kind={operations[page]} initialFilters={context.source?{p_source:context.source}:context.range?{p_start:context.range.start,p_end:context.range.end}:{}}/>{page==='Auditoria'&&<><ControlSecurity client={client} access={verified} onVerified={()=>recheckAccess(n=>n+1)}/><ControlData client={client} view="audit" stores={stores} access={verified} onNavigate={changePage}/><ControlData client={client} view="sessions" access={verified}/></>}</>}
   {page==='Comunicados'&&<><ControlData client={client} view="notices" stores={stores} access={verified} onNavigate={changePage}/>{verified.owner&&<details className="cc-card"><summary>Campanhas de push aos entregadores</summary><OwnerCourierCampaigns client={client} stores={stores}/></details>}</>}
   {page==='Financeiro do Pitacco'&&<OwnerFinance client={client} stores={stores}/>}
   
   {page==='Assinaturas'&&<><OwnerSubscriptions client={client}/><details className="cc-card"><summary>Catálogo e regras dos planos</summary><OwnerPlans client={client} stores={stores}/></details></>}
   {page==='Módulos do lojista'&&<><ControlFeatureRollout client={client} stores={stores} access={verified}/><ControlData client={client} view="audit" access={verified}/></>}
   {page==='Central de Aplicativos'&&<><ControlAppCatalog client={client}/><ControlUpdatePolicy client={client} access={verified}/><OwnerAppReleases client={client}/><ControlData client={client} view="devices" stores={stores} access={verified}/></>}
   {page==='Suporte e incidentes'&&<SupportCenter client={client} stores={stores} owner/>}
   {page==='Central de Diagnósticos'&&<ControlAlerts client={client} stores={stores} access={verified}/>}
   {page==='Pitacco Intelligence'&&<div className="cc-intelligence"><div className="cc-intelligence-intro"><span className="cc-kicker">Pitacco Intelligence</span><h1>Inteligência para enxergar além do alerta.</h1><p>Diagnósticos apoiados em evidências, contexto operacional e ações autorizadas.</p></div><PitaccoIntelligence client={client} stores={stores}/><ControlAlerts client={client} stores={stores} access={verified}/></div>}
   {page==='Homologação'&&<>
    {/* Roteiro de homologação iFood com evidências por loja. */}
    <OwnerIfood client={client} stores={stores}/>
    <Owner99Food client={client} stores={stores}/>
    <Homologation client={client} stores={stores} storefrontOrigin={storefrontOrigin}/>
   </>}
   {page==='Minha segurança'&&<ControlSecurity client={client} access={verified} onVerified={()=>recheckAccess(n=>n+1)}/>}
   {({'Usuários':'users','Cobranças e inadimplência':'charges','Custos e despesas':'costs','Mapa de operações':'map','Saúde da plataforma':'health','Configurações gerais':'settings','Administradores e permissões':'admins'})[page]&&<><ControlData key={page} client={client} view={({ 'Usuários':'users','Cobranças e inadimplência':'charges','Custos e despesas':'costs','Mapa de operações':'map','Saúde da plataforma':'health','Configurações gerais':'settings','Administradores e permissões':'admins'})[page]} stores={stores} access={verified} onNavigate={changePage}/>{page==='Administradores e permissões'&&<ControlSecurity client={client} access={verified} onVerified={()=>recheckAccess(n=>n+1)}/>}</>}
   {page==='Estabelecimentos'&&!store&&<ControlDirectory key={(context.status||'all')+(context.plan||'all')} client={client} stores={stores} initialStatus={context.status} initialPlan={context.plan} onOpen={openStore}/>}
   {page==='Estabelecimentos'&&store&&<section className="panel" aria-label="Configuração do estabelecimento">
    <div className="cc-store-detail-heading"><button type="button" className="cc-text-action" onClick={()=>setStoreId('')}><ArrowLeft size={17}/> Todos os estabelecimentos</button><span className="cc-kicker">Ficha do estabelecimento</span><h1>{store?.name}</h1><small>{store?.id}</small></div>
    {store&&<>
     <nav className="pitacco-local-tabs" aria-label="Seções do estabelecimento">
      {(verified.owner?['Visão geral','Identidade','Usuários e permissões','Pedidos','Financeiro','Assinatura e pagamentos','Módulos','Integrações','Entregadores','Dispositivos e versões','Configurações','Diagnósticos','Histórico e auditoria','Assistência','Catálogo','Duplicação e clonagem','Checkout','Agendamento']:['Visão geral',...(verified.modules?.includes('users')?['Usuários e permissões']:[]),...(verified.modules?.includes('health')?['Dispositivos e versões']:[]),...(verified.modules?.includes('finance')?['Financeiro']:[]),...(verified.modules?.includes('assistance')?['Assistência']:[])]).map(tab=><button key={tab} type="button" aria-pressed={storeTab===tab}
       className={storeTab===tab?'active':'secondary'} onClick={()=>setStoreTab(tab)}>{tab}</button>)}
     </nav>
     {storeTab==='Visão geral'&&<div className="cc-card"><h2>Operação e cadastro</h2><p>{[store.address,store.address_number,store.city,store.state].filter(Boolean).join(', ')||'Endereço a completar no cadastro central.'}</p><p>Identificação única: {store.id}</p><p>As demais seções consultam esta mesma loja, com permissões verificadas no servidor.</p></div>}
     {({'Usuários e permissões':'users','Financeiro':'charges','Dispositivos e versões':'devices','Histórico e auditoria':'audit','Assistência':'assistance'})[storeTab]&&<ControlData key={store.id+storeTab} client={client} view={({ 'Usuários e permissões':'users','Financeiro':'charges','Dispositivos e versões':'devices','Histórico e auditoria':'audit','Assistência':'assistance'})[storeTab]} storeId={store.id} stores={stores} access={verified} onNavigate={changePage}/>}
     {storeTab==='Assinatura e pagamentos'&&<OwnerCommercialFinance client={client} stores={[store]} initialStore={store.id}/>}
     {storeTab==='Módulos'&&<OwnerFeatures key={store.id} client={client} stores={[store]} initialStore={store.id}/>}
     {storeTab==='Integrações'&&<OwnerIfood client={client} stores={[store]} initialStore={store.id}/>}
     {storeTab==='Diagnósticos'&&<><ControlAlerts client={client} stores={[store]} storeId={store.id} access={verified}/><ControlData client={client} view="devices" storeId={store.id} access={verified}/></>}
     {storeTab==='Configurações'&&<OwnerMenuSettings key={store.id} client={client} storeId={store.id} storefrontOrigin={storefrontOrigin}/>}
     {operations[storeTab]&&<OwnerOperations key={store.id+storeTab} client={client} storeId={store.id} kind={operations[storeTab]}/>}
     {storeTab==='Identidade'&&<StoreProfile key={store.id} client={client} store={store} manager onSaved={()=>loadStores().catch(failure=>setError(failure.message))}/>}
     {storeTab==='Catálogo'&&<OwnerCatalog key={store.id} client={client} storeId={store.id}/>}
     {storeTab==='Duplicação e clonagem'&&<OwnerCopyStore key={store.id} client={client} store={store} stores={stores} onCopied={async id=>{try{await loadStores();openStore(id);setStoreTab('Catálogo');}catch(err){setError(err.message);}}}/>}
     {storeTab==='Checkout'&&<OwnerMenuSettings key={store.id} client={client} storeId={store.id} storefrontOrigin={storefrontOrigin}/>}
     {storeTab==='Agendamento'&&<ScheduleSettings key={store.id} client={client} storeId={store.id}/>}
    </>}
   </section>}
   </div>
  </main>
 </div>;
}
createRoot(document.getElementById('root')).render(<AdminApp/>);
