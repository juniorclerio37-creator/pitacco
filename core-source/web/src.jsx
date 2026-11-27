import installedPackage from './package.json';
import ControlMerchantMessages from './ControlMerchantMessages.jsx';
import {ModernIntegrations,ModernFinance,ModernCustomers} from './MerchantModern.jsx';
import {MerchantNavigation,MerchantMobileBar} from './MerchantNavigation.jsx';
import {menuRouteIds,resolveMenuRoute,fallbackMenuItems,menuAllowed} from './merchantNavigation.mjs';
import NavigationFleetTracking from './FleetTracking.jsx';
import IncidentCenter from './IncidentCenter.jsx';
import {windowsStore,saveWindowsStore} from './orderArrival.mjs';
import IfoodConnections from './IfoodConnections.jsx';
import WorkspaceBoundary from './WorkspaceBoundary.jsx';
import AppDownloads from './AppDownloads.jsx';
import {useStoreManagerAccess} from './storeAccess.mjs';
import {featureForTab,useStoreFeatures} from './storeFeatures.mjs';
import CourierWorkspace from './CourierWorkspace.jsx';
import CourierRates from './CourierRates.jsx';
import CourierFinance from './CourierFinance.jsx';
import BillingStatus from './BillingStatus.jsx';
import OperationalAlerts from './OperationalAlerts.jsx';
import {Bell} from 'lucide-react';
import ScheduleSettings from './ScheduleSettings.jsx';
import FinancialReport from './FinancialReport.jsx';
import Inventory from './Inventory.jsx';
import LogisticsHub from './LogisticsHub.jsx';
import SetupConnection from './SetupConnection.jsx';
import {connectionConfig} from './config.mjs';
import Operations from './Operations.jsx';
import MenuStudio from './MenuStudio.jsx';
import StoreProfile from './StoreProfile.jsx';
import StoreDesignStudio from './StoreDesignStudio.jsx';
import StoreOpeningHours from './StoreOpeningHours.jsx';
import StoreLaunchWizard,{OnboardingNudge} from './StoreLaunchWizard.jsx';
import {ListChecks as LaunchChecksIcon} from 'lucide-react';
import {StoreHelp} from './StoreReadiness.jsx';
import {LifeBuoy} from 'lucide-react';
import {StorefrontShare, StorefrontPayments, StoreDeliveryArea, useStorefrontMenu} from './StorefrontSettings.jsx';
import './storefront.css';
import WhatsAppSettings from './WhatsAppSettings.jsx';
import CashDesk from './CashDesk.jsx';
import FiadoCaderneta from './FiadoCaderneta.jsx';
import {nativeAvailable} from './printBridge.mjs';
import {optimizeRoadTrip,fetchOsrmMatrix} from './roadOptimizer.mjs';
import {suggestTrip} from './routeEngine.mjs';
import React,{useEffect,useState} from 'react';
import{createRoot}from'react-dom/client';
import{createClient}from '@supabase/supabase-js';
import{LayoutDashboard,Store,ShoppingBag,Package,Wallet,Plus,Users,CreditCard,LogOut,Bike,MapPin,Truck,Settings,Plug,Printer,Menu}from'lucide-react';
import './style.css';
import './merchant-reference.css';
import StoreOverview from './StoreOverview.jsx';
import JSZip from 'jszip';
import Papa from 'papaparse';
import UniversalMenuImporter from './UniversalMenuImporter.jsx';
let storage;try{storage=window.localStorage}catch{}
const detectedConfig=connectionConfig(import.meta.env,storage);
const isHostedPitacco=typeof window!=='undefined' && !nativeAvailable() && ['app.pitacco.com.br','pitacco.com.br','www.pitacco.com.br'].includes(window.location.hostname.toLowerCase());
const useOfficial=isHostedPitacco||(nativeAvailable()&&!detectedConfig.url);
let {url,key}=detectedConfig;
if(import.meta.env.VITE_PITACCO_HOMOLOGACAO!=='1'&&useOfficial){
 url='https://mdevzehqcpcgxspwbiyz.supabase.co';
 key='sb_publishable_JLIp1y5II26GrztrKDNIyQ_ryETrCuj';
}
const supabase=url&&key?createClient(url,key):null;
const money=n=>Number(n||0).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
const nav=[['Visão Geral',LayoutDashboard,'Principal'],['Alertas',Bell,'Principal'],['Pedidos',ShoppingBag,'Principal'],['Motoboys',Bike,'Principal'],['Meu Cardápio',Package,'Principal'],['Estoque',Package,'Principal'],['Integrações',Plug,'Principal'],['Fideliza+',CreditCard,'Principal'],['Clientes',ShoppingBag,'Principal'],['Administrar Loja',Settings,'Principal'],['Financeiro',Wallet,'Principal'],['Fiado / Caderneta',Wallet,'Principal'],['Relatórios',Wallet,'Principal'],['Caixa',Wallet,'Principal'],['Ajuda e suporte',LifeBuoy,'Suporte'],['Primeiros passos',LaunchChecksIcon,'Configurações']];
const secondaryTabs={'Pedidos':[['Pedidos','Gestor de pedidos'],['Cozinha e expedição','Cozinha e expedição']],'Meu Cardápio':[['Produtos','Editor de cardápio'],['Importar cardápio','Importar cardápio']],'Administrar Loja':[['Minha Loja','Dados da loja'],['Aparência do cardápio','Estúdio de Cardápio'],['Horário de funcionamento','Horário de funcionamento'],['Área de entrega','Área de entrega'],['Pagamentos da loja','Pagamentos'],['WhatsApp','WhatsApp automático'],['Configurações','Impressão e aceite'],['Equipe','Usuários'],['Lojas','Estabelecimentos']],'Motoboys':[['Entregadores','Motoboys e entregas'],['Relatório de motoboys','Relatórios'],['Pagamento de motoboys','Pagamentos']],'Financeiro':[['Lançamentos','Lançamentos'],['Despesas','Despesas'],['Assinaturas','Assinatura']]};
const primaryOf=t=>t==='Caixa'?'Caixa':t==='Painel'?'Visão Geral':t==='Cozinha e expedição'?'Pedidos':['Entregadores','Relatório de motoboys','Pagamento de motoboys'].includes(t)?'Motoboys':t==='Entregas'||t==='Entrega externa'?'Pedidos':t==='Produtos'||t==='Importar cardápio'?'Meu Cardápio':['Assinaturas','Lançamentos','Despesas'].includes(t)?'Financeiro':['Minha Loja','Aparência do cardápio','Horário de funcionamento','Área de entrega','Pagamentos da loja','Agendamento','WhatsApp','Configurações','Equipe','Lojas'].includes(t)?'Administrar Loja':t;
const landing={'Caixa':'Caixa','Pedidos':'Pedidos','Visão Geral':'Painel','Motoboys':'Entregadores','Financeiro':'Lançamentos','Meu Cardápio':'Produtos','Administrar Loja':'Minha Loja'};

const merchantTabs=new Set([...menuRouteIds,'Aplicativos e Downloads',...nav.map(([name])=>name),...Object.values(landing),
 ...Object.values(secondaryTabs).flat().map(([target])=>target),
 'Agendamento','Entregas','Entrega externa','Importar cardápio','Despesas','Assinaturas',
 'Relatório de motoboys','Pagamento de motoboys']);
function readMerchantTab(){
 const saved=new URL(window.location.href).searchParams.get('aba');
 const target=menuRouteIds.includes(saved)?saved:Object.hasOwn(landing,saved)?landing[saved]:saved;
 return merchantTabs.has(target)?target:'Painel';
}
const descriptions={'Painel':'Uma visão clara dos resultados da sua loja.','Pedidos':'Receba, registre e aceite pedidos em um só lugar.','Entregas':'Organize os pedidos que vão sair para entrega.','Lojas':'Cadastre e escolha os estabelecimentos da sua operação.','Produtos':'Organize seus produtos, preços e custos.','Fiado / Caderneta':'Autorize clientes, controle limites e receba compras no fiado.','Lançamentos':'Registre valores históricos para acompanhar os resultados.','Despesas':'Acompanhe os custos registrados da loja.','Configurações':'Impressoras, alertas e preferências do aplicativo.','Integrações':'Canais de venda e serviços conectados à sua loja.'};

