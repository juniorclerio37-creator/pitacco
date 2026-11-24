import React,{useEffect,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {createClient} from '@supabase/supabase-js';
import {LayoutDashboard, Store, Package, CreditCard, ClipboardCheck, LogOut, Settings, ShoppingBag, Bike, ListChecks, Menu, Sun, Moon, Activity, ShieldCheck, CircleHelp, Plug, Megaphone, Sparkles, Monitor, Wallet} from 'lucide-react';
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

const adminHost='admin.pitacco.com.br';
const preview=import.meta.env.VITE_PITACCO_HOMOLOGACAO==='1';
const config=preview?connectionConfig(import.meta.env):{
 url:'https://mdevzehqcpcgxspwbiyz.supabase.co',key:'sb_publishable_JLIp1y5II26GrztrKDNIyQ_ryETrCuj'
};
const client=(preview||location.hostname===adminHost)&&config.url&&config.key?createClient(config.url,config.key):null;
const storefrontOrigin=preview?(import.meta.env.VITE_PITACCO_HOMOLOG_SITE_ORIGIN||''):'https://pitacco.com.br';
const groups=[
 ['Visão estratégica',[['Painel geral',LayoutDashboard,'Super Dashboard']]],
 ['Gestão comercial',[['Estabelecimentos',Store],['Assinaturas',CreditCard,'Planos e assinaturas'],['Plano Pitacco',Package,'Configuração dos planos'],['Financeiro do Pitacco',Wallet,'Financeiro']]],
 ['Gestão operacional',[['Pedidos',ShoppingBag,'Pedidos globais'],['Entregadores',Bike],['Módulos do lojista',Package,'Módulos e funcionalidades'],['Homologação',Plug,'Integrações e homologação']]],
 ['Tecnologia e suporte',[['Central de Aplicativos',Monitor,'Aplicativos e versões'],['Central de Diagnósticos',Activity,'Monitoramento do sistema'],['Suporte e incidentes',CircleHelp,'Central de suporte'],['Comunicados aos entregadores',Megaphone,'Central de comunicados'],['Pitacco Intelligence',Sparkles,'Inteligência artificial'],['Auditoria',ShieldCheck,'Segurança e auditoria']]]
];
const descriptions={
 'Painel geral':'Visão geral de toda a operação do Pitacco',
 Estabelecimentos:'Gerencie todas as lojas da plataforma',
 Assinaturas:'Acompanhe assinaturas, testes e cobranças',
 'Plano Pitacco':'Configure as condições comerciais da plataforma',
 'Financeiro do Pitacco':'Receitas, comissões e conciliação da plataforma',
 Pedidos:'Acompanhe os pedidos da plataforma',
 Entregadores:'Gerencie os entregadores das lojas',
 'Módulos do lojista':'Gerencie funcionalidades e permissões por estabelecimento',
 Homologação:'Acompanhe conexões e testes de integração',
 'Central de Aplicativos':'Gerencie versões e distribuição dos aplicativos',
 'Central de Diagnósticos':'Acompanhe a saúde operacional da plataforma',
 'Suporte e incidentes':'Gerencie chamados e acompanhe atendimentos',
 'Comunicados aos entregadores':'Envie e acompanhe comunicados operacionais',
 'Pitacco Intelligence':'Assistente administrativo e operacional',
 Auditoria:'Acompanhe o histórico de ações administrativas'
};
const pageTitle=page=>groups.flatMap(([,items])=>items).find(([name])=>name===page)?.[2]||page;
const operations={Pedidos:'orders',Entregadores:'couriers',Auditoria:'audit'};
function initialTheme(){
 try{return localStorage.getItem('pitacco.admin.theme')==='dark'?'dark':'light';}
 catch{return 'light';}
}

function AdminApp(){
 const [session,setSession]=useState(undefined),[verified,setVerified]=useState(null);
 const [stores,setStores]=useState([]),[storeId,setStoreId]=useState(''),[page,setPage]=useState('Painel geral');
 const [theme,setTheme]=useState(initialTheme),[sidebar,setSidebar]=useState(()=>!window.matchMedia('(max-width: 800px)').matches);
 const [storeSearch,setStoreSearch]=useState('');
 const [storeTab,setStoreTab]=useState('Identidade');
 const [error,setError]=useState(''),[busy,setBusy]=useState(false);

 useEffect(()=>{
  if(!client)return;
  const {data:{subscription}}=client.auth.onAuthStateChange((_event,next)=>setSession(next));
  return()=>subscription.unsubscribe();
 },[]);
 useEffect(()=>{
  let live=true;
  if(session){
   client.rpc('pitacco_is_platform_owner').then(({data,error})=>{
    if(live)setVerified({id:session.user.id,allowed:!error&&data===true,error:error?.message});
   }).catch(()=>{if(live)setVerified({id:session.user.id,allowed:false,error:'Falha na consulta de acesso'});});
  }
  return()=>{live=false;};
 },[session]);
 const authorized=!!session&&verified?.id===session.user.id&&verified.allowed;
 async function loadStores(){
  const all=[];
  for(let page=0;;page++){
   const {data,error}=await client.from('stores').select('*').order('name').order('id').range(page*100,page*100+99);
   if(error)throw error;
   all.push(...data);
   if(data.length<100)break;
  }
  setStores(all);
  setStoreId(old=>all.some(store=>store.id===old)?old:all[0]?.id||'');
 }
 useEffect(()=>{
  if(authorized)loadStores().catch(failure=>setError(failure.message));
  else {setStores([]);setStoreId('');}
 },[authorized]);

 async function signIn(event){
  event.preventDefault();
  setBusy(true);setError('');
  const form=new FormData(event.currentTarget);
  try{
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
 if(!client)return <main className="setup"><h1>Pitacco Admin</h1><p>Endereço administrativo indisponível.</p></main>;
 if(session===undefined||(session&&verified?.id!==session.user.id))return <main className="setup" role="status">Validando acesso…</main>;
 if(!session)return <main className="setup">
  <img className="auth-logo" src="/pitacco-brand-013.svg" alt="Pitacco"/>
  <h1>Pitacco Admin</h1>
  <form onSubmit={signIn}>
   <label htmlFor="owner-username">Usuário</label><input id="owner-username" name="username" inputMode="numeric" pattern="[0-9]{11}" maxLength={11} autoComplete="username" required/>
   <label htmlFor="owner-password">Senha</label><input id="owner-password" name="password" type="password" autoComplete="current-password" required/>
   <button disabled={busy}>{busy?'Entrando…':'Entrar'}</button>
  </form>
  {error&&<p role="alert">{error}</p>}
 </main>;
 if(!authorized)return <main className="setup">
  <h1>Pitacco Admin</h1>
  <p role="alert">{verified.error?'Não foi possível verificar sua autorização.':'Acesso exclusivo do proprietário do Pitacco.'}</p>
  <button type="button" onClick={signOut}>Sair</button>
 </main>;
 function openStore(id){
  setStoreId(id);setStoreTab('Identidade');setPage('Estabelecimentos');
 }
 function changePage(next){
  setPage(next);
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
 return <div className={`app pitacco-admin-shell super-admin pitacco-theme-${theme}${sidebar?'':' admin-collapsed'}`}>
  <aside id="admin-sidebar">
   <div className="brand pitacco-platform-brand"><span className="admin-brand-icon"><ShieldCheck size={30} aria-hidden="true"/></span><span><strong>PITACCO</strong><small>Super Admin</small></span></div>
   <nav aria-label="Administração geral">{groups.map(([group,pages])=><details key={group} open>
    <summary>{group}</summary>
    {pages.map(([name,Icon,label])=><button key={name} type="button" aria-current={page===name?'page':undefined} className={page===name?'active':''}
     onClick={()=>changePage(name)}><Icon size={17} aria-hidden="true"/>{label||name}</button>)}
   </details>)}</nav>
   <button type="button" className="logout" onClick={signOut}><LogOut size={16}/> Sair</button>
  </aside>
  <main className="pitacco-workspace pitacco-workspace--admin">
   <header className="admin-top">
    <div><button type="button" className="secondary" aria-label="Menu administrativo" aria-controls="admin-sidebar" aria-expanded={sidebar} onClick={()=>setSidebar(value=>!value)}><Menu size={18}/></button>
    <div className="admin-heading"><h2>{pageTitle(page)}</h2><p>{descriptions[page]}</p></div></div>
    <div className="admin-top-actions">
     <OwnerIncidentNotifier client={client} onOpen={()=>changePage('Central de Diagnósticos')}/>
     <details className="admin-search"><summary>Buscar loja</summary>
      <label className="field">Nome da loja<input type="search" value={storeSearch} onChange={event=>setStoreSearch(event.target.value)}/></label>
      {results.length===0?<p>Nenhuma loja encontrada.</p>:<label className="field">Resultados<select value="" onChange={event=>{
        if(event.target.value){openStore(event.target.value);event.currentTarget.closest('details').open=false;}
       }}><option value="">Selecione a loja</option>{results.map(item=><option key={item.id} value={item.id}>{item.name}</option>)}</select></label>}
     </details>
     <button type="button" className="secondary" aria-label={theme==='dark'?'Ativar modo claro':'Ativar modo escuro'} onClick={toggleTheme}><ThemeIcon size={18}/></button>
     <details className="admin-profile"><summary><span className="admin-avatar" aria-hidden="true">PA</span><span><strong>Pitacco Admin</strong><small>Super Administrador</small></span></summary><p>Proprietário do Pitacco</p><button type="button" className="secondary" onClick={signOut}>Encerrar sessão</button></details>
    </div>
   </header>
   {error&&<p role="alert">{error}</p>}
   {page==='Painel geral'&&<OwnerDashboard client={client} onStore={openStore}/>}
   {operations[page]&&<OwnerOperations key={page} client={client} stores={stores} kind={operations[page]}/>}
   {page==='Comunicados aos entregadores'&&<OwnerCourierCampaigns client={client} stores={stores}/>}
   {page==='Financeiro do Pitacco'&&<OwnerFinance client={client} stores={stores}/>}
   {page==='Plano Pitacco'&&<OwnerPlans client={client} stores={stores}/>}
   {page==='Assinaturas'&&<OwnerSubscriptions client={client}/>}
   {page==='Módulos do lojista'&&<OwnerFeatures client={client} stores={stores}/>}
   {page==='Central de Aplicativos'&&<OwnerAppReleases client={client}/>}
   {page==='Suporte e incidentes'&&<SupportCenter client={client} stores={stores} owner/>}
   {page==='Central de Diagnósticos'&&<IncidentCenter client={client} stores={stores} owner/>}
   {page==='Pitacco Intelligence'&&<><PitaccoIntelligence client={client} stores={stores}/><IncidentCenter client={client} stores={stores} owner/></>}
   {page==='Homologação'&&<>
    <OwnerIfood client={client} stores={stores}/>
    <Owner99Food client={client} stores={stores}/>
    <Homologation client={client} stores={stores} storefrontOrigin={storefrontOrigin}/>
   </>}
   {page==='Estabelecimentos'&&<section className="panel" aria-label="Configuração do estabelecimento">
    <label htmlFor="owner-store">Estabelecimento</label>
    <select id="owner-store" value={storeId} onChange={event=>setStoreId(event.target.value)}>
     {!stores.length&&<option value="">Nenhuma loja cadastrada</option>}
     {stores.map(item=><option key={item.id} value={item.id}>{item.name}</option>)}
    </select>
    {store&&<>
     <nav className="pitacco-local-tabs" aria-label="Seções do estabelecimento">
      {['Identidade','Catálogo','Checkout','Agendamento','Pedidos','Entregadores','Auditoria'].map(tab=><button key={tab} type="button" aria-pressed={storeTab===tab}
       className={storeTab===tab?'active':'secondary'} onClick={()=>setStoreTab(tab)}>{tab}</button>)}
     </nav>
     {operations[storeTab]&&<OwnerOperations key={store.id+storeTab} client={client} storeId={store.id} kind={operations[storeTab]}/>}
     {storeTab==='Identidade'&&<StoreProfile key={store.id} client={client} store={store} manager onSaved={()=>loadStores().catch(failure=>setError(failure.message))}/>}
     {storeTab==='Catálogo'&&<OwnerCatalog key={store.id} client={client} storeId={store.id}/>}
     {storeTab==='Checkout'&&<OwnerMenuSettings key={store.id} client={client} storeId={store.id} storefrontOrigin={storefrontOrigin}/>}
     {storeTab==='Agendamento'&&<ScheduleSettings key={store.id} client={client} storeId={store.id}/>}
    </>}
   </section>}
  </main>
 </div>;
}
createRoot(document.getElementById('root')).render(<AdminApp/>);
