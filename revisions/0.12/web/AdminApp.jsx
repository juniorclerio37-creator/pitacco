import React,{useEffect,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {createClient} from '@supabase/supabase-js';
import {LayoutDashboard, Store, Package, CreditCard, ClipboardCheck, LogOut, Settings} from 'lucide-react';
import {connectionConfig} from './config.mjs';
import {BillingOverview} from './BillingStatus.jsx';
import Homologation from './Homologation.jsx';
import OwnerFeatures from './OwnerFeatures.jsx';
import StoreProfile from './StoreProfile.jsx';
import OwnerCatalog from './OwnerCatalog.jsx';
import OwnerMenuSettings from './OwnerMenuSettings.jsx';
import ScheduleSettings from './ScheduleSettings.jsx';
import './style.css';

const adminHost='admin.pitacco.com.br';
const preview=import.meta.env.VITE_PITACCO_HOMOLOGACAO==='1';
const config=preview?connectionConfig(import.meta.env):{
 url:'https://mdevzehqcpcgxspwbiyz.supabase.co',key:'sb_publishable_JLIp1y5II26GrztrKDNIyQ_ryETrCuj'
};
const client=(preview||location.hostname===adminHost)&&config.url&&config.key?createClient(config.url,config.key):null;
const storefrontOrigin=preview?(import.meta.env.VITE_PITACCO_HOMOLOG_SITE_ORIGIN||''):'https://pitacco.com.br';
const pages=[['Painel geral',LayoutDashboard],['Estabelecimentos',Store],['Módulos do lojista',Package],['Assinaturas',CreditCard],['Homologação',ClipboardCheck],['Atualizações',Settings]];

function AdminApp(){
 const [session,setSession]=useState(undefined),[verified,setVerified]=useState(null);
 const [stores,setStores]=useState([]),[storeId,setStoreId]=useState(''),[page,setPage]=useState('Painel geral');
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
   client.rpc('is_admin').then(({data,error})=>{
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
   const {error}=await client.auth.signInWithPassword({email:String(form.get('email')).trim(),password:String(form.get('password'))});
   if(error)throw error;
  }catch(failure){setError(failure.message||'Não foi possível entrar.');}
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
   <label htmlFor="owner-email">E-mail</label><input id="owner-email" name="email" type="email" autoComplete="username" required/>
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
 const store=stores.find(item=>item.id===storeId);
 return <div className="app pitacco-admin-shell pitacco-theme-light">
  <aside>
   <div className="brand pitacco-platform-brand"><img src="/pitacco-brand-013.svg" alt="Pitacco"/><strong>Pitacco Admin</strong></div>
   <nav aria-label="Administração geral">{pages.map(([name,Icon])=><button key={name} type="button" className={page===name?'active':''}
    onClick={()=>setPage(name)}><Icon size={18}/>{name}</button>)}</nav>
   <button type="button" className="logout" onClick={signOut}><LogOut size={16}/> Sair</button>
  </aside>
  <main className="pitacco-workspace pitacco-workspace--admin">
   <header><h2>{page}</h2></header>
   {error&&<p role="alert">{error}</p>}
   {page==='Painel geral'&&<BillingOverview client={client}/>}
   {page==='Assinaturas'&&<BillingOverview client={client}/>}
   {page==='Módulos do lojista'&&<OwnerFeatures client={client} stores={stores}/>}
   {page==='Atualizações'&&<section className="panel"><h3>Atualizações do Windows</h3><a href="https://github.com/juniorclerio37-creator/pitacco/releases" target="_blank" rel="noopener noreferrer">Consultar versões publicadas</a></section>}
   {page==='Homologação'&&<Homologation client={client} stores={stores} storefrontOrigin={storefrontOrigin}/>}
   {page==='Estabelecimentos'&&<section className="panel" aria-label="Configuração do estabelecimento">
    <label htmlFor="owner-store">Estabelecimento</label>
    <select id="owner-store" value={storeId} onChange={event=>setStoreId(event.target.value)}>
     {!stores.length&&<option value="">Nenhuma loja cadastrada</option>}
     {stores.map(item=><option key={item.id} value={item.id}>{item.name}</option>)}
    </select>
    {store&&<>
     <nav className="pitacco-local-tabs" aria-label="Seções do estabelecimento">
      {['Identidade','Catálogo','Checkout','Agendamento'].map(tab=><button key={tab} type="button" aria-pressed={storeTab===tab}
       className={storeTab===tab?'active':'secondary'} onClick={()=>setStoreTab(tab)}>{tab}</button>)}
     </nav>
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