function RouteAdvisor({deliveries,maxOrders}){
 const [lat,setLat]=useState(''),[lng,setLng]=useState(''),[result,setResult]=useState(null),[busy,setBusy]=useState(false);
 const eligible=deliveries.filter(d=>d.status==='pendente'&&d.logistics_provider!=='marketplace');
 async function analyze(){setBusy(true);try{
  const origin={lat:Number(lat),lng:Number(lng)};
  if(!lat.trim()||!lng.trim()||Math.abs(origin.lat)>90||Math.abs(origin.lng)>180)throw Error('Informe coordenadas válidas da saída.');
  const geocoded=eligible.filter(d=>d.latitude!=null&&d.longitude!=null).slice(0,14).map(d=>({...d,lat:Number(d.latitude),lng:Number(d.longitude)}));
  if(!geocoded.length)throw Error('Cadastre coordenadas dos destinos para calcular rotas.');
  const matrix=await fetchOsrmMatrix({origin,orders:geocoded});
  setResult(optimizeRoadTrip({orders:geocoded,matrix,maxOrders}));
 }catch(e){setResult({error:e.message})}finally{setBusy(false)}}
 return <div className="panel"><h3>Rotas viárias (modo de teste)</h3><p>Consulta trajetos de carro por ruas e sentidos de circulação. Não realiza despacho nem contratação automática. O serviço público de demonstração não deve ser usado com dados reais de clientes.</p><div className="dispatch-actions"><input aria-label="Latitude de saída" value={lat} onChange={e=>setLat(e.target.value)} placeholder="Latitude de saída"/><input aria-label="Longitude de saída" value={lng} onChange={e=>setLng(e.target.value)} placeholder="Longitude de saída"/><button type="button" disabled={busy} onClick={analyze}>{busy?'Calculando...':'Calcular rota de teste'}</button></div>{result&&(result.error?<p role="alert">{result.error}</p>:<><p><b>{result.selected.length} pedido(s) sugerido(s)</b> · {Math.ceil(result.durationSeconds/60)} minutos estimados, sem trânsito</p>{result.selected.map((d,i)=><p key={d.id}>{i+1}. {d.customer_name} — {d.address}</p>)}{result.excluded.map(e=><p key={e.id}>Não incluído: {String(e.id).slice(0,8)} — {e.reason}</p>)}<p className="hint">{result.warning}</p></>)}<p className="hint">Para produção: provedor de rotas contratado, geocodificação, prazos, restrições de retirada e confirmação transacional antes do despacho.</p></div>
}

function CustomersFromOrders({orders=[],storeId,blockedOnly=false}){
 const [query,setQuery]=useState('');
 const [selectedCustomer,setSelectedCustomer]=useState(null);
 const [blocks,setBlocks]=useState({});
 const [blockError,setBlockError]=useState('');
 const [blockBusy,setBlockBusy]=useState(false);
 useEffect(()=>{
  let live=true;
  setBlocks({});setSelectedCustomer(null);setBlockError('');
  if(!storeId)return;
  supabase.from('pitacco_customer_blocks').select('id,match_value').eq('store_id',storeId).eq('match_type','phone').eq('active',true).then(({data,error})=>{
   if(!live)return;
   if(error){setBlockError('Não foi possível carregar os bloqueios desta loja.');return;}
   setBlocks(Object.fromEntries((data||[]).map(x=>[x.match_value,x.id])));
  });
  return()=>{live=false};
 },[storeId]);
 async function toggleBlock(c){
  if(!/^\d{10,13}$/.test(c.phone)){setBlockError('Informe um telefone válido com DDD para bloquear este cliente.');return;}
  setBlockBusy(true);setBlockError('');
  const blocked=!!blocks[c.phone];
  const result=blocked
   ?await supabase.rpc('pitacco_release_customer_block',{p_id:blocks[c.phone]})
   :await supabase.rpc('pitacco_manage_customer_block',{p_store:storeId,p_type:'phone',p_value:c.phone,p_reason:''});
  if(result.error){setBlockError(result.error.message||'Não foi possível atualizar o bloqueio.');}
  else setBlocks(old=>({...old,[c.phone]:blocked?null:result.data}));
  setBlockBusy(false);
 }

 const customers=new Map();
 for(const order of orders){
  if(!storeId||order.store_id!==storeId)continue;
  const name=String(order.receipt?.customer||order.customer_name||'').trim();
  if(!name)continue;
  const phone=String(order.receipt?.customer_phone||order.receipt?.phone||order.customer_phone||'').replace(/\D/g,'');
  // Without a phone, names alone are not reliable unique customer identifiers.
  const key=phone?'phone:'+phone:'order:'+String(order.id);
  const row=customers.get(key)||{name,phone,count:0,total:0,last:''};
  row.count+=1;
  const amount=Number(order.gross);
  if(Number.isFinite(amount))row.total+=amount;
  const when=String(order.created_at||'');
  if(when>row.last)row.last=when;
  customers.set(key,row);
 }
 if(blockedOnly)for(const phone of Object.keys(blocks)){if(blocks[phone]&&!customers.has('phone:'+phone))customers.set('phone:'+phone,{name:'Telefone bloqueado',phone,count:0,total:0,last:''})}
 const list=[...customers.values()].filter(c=>!blockedOnly||!!blocks[c.phone]).sort((a,b)=>b.last.localeCompare(a.last)).filter(c=>(c.name+' '+c.phone).toLocaleLowerCase('pt-BR').includes(query.toLocaleLowerCase('pt-BR')));
 return <section className="panel"><h3>{blockedOnly?'Clientes bloqueados':'Clientes e histórico de pedidos'}</h3><p>Histórico dos pedidos desta loja. Clientes sem telefone ficam separados por pedido; o bloqueio exige identificação confiável e configuração do servidor.</p><div className="quick-actions"><input aria-label="Buscar cliente" placeholder="Buscar nome ou telefone" value={query} onChange={e=>setQuery(e.target.value)}/><strong>{list.length} cliente(s)</strong></div><div style={{overflowX:'auto'}}><table style={{width:'100%',textAlign:'left',borderCollapse:'collapse'}}><thead><tr><th>Cliente</th><th>Telefone</th><th>Pedidos</th><th>Total registrado</th></tr></thead><tbody>{list.map((c,i)=><tr key={c.phone||c.name+i}><td><button type="button" className="secondary" onClick={()=>{setSelectedCustomer(c);setBlockError('')}}>{c.name}</button></td><td>{c.phone||'—'}</td><td>{c.count}</td><td>{money(c.total)}</td></tr>)}</tbody></table></div>{!list.length&&<p>Nenhum cliente encontrado nos pedidos carregados.</p>}
 {!selectedCustomer&&blockError&&<p role="alert">{blockError}</p>}
 {selectedCustomer&&<div className="panel" aria-label="Detalhes do cliente"><h3>{selectedCustomer.name}</h3><p>{selectedCustomer.phone||'Telefone não informado'} · {selectedCustomer.count} pedido(s) · {money(selectedCustomer.total)}</p><p>{blocks[selectedCustomer.phone]?'Cliente bloqueado nesta loja.':'Cliente não bloqueado nesta loja.'}</p><button type="button" disabled={blockBusy||!/^\d{10,13}$/.test(selectedCustomer.phone)} onClick={()=>toggleBlock(selectedCustomer)}>{blocks[selectedCustomer.phone]?'Desbloquear':'Bloquear'}</button><button type="button" className="secondary" onClick={()=>setSelectedCustomer(null)}>Fechar</button>{blockError&&<p role="alert">{blockError}</p>}</div>}
</section>
}
function App(){
 const [navigationRoute,setNavigationRoute]=useState(()=>nativeAvailable()?'Pedidos':readMerchantTab());
 const [navigationKey,bumpNavigationKey]=useState(0);
 const [incidentCount,setIncidentCount]=useState(0);
 const [menuCollapsed,setMenuCollapsed]=useState(()=>{try{return localStorage.getItem('pitacco-menu-collapsed')==='1'}catch{return false}});
 const route=resolveMenuRoute(navigationRoute),tab=route.section==='occurrences'?'Ocorrências':route.tab;
 const setTab=React.useCallback(next=>{setNavigationRoute(next);bumpNavigationKey(n=>n+1)},[]);
 function toggleMenu(){setMenuCollapsed(old=>{try{localStorage.setItem('pitacco-menu-collapsed',old?'0':'1')}catch{}return !old})}
const [theme,setTheme]=useState(()=>{try{return window.localStorage.getItem('pitacco-theme')==='dark'?'dark':'light'}catch{return 'light'}});
useEffect(()=>{try{window.localStorage.setItem('pitacco-theme',theme)}catch{}},[theme]);
const [mobileMenuOpen,setMobileMenuOpen]=useState(false);
const[storeBrand,setStoreBrand]=useState(null),[session,setSession]=useState(null),[profile,setProfile]=useState(null),[stores,setStores]=useState([]),[selected,setSelected]=useState(''),[orders,setOrders]=useState([]),[products,setProducts]=useState([]),[expenses,setExpenses]=useState([]),[subscriptions,setSubscriptions]=useState([]),[members,setMembers]=useState([]),[message,setMessage]=useState(''),[loading,setLoading]=useState(false),[authMode,setAuthMode]=useState('login'),[deliveries,setDeliveries]=useState([]),[couriers,setCouriers]=useState([]),[myCourier,setMyCourier]=useState(null),[batchSelection,setBatchSelection]=useState([]),[batchCourier,setBatchCourier]=useState(''),[menuPreview,setMenuPreview]=useState([]),[menuFiles,setMenuFiles]=useState(null);

useEffect(()=>{if(!supabase)return;supabase.auth.getSession().then(({data})=>setSession(data.session));const{data:{subscription}}=supabase.auth.onAuthStateChange((_event,s)=>setSession(s));return()=>subscription.unsubscribe()},[]);
useEffect(()=>{if(!session){setProfile(null);setStores([]);setSelected('');return}let active=true;(async()=>{const{data,error}=await supabase.from('profiles').select('*').eq('id',session.user.id).single();if(active){setProfile(data);if(error)setMessage(error.message)}})();return()=>{active=false}},[session]);
const currentStoreScope=React.useRef({storeId:selected,userId:session?.user?.id});
currentStoreScope.current={storeId:selected,userId:session?.user?.id};
function clearStoreData(){
 setOrders([]);setProducts([]);setExpenses([]);setSubscriptions([]);setMembers([]);
 setDeliveries([]);setCouriers([]);setBatchSelection([]);setBatchCourier('');setStoreBrand(null);
}
function changeSelectedStore(next){
 if(!session?.user?.id||!stores.some(store=>store.id===next)||next===selected)return;
 currentStoreScope.current={storeId:next,userId:session.user.id};
 clearStoreData();setMessage('');setIncidentCount(0);
 if(nativeAvailable()){saveWindowsStore(storage,session.user.id,next);setTab('Pedidos')}
 setSelected(next);
}
async function loadStores(){
 if(!session?.user?.id)return;
 const userId=session.user.id;
 const {data,error}=await supabase.rpc('pitacco_my_merchant_stores');
 if(currentStoreScope.current.userId!==userId)return;
 if(error)throw error;
 const rows=Array.isArray(data)?data:[];
 const old=currentStoreScope.current.storeId;
 const next=nativeAvailable()?windowsStore(storage,userId,rows,old):rows.some(store=>store.id===old)?old:rows[0]?.id||'';
 setStores(rows);
 if(old!==next){currentStoreScope.current={storeId:next,userId};clearStoreData();setIncidentCount(0);setSelected(next)}
 if(nativeAvailable()&&next)saveWindowsStore(storage,userId,next);
}
useEffect(()=>{if(profile&&session?.user?.id===profile.id){loadStores().catch(e=>{if(currentStoreScope.current.userId===session.user.id)setMessage(e.message||String(e))});loadCourier()}},[profile,session?.user?.id]);
async function loadCourier(){const {data}=await supabase.from('couriers').select('*').eq('user_id',session.user.id).maybeSingle();setMyCourier(data||null)}
async function loadDeliveries(){if(!session||(!selected&&profile?.role!=='entregador'))return;
const userId=session.user.id;const storeId=selected;
let deliveryQuery=supabase.from('deliveries').select('*'),courierQuery=supabase.from('couriers').select('*');
if(profile?.role!=='entregador'&&storeId){deliveryQuery=deliveryQuery.eq('store_id',storeId);courierQuery=courierQuery.eq('store_id',storeId)}
const [ds,cs]=await Promise.all([deliveryQuery.order('created_at',{ascending:false}).limit(200),courierQuery.order('name')]);
if(currentStoreScope.current.storeId!==storeId||currentStoreScope.current.userId!==userId)return;if(ds.error)setMessage(ds.error.message);else setDeliveries(ds.data||[]);if(cs.error)setMessage(cs.error.message);else setCouriers(cs.data||[])}
useEffect(()=>{if(session&&profile)loadDeliveries()},[session,profile,selected]);
async function assignBatch(){if(batchSelection.length<2||!batchCourier||batchSelection.length>(active?.max_orders_per_trip||1)){setMessage('Selecione pelo menos duas entregas e um entregador.');return}await logisticsRpc('assign_delivery_batch',{s:selected,courier:batchCourier,delivery_ids:batchSelection});setBatchSelection([]);setBatchCourier('')}
useEffect(()=>{setBatchSelection([]);setBatchCourier('')},[selected]);
async function logisticsRpc(fn,args){setLoading(true);const {error}=await supabase.rpc(fn,args);setLoading(false);setMessage(error?.message||'Operação concluída');if(!error){loadDeliveries();loadStores()}}

async function importMenuFile(e){
 e.preventDefault(); const f=new FormData(e.currentTarget),file=f.get('file'); if(!file||!selected)return;
 try {
  let rows=[], images=new Map(); const platform=f.get('platform');
  if(file.name.toLowerCase().endsWith('.zip')){
   const zip=await JSZip.loadAsync(file); const entries=Object.values(zip.files).filter(x=>!x.dir&&!x.name.includes('..'));
   const menu=entries.find(x=>/(^|\/)(menu|cardapio|products|produtos)\.(json|csv)$/i.test(x.name));
   if(!menu)throw Error('ZIP precisa conter menu.json, produtos.json, menu.csv ou produtos.csv');
   const raw=await menu.async('string');rows=menu.name.endsWith('.json')?JSON.parse(raw):Papa.parse(raw,{header:true,skipEmptyLines:true,delimiter:''}).data;
   for(const entry of entries.filter(x=>/\.(png|jpe?g|webp)$/i.test(x.name))){if(images.size>=500)throw Error('Máximo de 500 imagens');images.set(entry.name,entry)}
  }else{const raw=await file.text();rows=file.name.toLowerCase().endsWith('.json')?JSON.parse(raw):Papa.parse(raw,{header:true,skipEmptyLines:true,delimiter:''}).data}
  if(!Array.isArray(rows))rows=rows.items||rows.products||[];
  if(!Array.isArray(rows)||rows.length===0||rows.length>500)throw Error('Forneça de 1 a 500 produtos');
  const items=rows.map((r,i)=>({store_id:selected,source_platform:platform,external_id:String(r.id||r.external_id||i),name:String(r.name||r.nome||r.produto||'').trim(),category:String(r.category||r.categoria||''),description:String(r.description||r.descricao||''),price:Number(String(r.price??r.preco??0).replace(',','.')),image_source:String(r.image||r.imagem||r.image_url||r.foto||''),raw_data:r}));
  if(items.some(x=>!x.name||!Number.isFinite(x.price)||x.price<0))throw Error('Produto sem nome ou com preço inválido');
  setMenuPreview(items);setMenuFiles(images);setMessage(`${items.length} produtos prontos para revisão. Fotos: ${images.size} arquivo(s) no ZIP. Nenhum produto foi publicado.`);
 }catch(err){setMessage(err.message)}
}
async function saveMenuPreview(){
 if(!menuPreview.length)return;setLoading(true);
 try{
  const rows=[];
  for(const item of menuPreview){let image_path=null;
   if(menuFiles?.size&&item.image_source){const name=item.image_source.replace(/^\.?\//,'');const entry=menuFiles.get(name)||[...menuFiles.entries()].find(([k])=>k.split('/').pop()===name.split('/').pop())?.[1];
    if(entry){const ext=entry.name.split('.').pop().toLowerCase();const bytes=await entry.async('uint8array');if(bytes.length>5*1024*1024)throw Error('Imagem maior que 5 MB: '+entry.name);
     const path=`${selected}/${crypto.randomUUID()}.${ext}`;const type=ext==='png'?'image/png':ext==='webp'?'image/webp':'image/jpeg';
     const {error}=await supabase.storage.from('menu-import-images').upload(path,bytes,{contentType:type,upsert:false});if(error)throw error;image_path=path;
    }
   }
   rows.push({...item,image_path});
  }
  const {error}=await supabase.from('menu_import_staging').insert(rows);if(error)throw error;
  setMenuPreview([]);setMenuFiles(null);setMessage(`${rows.length} itens e imagens associadas salvos para revisão. Nenhum produto publicado.`);
 }catch(err){setMessage('Falha ao salvar: '+err.message)}finally{setLoading(false)}
}
async function requestExternalDelivery(e){e.preventDefault();const f=new FormData(e.currentTarget);setLoading(true);const {error}=await supabase.from('external_delivery_requests').insert({store_id:selected,provider:f.get('provider'),customer_name:f.get('customer'),destination:f.get('destination'),reference:f.get('reference'),status:'rascunho'});setLoading(false);setMessage(error?.message||'Solicitação salva como rascunho. Nenhuma entrega foi contratada.');if(!error)e.currentTarget.reset()}
async function loadDetails(){if(!selected||!session?.user?.id)return;const userId=session.user.id;const storeId=selected;const tables=['orders','products','expenses','subscriptions','store_members'];const result=await Promise.all(tables.map(t=>supabase.from(t).select('*').eq('store_id',selected).order(t==='subscriptions'?'updated_at':t==='store_members'?'user_id':'created_at',{ascending:false})));if(currentStoreScope.current.storeId!==storeId||currentStoreScope.current.userId!==userId)return;const err=result.find(r=>r.error);if(err){setMessage(err.error.message);return}setOrders(result[0].data||[]);setProducts(result[1].data||[]);setExpenses(result[2].data||[]);setSubscriptions(result[3].data||[]);setMembers(result[4].data||[])}
useEffect(()=>{if(!selected)return;loadDetails().catch(e=>{if(currentStoreScope.current.storeId===selected&&currentStoreScope.current.userId===session?.user?.id)setMessage(e.message||String(e))})},[selected,session?.user?.id]);
async function submitAuth(event) {
 event.preventDefault();
 setLoading(true);
 setMessage('');
 const form = new FormData(event.currentTarget);
 const email = String(form.get('email')).trim(), password = String(form.get('password'));
 const registering = authMode === 'register';
 try {
  const {data, error} = registering
   ? await supabase.auth.signUp({email, password, options:{data:{full_name:form.get('name')}}})
   : await supabase.auth.signInWithPassword({email, password});
  if (error) throw error;
  if (registering && !data.session) {
   setAuthMode('login');
   setMessage('Se este e-mail já estiver cadastrado, entre com sua senha. Se acabou de criar a conta, confirme o cadastro pelo link enviado ao seu e-mail.');
  } else {
   setMessage(registering ? 'Cadastro concluído.' : 'Login realizado.');
  }
 } catch (error) {
  setMessage(error.message || 'Não foi possível concluir o acesso. Tente novamente.');
 } finally {
  setLoading(false);
 }
}
async function execute(table,payload,after){setLoading(true);setMessage('');const{error}=await supabase.from(table).insert(payload);setLoading(false);if(error)setMessage(error.message);else{setMessage('Registro salvo.');after?.()}}
async function handleForm(e,table,convert){e.preventDefault();if(!selected&&table!=='stores')return;const form=e.currentTarget;const f=new FormData(form);const payload=convert(f);await execute(table,payload,()=>{form.reset();if(table==='stores')loadStores();else loadDetails()})}
async function addMember(e){e.preventDefault();const form=e.currentTarget,f=new FormData(form);setLoading(true);const{error}=await supabase.rpc('add_store_member',{s:selected,member_email:f.get('email'),member_role:f.get('role')});setLoading(false);setMessage(error?.message||'Acesso concedido.');if(!error){form.reset();loadDetails()}}
async function saveSubscription(e){e.preventDefault();const f=new FormData(e.currentTarget);setLoading(true);const{error}=await supabase.from('subscriptions').upsert({store_id:selected,monthly_amount:Number(f.get('amount')),status:f.get('status'),due_date:f.get('due')||null,updated_at:new Date().toISOString()});setLoading(false);setMessage(error?.message||'Assinatura atualizada.');if(!error)loadDetails()}
useEffect(()=>{if(!session||!selected){setStoreBrand(null);return}let live=true;setStoreBrand(null);
 async function refreshIdentity(){try{const {data,error}=await supabase.rpc('pitacco_store_identity',{p_store:selected});if(!live||error||data?.store_id!==selected)return;
 const {data:canonical,error:storeError}=await supabase.from('stores').select('*').eq('id',selected).single();
 if(!live)return;
 if(!storeError&&canonical?.id===selected)setStores(current=>current.map(row=>row.id===selected?canonical:row));
 const path=data.logo_path;const prefix='stores/'+selected+'/';const url=typeof path==='string'&&path.startsWith(prefix)&&/^[a-z0-9_-]+\.(png|jpe?g|webp)$/i.test(path.slice(prefix.length))?supabase.storage.from('pitacco-media').getPublicUrl(path).data.publicUrl:data.legacy_logo_url||'';setStoreBrand({...data,logo_url:url});}catch{}}
 refreshIdentity();const timer=setInterval(refreshIdentity,15000);window.addEventListener('focus',refreshIdentity);window.addEventListener('pitacco:store-identity',refreshIdentity);
 return()=>{live=false;clearInterval(timer);window.removeEventListener('focus',refreshIdentity);window.removeEventListener('pitacco:store-identity',refreshIdentity)}
},[session,selected]);
const modules=useStoreFeatures(supabase,nativeAvailable()?null:selected,session?.user?.id);
const featureSettings=modules.features;
const storeAccess=useStoreManagerAccess(supabase,session?.user?.id,selected);
const storefront=useStorefrontMenu(supabase, selected, profile?.role==='entregador'?null:session?.user?.id, !nativeAvailable()&&storeAccess.manager);
const allowed=name=>{
 const feature=featureForTab(name);
 return nativeAvailable()||!feature||featureSettings?.[feature]===true;
};
useEffect(()=>{
 if(nativeAvailable())return;
 const location=new URL(window.location.href);
 if(navigationRoute==='Painel')location.searchParams.delete('aba');
 else if(merchantTabs.has(navigationRoute))location.searchParams.set('aba',navigationRoute);
 if(location.href!==window.location.href)window.history.replaceState(window.history.state,'',location.href);
},[navigationRoute]);
useEffect(()=>{if(featureSettings&&(!allowed(route.tab)||(route.feature&&featureSettings[route.feature]===false)))setTab('Painel')},[tab,navigationRoute,featureSettings]);
if(!supabase)return <SetupConnection/>;
if(!session)return <div className="setup"><img className="auth-logo" src="/pitacco-brand-013.svg" alt="Pitacco"/><h2>{authMode==='login'?'Entrar na plataforma':'Criar conta'}</h2><form onSubmit={submitAuth}>{authMode==='register'&&<input name="name" placeholder="Seu nome" required/>}<input type="email" name="email" placeholder="E-mail" required/><input type="password" name="password" placeholder="Senha (mínimo 6 caracteres)" minLength="6" required/><button disabled={loading}>{authMode==='login'?'Entrar':'Cadastrar'}</button></form><p>{message}</p><button className="linkbutton" onClick={()=>{setAuthMode(authMode==='login'?'register':'login');setMessage('')}}>{authMode==='login'?'Criar uma conta':'Já tenho uma conta'}</button></div>;

const primary=primaryOf(tab);
const isDriver=profile?.role==='entregador';const admin=false,manager=storeAccess.manager,active=stores.find(s=>s.id===selected),gross=orders.filter(order=>!['cancelled','rejected'].includes(order.status)).reduce((a,o)=>a+Number(o.gross),0),fees=orders.filter(order=>!['cancelled','rejected'].includes(order.status)).reduce((a,o)=>a+Number(o.fees),0),totalExpenses=expenses.reduce((a,o)=>a+Number(o.amount),0),sub=subscriptions[0];
return <div className={"app pitacco-theme-"+theme+(nativeAvailable()?"":" pitacco-mobile-workspace store-reference-layout")+(menuCollapsed?" mn-sidebar-collapsed":"")+(!isDriver&&["Integrações","Pagamentos da loja","Lançamentos","Clientes","Relatórios","Ocorrências"].includes(tab)?" modern-merchant":"")}>
{!nativeAvailable()&&<>
<header className={"pitacco-mobile-top"+(isDriver?" mn-driver-top":" mn-redundant-top")}>
 <span><ShoppingBag size={19} aria-hidden="true"/><strong>{!isDriver&&['Integrações','Pagamentos da loja','Lançamentos','Clientes','Relatórios','Ocorrências'].includes(tab)?'Pitacco':active?.name||'Pitacco'}</strong></span>
 <button type="button" className="secondary" aria-controls="pitacco-store-navigation" aria-expanded={mobileMenuOpen} aria-label={mobileMenuOpen?'Fechar menu':'Abrir menu'} onClick={()=>setMobileMenuOpen(open=>!open)}><Menu size={21}/></button>
</header>
{mobileMenuOpen&&<button type="button" className="pitacco-mobile-backdrop" aria-label="Fechar navegação" onClick={()=>setMobileMenuOpen(false)}/>}
</>}
<aside id="pitacco-store-navigation" className={mobileMenuOpen?'pitacco-mobile-drawer-open':''} onKeyDown={event=>{if(event.key==='Escape')setMobileMenuOpen(false)}}>{!nativeAvailable()&&<div className="store-sidebar-brand" aria-label="Pitacco">
  <span><img src="/pitacco-brand-013.svg" alt=""/></span><strong>Pitacco</strong>
</div>}<div className="brand store-identity">{storeBrand?.logo_url&&/^https:\/\//.test(storeBrand.logo_url)?<img src={storeBrand.logo_url} alt={"Logo de "+(active?.name||"loja")}/>:<span className="store-identity-placeholder" aria-hidden="true"><Store size={24}/></span>}<span className="store-identity-copy"><strong>{active?.name||"Seu estabelecimento"}</strong><small>Gestão de pedidos e vendas</small></span></div><MerchantNavigation client={supabase} storeLogoUrl={storeBrand?.store_id===selected?storeBrand.logo_url:(active?.logo_path&&active.logo_path.startsWith('stores/'+selected+'/')?supabase.storage.from('pitacco-media').getPublicUrl(active.logo_path).data.publicUrl:'')} routeId={navigationRoute} onNavigate={target=>{setTab(target);setMessage('');setMobileMenuOpen(false)}} allowed={allowed} manager={manager} active={active} admin={admin} driver={isDriver} featureSettings={featureSettings} stores={stores} selected={selected} onStoreChange={changeSelectedStore} userId={session.user.id} theme={theme} onThemeChange={setTheme} email={profile?.email||session.user.email} role={profile?.role} version={nativeAvailable()?'Pitacco Windows v'+installedPackage.version:''} native={nativeAvailable()} onLogout={()=>supabase.auth.signOut()} incidentCount={incidentCount} extra={fallbackMenuItems(nav,secondaryTabs,landing)} collapsed={menuCollapsed} onCollapse={toggleMenu}/><div className="theme-switch"><span>Aparência</span><div role="group" aria-label="Modo de aparência"><button type="button" aria-pressed={theme==="light"} className={theme==="light"?"selected":""} onClick={()=>setTheme("light")}>☀ Claro</button><button type="button" aria-pressed={theme==="dark"} className={theme==="dark"?"selected":""} onClick={()=>setTheme("dark")}>☾ Escuro</button></div></div><small className="account">{profile?.email} · {profile?.role||'carregando'}{nativeAvailable()&&<><span className="pitacco-version">Pitacco Windows v0.12.35</span></>}</small><button className="logout" onClick={()=>supabase.auth.signOut()}><LogOut size={16}/> Sair</button></aside><main className={'pitacco-workspace pitacco-workspace--'+(tab==='Painel'?'overview':tab==='Pedidos'||tab==='Cozinha e expedição'?'orders':['Entregadores','Relatório de motoboys','Pagamento de motoboys'].includes(tab)?'couriers':tab==='Configurações'?'settings':'other')}><header><div><span className="eyebrow">{nativeAvailable()&&storeBrand?.logo_url&&/^https:\/\//.test(storeBrand.logo_url)?<img src={storeBrand.logo_url} alt="" style={{width:34,height:34,objectFit:'cover',borderRadius:8,verticalAlign:'middle',marginRight:9}}/>:null}{active?.name||"Seu espaço de gestão"}</span><h2>{tab==='Ocorrências'?'Central de Ocorrências':(!nativeAvailable()&&tab==='Configurações'?'Impressão e aceite':!nativeAvailable()&&primary==='Motoboys'?'Motoboys e Entregas':primary)}</h2><p>{descriptions[tab]||"Gerencie sua operação com tudo no lugar."}</p></div><select className="store-header-select" aria-label="Selecionar loja" value={selected} onChange={e=>changeSelectedStore(e.target.value)}>
{!selected&&<option value="" disabled>{stores.length?'Selecione a loja deste computador':'Nenhuma loja vinculada'}</option>}{stores.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}</select></header>{active&&!isDriver&&manager&&allowed('Entregas')&&<IncidentCenter key={selected} client={supabase} storeId={selected} visible={route.section==='occurrences'} showShortcut={tab==='Entregas'||tab==='Ocorrências'} onCount={setIncidentCount} onOpen={()=>{setTab(route.section==='occurrences'?'Entregas':'Ocorrências');window.scrollTo(0,0);document.querySelector('.app>main')?.scrollTo(0,0)}} orders={orders} deliveries={deliveries}/>}
{active&&!isDriver&&navigationRoute==='Painel'&&<StorefrontShare key={selected} menu={storefront.menu} native={nativeAvailable()}/>}
{active&&!isDriver&&manager&&<ControlMerchantMessages key={'control-messages:'+selected} client={supabase} storeId={selected}/>}{message&&<div className="notice" role="status">{message}</div>}{!active&&tab!=='Lojas'&&tab!=='Entregas'?<div className="panel">Nenhuma loja disponível para sua conta. {admin?'Cadastre uma loja na aba Lojas.':'Solicite ao gestor que vincule seu e-mail a uma loja.'}</div>:null}

{storeAccess.status==='loading'&&<div className="panel" role="status">Verificando acesso à loja…</div>}
{storeAccess.status==='error'&&<div className="panel"><p role="alert">Não foi possível verificar o acesso à loja.</p><button type="button" onClick={storeAccess.retry}>Tentar novamente</button></div>}
{storeAccess.status==='ready'&&!nativeAvailable()&&active&&featureForTab(tab)&&modules.status==='loading'&&
 <div className="panel" role="status">Carregando acesso às funções da loja…</div>}
{storeAccess.status==='ready'&&!nativeAvailable()&&active&&featureForTab(tab)&&modules.status==='error'&&
 <div className="panel"><p role="alert">Não foi possível carregar as funções da loja.</p><button type="button" onClick={modules.retry}>Tentar novamente</button></div>}
{storeAccess.status==='ready'&&allowed(tab)&&<WorkspaceBoundary resetKey={selected+'|'+tab} onOverview={()=>setTab('Painel')}>
{active&&!isDriver&&tab==='Aplicativos e Downloads'&&<AppDownloads client={supabase}/>}

{active&&!isDriver&&tab==='Alertas'&&(manager?<OperationalAlerts key={selected} client={supabase} storeId={selected} onNavigate={setTab}/>:<p>Peça acesso a um gestor da loja para consultar os alertas.</p>)}
{active&&!isDriver&&tab==='Relatórios'&&(manager?<FinancialReport sidebarOnly={nativeAvailable()} key={selected} client={supabase} store={active} initialView={route.section||'report'} navigationKey={navigationKey}/>:<p>Solicite acesso ao gestor da loja para abrir os relatórios.</p>)}
{active&&!isDriver&&tab==='Estoque'&&<Inventory key={selected} client={supabase} storeId={selected} manager={manager} products={products}/>}
{active&&!isDriver&&manager&&tab==='Clientes'&&<ModernCustomers key={selected+':'+navigationRoute} client={supabase} storeId={selected} blockedOnly={route.section==='bloqueados'}/> }
{active&&!isDriver&&!manager&&tab==='Clientes'&&<section className="panel"><p>O histórico de clientes está disponível somente para gestores autorizados.</p></section>}
{active&&!isDriver&&tab==='Caixa'&&<CashDesk client={supabase} storeId={selected} manager={manager}/>}
{active&&!isDriver&&manager&&tab==='Mapa de entregadores'&&<NavigationFleetTracking key={selected} client={supabase} storeId={selected} onBack={()=>setTab('Entregas')}/>}
{active&&!isDriver&&manager&&tab==='Fiado / Caderneta'&&<FiadoCaderneta sidebarOnly={nativeAvailable()} key={selected} client={supabase} storeId={selected} onNavigate={setTab} initialTab={route.section||'clientes'} navigationKey={navigationKey}/>}
{active&&!isDriver&&<WorkspaceBoundary resetKey={selected+'|'+tab}
 hiddenOnError={false}
 onOverview={()=>setTab('Painel')}>
 <Operations navigationSection={route.section} navigationKey={navigationKey} key={selected} client={supabase} storeId={selected} storeName={active?.name||''} storeLogoPath={(storeBrand?.store_id===selected&&storeBrand.logo_path)||active?.logo_path||''} manager={manager} view={tab} onNavigate={setTab}/>
</WorkspaceBoundary>}
{tab==='Painel'&&active&&!nativeAvailable()&&manager&&
 <OnboardingNudge client={supabase} storeId={selected} onNavigate={setTab}/>}
{tab==='Painel'&&active&&!nativeAvailable()&&<StoreOverview key={selected} store={active}
 orders={orders} expenses={expenses} deliveries={deliveries} allowed={allowed} navigate={setTab}
 refresh={()=>Promise.all([loadDetails(),loadDeliveries()])}/>}
{tab==='Painel'&&active&&nativeAvailable()&&<div className="approved-dashboard"><div className="approved-hero"><div><h3>Olá! 👋</h3><p>Acompanhe o movimento da sua loja e acesse as principais funções.</p></div><div className="approved-actions"><button onClick={()=>setTab('Pedidos')}><Plus size={18}/> Nova venda</button><button className="secondary" onClick={()=>setTab('Pedidos')}><ShoppingBag size={18}/> Ver pedidos</button>{allowed('Produtos')&&<button className="secondary" onClick={()=>setTab('Produtos')}><Package size={18}/> Cardápio</button>}</div></div><section className="metrics"><article><span>Pedidos registrados</span><strong>{orders.length}</strong></article><article><span>Faturamento bruto</span><strong>{money(gross)}</strong></article><article><span>Entregas registradas</span><strong>{deliveries.length}</strong></article><article><span>Saldo estimado*</span><strong>{money(gross-fees-totalExpenses)}</strong></article></section><div className="approved-grid"><section className="panel"><div className="approved-panel-title"><h3>Últimos pedidos</h3><button className="secondary" onClick={()=>setTab('Pedidos')}>Ver todos</button></div><div className="approved-table-scroll"><table><thead><tr><th>Pedido</th><th>Canal</th><th>Valor</th><th>Data</th></tr></thead><tbody>{orders.slice(0,6).map(o=><tr key={o.id}><td>{o.receipt?.display_number||o.receipt?.order_number||'—'}</td><td>{o.channel||'Loja'}</td><td>{money(o.gross)}</td><td>{o.created_at?new Date(o.created_at).toLocaleDateString('pt-BR'):'—'}</td></tr>)}{!orders.length&&<tr><td colSpan={4}>Nenhum pedido registrado.</td></tr>}</tbody></table></div></section><section className="panel"><h3>Acessos rápidos</h3><div className="approved-shortcuts"><button onClick={()=>setTab('Pedidos')}><ShoppingBag size={19}/>Pedidos</button>{allowed('Clientes')&&<button onClick={()=>setTab('Clientes')}><Users size={19}/>Clientes</button>}{allowed('Fideliza+')&&<button onClick={()=>setTab('Fideliza+')}><CreditCard size={19}/>Fideliza+</button>}{allowed('Entregadores')&&<button onClick={()=>setTab('Entregadores')}><Bike size={19}/>Motoboys</button>}<button onClick={()=>setTab('Configurações')}><Printer size={19}/>Impressão</button>{allowed('Lançamentos')&&<button onClick={()=>setTab('Lançamentos')}><Wallet size={19}/>Financeiro</button>}</div></section><section className="panel"><h3>Resumo financeiro</h3><div className="approved-finance"><div><span>Faturamento</span><strong>{money(gross)}</strong></div><div><span>Taxas</span><strong>{money(fees)}</strong></div><div><span>Despesas</span><strong>{money(totalExpenses)}</strong></div></div><p>*Saldo estimado não é lucro líquido quando há custos não cadastrados.</p></section><section className="panel"><h3>Status da operação</h3><div className="approved-status"><button onClick={()=>setTab('Pedidos')}><ShoppingBag size={18}/>Pedidos <span>Ver pedidos ›</span></button><button onClick={()=>setTab('Configurações')}><Printer size={18}/>Impressão <span>Configurar ›</span></button><button onClick={()=>setTab('Entregadores')}><Bike size={18}/>Motoboys <span>Gerenciar ›</span></button></div></section></div></div>}
{tab==='Lojas'&&<><div className="page-intro"><div><span className="eyebrow">SEUS ESTABELECIMENTOS</span><h3>Cada loja, uma operação organizada.</h3><p>Comece pelo nome. Os canais de venda são tratados separadamente em Integrações.</p></div><Store size={42}/></div>{admin&&<div className="panel"><h3>Cadastrar loja</h3><form onSubmit={e=>handleForm(e,'stores',f=>({name:String(f.get('name')).trim(),platform:'',plan:'saas'}))}><label className="field grow">Nome do estabelecimento<input name="name" placeholder="Ex.: Açaí do Linho" maxLength={150} required/></label><button disabled={loading}><Plus size={16}/>Cadastrar loja</button></form></div>}<div className="store-grid">{stores.map(s=><article className="store-card" key={s.id}><div className="store-avatar"><Store size={24}/></div><h3>{s.name}</h3><p>{s.id===selected?'Loja selecionada':'Estabelecimento cadastrado'}</p><button className="secondary" onClick={()=>{changeSelectedStore(s.id);if(!nativeAvailable())setTab('Painel')}}>Abrir loja</button></article>)}</div>{!stores.length&&<div className="empty-state">Suas lojas aparecerão aqui após o cadastro.</div>}</>}
 {tab==='Integrações'&&active&&<ModernIntegrations key={selected} client={supabase} storeId={selected} manager={manager} menu={storefront.menu} onMenu={()=>setTab('Pagamentos da loja')}/>}
 {tab==='Lançamentos'&&active&&<ModernFinance key={selected} client={supabase} store={active} loading={loading} onSave={e=>handleForm(e,'orders',f=>({store_id:selected,gross:Number(f.get('gross')),fees:Number(f.get('fees')),channel:f.get('channel')}))} onReports={()=>setTab('Relatórios')}/>}

{tab==='WhatsApp'&&active&&<WhatsAppSettings key={selected} client={supabase} storeId={selected} storeName={active.name} manager={manager}/>}

{tab==='Agendamento'&&active&&manager&&<ScheduleSettings key={selected} client={supabase} storeId={selected}/>}
{tab==='Minha Loja'&&active&&<StoreProfile key={selected} client={supabase} store={active} manager={manager} onSaved={loadStores} storeLogoUrl={storeBrand?.store_id===selected?storeBrand.logo_url:''} onAppearance={()=>setTab('Aparência do cardápio')}/>}
{tab==='Primeiros passos'&&active&&(manager
 ?<StoreLaunchWizard key={selected} client={supabase} store={active} manager={manager}
     onNavigate={setTab} onStoreSaved={loadStores}/>
 :<section className="panel">Solicite acesso de gestor para configurar e verificar a loja.</section>)}
 {tab==='Horário de funcionamento'&&active&&(manager
 ?<StoreOpeningHours key={selected} client={supabase} store={active} manager={manager}/>
 :<section className="panel">Somente gestores podem editar o funcionamento da loja.</section>)}
 {tab==='Aparência do cardápio'&&active&&(manager
  ?<StoreDesignStudio key={selected} client={supabase} store={active} manager={manager}/>
  :<section className="panel">Somente gestores podem editar a aparência do cardápio.</section>)}
{tab==='Ajuda e suporte'&&active&&<StoreHelp key={selected} client={supabase} storeId={selected} canContact={manager}/>}
{active&&['Área de entrega','Pagamentos da loja'].includes(tab)&&(manager
 ?(tab==='Área de entrega'
  ?<StoreDeliveryArea key={selected} client={supabase} store={active}/>
  :<StorefrontPayments key={selected} client={supabase} storeId={selected} resource={storefront}/>)
 :<section className="panel"><p>Somente gestores podem editar estas configurações.</p></section>)}
{tab==='Produtos'&&active&&<MenuStudio sidebarOnly={nativeAvailable()} initialSection={route.section||'Produtos'} navigationKey={navigationKey} client={supabase} storeId={selected} products={products} store={active} manager={manager} onRefresh={loadDetails} onImport={()=>setTab('Importar cardápio')}/>}
{['Lançamentos','Despesas','Assinaturas'].includes(tab)&&active&&<div className="pitacco-local-tabs" role="group" aria-label="Seções financeiras"><button className={tab==='Lançamentos'?'active':''} onClick={()=>setTab('Lançamentos')}>Lançamentos</button><button className={tab==='Despesas'?'active':''} onClick={()=>setTab('Despesas')}>Despesas</button><button className={tab==='Assinaturas'?'active':''} onClick={()=>setTab('Assinaturas')}>Assinatura</button></div>}
{tab==='Despesas'&&active&&<><div className="panel"><h3>Nova despesa</h3><form onSubmit={e=>handleForm(e,'expenses',f=>({store_id:selected,description:f.get('description'),amount:Number(f.get('amount'))}))}><input name="description" placeholder="Descrição" required/><input name="amount" type="number" min="0" step="0.01" placeholder="Valor" required/><button disabled={loading}><Plus size={16}/>Salvar</button></form></div><div className="panel"><h3>Despesas</h3>{expenses.map(d=><div className="line" key={d.id}><b>{d.description}</b><span>{money(d.amount)}</span></div>)}</div></>}
{tab==='Equipe'&&active&&manager&&<><div className="panel"><h3>Autorizar acesso à loja</h3><p>O usuário precisa criar uma conta antes de receber acesso.</p><form onSubmit={addMember}><input name="email" type="email" placeholder="E-mail cadastrado" required/><select name="role"><option value="lojista">Lojista</option><option value="gestor">Gestor</option></select><button disabled={loading}><Plus size={16}/>Vincular</button></form></div><div className="panel"><h3>Acessos vinculados</h3>{members.map(m=><div className="line" key={m.user_id}><b>{m.user_id}</b><span>{m.role}</span></div>)}</div></>}
{tab==='Importar cardápio'&&active&&!isDriver&&
 <UniversalMenuImporter key={selected} client={supabase} storeId={selected} onCompleted={loadDetails} onOpenIntegrations={()=>setTab('Integrações')}/>}
 {tab==='Entrega externa'&&active&&<div className="panel"><h3>Solicitar entrega externa</h3><p>Crie um rascunho para um pedido próprio. Contratação e cotação automática exigem credenciais e aprovação do provedor; este formulário não chama motoboy.</p><form onSubmit={requestExternalDelivery}><select name="provider"><option value="99entrega">99 Entrega</option><option value="uber_direct">Uber Direct</option><option value="ifood_on_demand">iFood (sob demanda, se habilitado)</option></select><input name="reference" placeholder="Identificador do pedido próprio" required/><input name="customer" placeholder="Cliente" required/><input name="destination" placeholder="Endereço de destino" required/><button disabled={loading}>Salvar solicitação</button></form></div>}
{manager&&active&&tab==='Entregadores'&&<CourierWorkspace sidebarOnly={nativeAvailable()} initialTab={route.section||'Entregadores'} navigationKey={navigationKey} client={supabase} store={active} onRefresh={async()=>{await loadStores();await loadDeliveries()}}/>}
{manager&&active&&tab==='Entregas'&&<LogisticsHub key={selected+tab} client={supabase} store={active} view={tab} onRefresh={async()=>{await loadStores();await loadDeliveries()}}/>}
{tab==='Entregas'&&isDriver&&<><div className="panel"><h3>Central de entregas</h3><p>Entregadores próprios por loja ou frota compartilhada da plataforma. Cada entregador acessa apenas as entregas atribuídas a ele.</p>{active&&manager&&<><label>Modelo logístico da loja</label><select value={active.delivery_mode||'propria'} onChange={e=>logisticsRpc('set_store_delivery_mode',{s:selected,mode:e.target.value})}><option value="propria">Própria</option><option value="compartilhada">Compartilhada</option><option value="ambas">Ambas</option></select><h3>Política de distribuição</h3><p>O restaurante pode limitar cada viagem a um pedido, despachar manualmente, adicionar pedidos a uma viagem existente ou solicitar atribuição automática.</p><label>Modo de atribuição</label><select value={active.dispatch_mode||'manual'} onChange={e=>logisticsRpc('set_dispatch_policy',{s:selected,dispatch:e.target.value,max_orders:active.max_orders_per_trip||1})}><option value="manual">Manual</option><option value="automatico">Automático</option><option value="misto">Misto</option></select><label>Máximo de pedidos por viagem</label><select value={active.max_orders_per_trip||1} onChange={e=>logisticsRpc('set_dispatch_policy',{s:selected,dispatch:active.dispatch_mode||'manual',max_orders:Number(e.target.value)})}>{Array.from({length:15},(_,i)=><option value={i+1} key={i}>{i+1}</option>)}</select><button type="button" disabled={loading||active.dispatch_mode==='manual'} onClick={()=>logisticsRpc('auto_assign_delivery',{s:selected})}>Atribuir próximo pedido automaticamente</button><p className="hint">A atribuição automática inicial escolhe um entregador elegível com menor carga. Não otimiza trajetos: para pedidos adicionais, confira direção e prazo antes de anexar.</p><h3>Criar entrega da loja</h3><p>Use este formulário somente quando a entrega será feita por motoboy próprio ou frota compartilhada.</p><form onSubmit={e=>{e.preventDefault();const f=new FormData(e.currentTarget);logisticsRpc('create_delivery',{s:selected,customer:f.get('customer'),destination:f.get('address'),details:f.get('notes'),fee:Number(f.get('fee')),payment:Number(f.get('payment'))});e.currentTarget.reset()}}><input name="customer" placeholder="Nome do cliente" required/><input name="address" placeholder="Endereço de entrega" required/><input name="notes" placeholder="Referência / observações"/><input name="fee" type="number" min="0" step="0.01" placeholder="Taxa cobrada do cliente" required/><input name="payment" type="number" min="0" step="0.01" placeholder="Repasse ao entregador" required/><button disabled={loading}>Criar entrega</button></form><h3>Registrar pedido com entrega parceira (lançamento manual)</h3><p>Pedidos entregues pelo iFood, 99Food ou Keeta aparecem na central, mas não são enviados ao APK dos seus entregadores. Este cadastro não sincroniza com a plataforma.</p><form onSubmit={e=>{e.preventDefault();const f=new FormData(e.currentTarget);logisticsRpc('register_marketplace_partner_delivery',{s:selected,marketplace:f.get('marketplace'),external_ref:f.get('external_ref'),customer:f.get('customer'),destination:f.get('destination'),details:f.get('details')});e.currentTarget.reset()}}><select name="marketplace"><option value="ifood">iFood</option><option value="99food">99Food</option><option value="keeta">Keeta</option></select><input name="external_ref" placeholder="Número do pedido na plataforma" required/><input name="customer" placeholder="Cliente" required/><input name="destination" placeholder="Endereço" required/><input name="details" placeholder="Observações"/><button disabled={loading}>Registrar entrega parceira</button></form></>}</div>{manager&&active&&<RouteAdvisor deliveries={deliveries.filter(d=>d.store_id===selected)} maxOrders={active.max_orders_per_trip||1}/>}{manager&&active&&<div className="panel"><h3>Despacho de múltiplos pedidos</h3><p>Para acrescentar um pedido a uma viagem já atribuída, use o comando abaixo.</p><select id="append-delivery"><option value="">Pedido pendente</option>{deliveries.filter(d=>d.store_id===selected&&d.status==='pendente'&&d.logistics_provider!=='marketplace').map(d=><option key={d.id} value={d.id}>{d.customer_name} — {d.address}</option>)}</select><select id="append-batch"><option value="">Viagem existente</option>{[...new Map(deliveries.filter(d=>d.store_id===selected&&d.batch_id&&d.status!=='entregue'&&d.status!=='cancelada').map(d=>[d.batch_id,d])).values()].map(d=><option key={d.batch_id} value={d.batch_id}>{d.batch_id.slice(0,8)} — {couriers.find(c=>c.id===d.courier_id)?.name||'Entregador'}</option>)}</select><button disabled={loading} onClick={()=>{const d=document.getElementById('append-delivery').value,b=document.getElementById('append-batch').value;if(d&&b)logisticsRpc('append_delivery_to_batch',{s:selected,delivery_id:d,batch_id:b});else setMessage('Selecione pedido e viagem')}}>Adicionar pedido à viagem</button><p>O envio individual continua disponível na lista abaixo. Para múltiplas entregas, confira se os destinos seguem a mesma direção antes de despachar. Selecione até o limite configurado de entregas pendentes ou atribuídas, escolha um entregador e envie todas juntas. O APK poderá organizar a rota dos pedidos recebidos.</p><div className="dispatch-list">{deliveries.filter(d=>d.store_id===selected&&d.logistics_provider!=='marketplace'&&['pendente','atribuida'].includes(d.status)&&!d.batch_id).map(d=><label key={d.id} className="dispatch-option"><input type="checkbox" checked={batchSelection.includes(d.id)} onChange={e=>setBatchSelection(old=>e.target.checked?[...old,d.id]:old.filter(x=>x!==d.id))}/><span><b>{d.customer_name}</b><small>{d.address}</small></span></label>)}</div><div className="dispatch-actions"><select aria-label="Entregador do lote" value={batchCourier} onChange={e=>setBatchCourier(e.target.value)}><option value="">Selecione o entregador</option>{couriers.filter(c=>c.active&&((c.fleet_type==='propria'&&c.store_id===selected&&['propria','ambas'].includes(active.delivery_mode||'propria'))||(c.fleet_type==='compartilhada'&&admin&&['compartilhada','ambas'].includes(active.delivery_mode||'propria')))).map(c=><option value={c.id} key={c.id}>{c.name} — {c.fleet_type}</option>)}</select><button disabled={loading||batchSelection.length<2||batchSelection.length>(active.max_orders_per_trip||1)||!batchCourier} onClick={assignBatch}>Despachar {batchSelection.length} entregas</button><button type="button" onClick={()=>loadDeliveries()}>Atualizar lista</button></div><p className="hint">Despacho manual funcional. Distribuição automática, rastreamento e cálculo de rotas por trânsito ainda exigem serviços adicionais.</p></div>}
{manager&&<div className="panel"><h3>Cadastrar entregador</h3><p>O entregador deve criar uma conta primeiro. A frota compartilhada só pode ser cadastrada pelo administrador.</p><form onSubmit={e=>{e.preventDefault();const f=new FormData(e.currentTarget);logisticsRpc('register_courier',{member_email:f.get('email'),courier_name:f.get('name'),courier_phone:f.get('phone'),fleet:f.get('fleet'),target_store:f.get('fleet')==='propria'?selected:null});e.currentTarget.reset()}}><input type="email" name="email" placeholder="E-mail da conta" required/><input name="name" placeholder="Nome do entregador" required/><input name="phone" placeholder="Telefone"/><select name="fleet"><option value="propria">Entregador da loja</option>{admin&&<option value="compartilhada">Frota compartilhada</option>}</select><button disabled={loading}>Cadastrar entregador</button></form></div>}<div className="panel"><h3>Entregas {isDriver?'atribuídas a mim':active?'da loja selecionada':''}</h3>{deliveries.filter(d=>isDriver?d.courier_id===myCourier?.id:d.store_id===selected).map(d=>{const available=couriers.filter(c=>c.active&&((c.fleet_type==='propria'&&c.store_id===d.store_id&&['propria','ambas'].includes(active?.delivery_mode||'propria'))||(c.fleet_type==='compartilhada'&&admin&&['compartilhada','ambas'].includes(active?.delivery_mode||'propria'))));return <div className="delivery-item" key={d.id}><b>{d.customer_name}</b>{d.batch_id&&<span className="pill">Lote {d.batch_id.slice(0,8)}</span>}<span className="pill">{d.status}</span><span className="pill">{d.logistics_provider==='marketplace'?'Entrega parceira — sem motoboy da loja':'Entrega da loja / frota'}</span><p><MapPin size={14}/> {d.address}</p>{d.notes&&<p>{d.notes}</p>}<p>Taxa: {money(d.delivery_fee)} · Repasse: {money(d.courier_payment)}</p>{manager&&d.logistics_provider!=='marketplace'&&['pendente','atribuida'].includes(d.status)&&<><select defaultValue="" onChange={e=>e.target.value&&logisticsRpc('assign_delivery',{d:d.id,c:e.target.value})}><option value="">{d.courier_id?'Reatribuir entregador':'Atribuir entregador'}</option>{available.map(c=><option key={c.id} value={c.id}>{c.name} ({c.fleet_type})</option>)}</select><button disabled={loading} onClick={()=>logisticsRpc('set_delivery_status',{d:d.id,next_status:'cancelada'})}>Cancelar entrega</button></>}{isDriver&&d.status==='atribuida'&&<button disabled={loading} onClick={()=>logisticsRpc('set_delivery_status',{d:d.id,next_status:'aceita'})}>Aceitar</button>}{isDriver&&d.status==='aceita'&&(!d.batch_id?<button disabled={loading} onClick={()=>logisticsRpc('set_delivery_status',{d:d.id,next_status:'retirada'})}>Pedido retirado</button>:d.collected_at?<button disabled={loading} onClick={()=>logisticsRpc('depart_route',{p_route:d.batch_id})}>Saiu da loja (fecha a rota)</button>:<button disabled={loading} onClick={()=>logisticsRpc('collect_delivery',{p_delivery:d.id})}>Confirmar coleta</button>)}{isDriver&&d.status==='retirada'&&<button disabled={loading} onClick={()=>logisticsRpc('set_delivery_status',{d:d.id,next_status:'entregue'})}>Confirmar entrega</button>}</div>})}{!deliveries.filter(d=>isDriver?d.courier_id===myCourier?.id:d.store_id===selected).length&&<p>Nenhuma entrega encontrada.</p>}</div></>}
{['Relatório de motoboys','Pagamento de motoboys'].includes(tab)&&active&&manager&&<CourierFinance client={supabase} storeId={selected} view={tab}/>}
{tab==='Entregadores'&&active&&manager&&<section className="courier-unified-tools" aria-label="Relatórios e pagamentos de motoboys"><CourierFinance client={supabase} storeId={selected} view="Relatório de motoboys"/><CourierFinance client={supabase} storeId={selected} view="Pagamento de motoboys"/></section>}
{tab==='Assinaturas'&&active&&<><div className="panel"><span className="eyebrow">MINHA ASSINATURA</span><h3>Assinatura de {active.name}</h3><p>Consulte sua situação e os dados confirmados pelo sistema de cobrança.</p><BillingStatus key={selected} client={supabase} storeId={selected}/>{admin&&<form onSubmit={saveSubscription}><input name="amount" type="number" min="0" step="0.01" placeholder="Mensalidade" defaultValue={sub?.monthly_amount??59.90} key={'amount'+selected+sub?.monthly_amount} required/><select name="status" defaultValue={sub?.status||'pendente'} key={'status'+selected+sub?.status}><option value="pendente">Pendente</option><option value="ativa">Ativa</option><option value="atrasada">Atrasada</option><option value="cancelada">Cancelada</option></select><input type="date" name="due" defaultValue={sub?.due_date||''} key={'due'+selected+sub?.due_date}/><button disabled={loading}>Salvar assinatura</button></form>}</div></>}
</WorkspaceBoundary>}
</main>{!nativeAvailable()&&<MerchantMobileBar routeId={navigationRoute} onNavigate={target=>{setTab(target);setMessage('');setMobileMenuOpen(false)}} onMore={()=>setMobileMenuOpen(open=>!open)} menuOpen={mobileMenuOpen} allowed={allowed} manager={manager} active={active} admin={admin} driver={isDriver} featureSettings={featureSettings}/>}</div>}
createRoot(document.getElementById('root')).render(<WorkspaceBoundary><App/></WorkspaceBoundary>);
