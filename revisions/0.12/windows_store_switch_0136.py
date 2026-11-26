"""Persist desktop store selection and isolate pending work from the previous tenant."""
from pathlib import Path
p=Path('web/src.jsx')
s=p.read_text(encoding='utf-8')
def replace(old,new):
 global s
 assert s.count(old)==1, f'Store switch anchor: {old[:100]} ({s.count(old)})'
 s=s.replace(old,new,1)
# Track the rendered tenant and invalidate asynchronous results immediately on selection.
replace('async function loadStores(){','''const currentStoreScope=React.useRef({storeId:selected,userId:session?.user?.id});
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
async function loadStores(){''')
replace('onStoreChange={setSelected}','onStoreChange={changeSelectedStore}')
replace('onChange={e=>{setSelected(e.target.value);if(nativeAvailable())saveWindowsStore(storage,session.user.id,e.target.value)}}','onChange={e=>changeSelectedStore(e.target.value)}')
replace("async function loadDetails(){if(!selected)return;","async function loadDetails(){if(!selected||!session?.user?.id)return;const userId=session.user.id;const storeId=selected;")
replace("const err=result.find(r=>r.error);if(err){setMessage(err.error.message);return}setOrders(result[0].data||[]);","if(currentStoreScope.current.storeId!==storeId||currentStoreScope.current.userId!==userId)return;const err=result.find(r=>r.error);if(err){setMessage(err.error.message);return}setOrders(result[0].data||[]);")
replace("useEffect(()=>{loadDetails()},[selected]);","useEffect(()=>{if(!selected)return;loadDetails().catch(e=>{if(currentStoreScope.current.storeId===selected&&currentStoreScope.current.userId===session?.user?.id)setMessage(e.message||String(e))})},[selected,session?.user?.id]);")
replace("async function loadDeliveries(){if(!session)return;const [ds,cs]=await Promise.all([supabase.from('deliveries').select('*').order('created_at',{ascending:false}).limit(200),supabase.from('couriers').select('*').order('name')]);","""async function loadDeliveries(){if(!session||(!selected&&profile?.role!=='entregador'))return;
const userId=session.user.id;const storeId=selected;
let deliveryQuery=supabase.from('deliveries').select('*'),courierQuery=supabase.from('couriers').select('*');
if(profile?.role!=='entregador'&&storeId){deliveryQuery=deliveryQuery.eq('store_id',storeId);courierQuery=courierQuery.eq('store_id',storeId)}
const [ds,cs]=await Promise.all([deliveryQuery.order('created_at',{ascending:false}).limit(200),courierQuery.order('name')]);
if(currentStoreScope.current.storeId!==storeId||currentStoreScope.current.userId!==userId)return;""")
# The owner is a platform administrator, not automatically a member of every shop.
replace("async function loadStores(){const{data,error}=await supabase.from('stores').select('*').order('created_at',{ascending:false});if(error)throw error;setStores(data||[]);setSelected(old=>nativeAvailable()?windowsStore(storage,session.user.id,data||[],old):data?.some(s=>s.id===old)?old:data?.[0]?.id||'')}", """async function loadStores(){
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
}""")
replace("useEffect(()=>{if(profile){loadStores().catch(e=>setMessage(e.message));loadCourier() }},[profile]);","useEffect(()=>{if(profile&&session?.user?.id===profile.id){loadStores().catch(e=>{if(currentStoreScope.current.userId===session.user.id)setMessage(e.message||String(e))});loadCourier()}},[profile,session?.user?.id]);")
# Preserve the automatic store selection in the store-card action as well.
replace("onClick={()=>{setSelected(s.id);setTab('Painel')}}","onClick={()=>{changeSelectedStore(s.id);if(!nativeAvailable())setTab('Painel')}}")
# Use the actual package version (not a legacy hardcoded label).
s=s.replace("version={nativeAvailable()?'Pitacco Windows v0.12.39':''}","version={nativeAvailable()?'Pitacco Windows v'+installedPackage.version:''}")
assert "installedPackage.version" in s
s="import installedPackage from './package.json';\n"+s
p.write_text(s,encoding='utf-8')
# Native store activation commands must complete in order. In-flight cleanup for
# store A cannot clear the active printer context after store B has been set.
p=Path('web/Operations.jsx')
s=p.read_text(encoding='utf-8')
anchor="export default function Operations("
assert s.count(anchor)==1
s=s.replace(anchor,"let activeStoreCommand=Promise.resolve();\nfunction queueActiveStore(storeId){const next=activeStoreCommand.catch(()=>{}).then(()=>invoke('set_active_store',{storeId}));activeStoreCommand=next;return next}\n"+anchor,1)
old="""  invoke('set_active_store',{storeId:manager?storeId:null}).catch(e=>setError(String(e)));
  return()=>{invoke('set_active_store',{storeId:null}).catch(()=>{})};"""
new="""  let live=true;
  const activation={storeId:manager?storeId:null,ready:queueActiveStore(manager?storeId:null)};
  nativePrintScope.current=activation;
  activation.ready.catch(e=>{if(live)setError(String(e))});
  return()=>{live=false;if(nativePrintScope.current===activation)nativePrintScope.current=null;void queueActiveStore(null).catch(()=>{})};"""
assert s.count(old)==1, 'Native printer context anchor changed'
s=s.replace(old,new,1)
# Wait for native activation independently of the React tenant selection.
anchor="  const activation={storeId:manager?storeId:null,ready:queueActiveStore(manager?storeId:null)};"
assert s.count(anchor)==1, 'Native scope ref anchor changed'
# Insert the hook at the component entry, before any effect runs.
import re
entry=r"(export default function Operations\([^\n]*\)\{)"
assert len(re.findall(entry,s))==1, 'Operations component entry changed'
s=re.sub(entry,lambda m:m.group(0)+"""
 const nativePrintScope=useRef(null);
 async function waitForNativePrintStore(){
  const scope=nativePrintScope.current;
  if(!manager||!storeId||scope?.storeId!==storeId)return false;
  try{await scope.ready}catch{return false}
  return nativePrintScope.current===scope;
 }
""",s,count=1)
anchor="   try{const local=await invoke('list_jobs');if(stopped)return;"
assert s.count(anchor)==1, 'Local print queue polling anchor changed'
s=s.replace(anchor,"   try{if(!await waitForNativePrintStore()||stopped)return;const local=await invoke('list_jobs');if(stopped)return;",1)
anchor="    if(desktop&&device){"
assert s.count(anchor)==1, 'Remote print queue polling anchor changed'
s=s.replace(anchor,"    if(desktop&&device&&await waitForNativePrintStore()&&!stopped){",1)
p.write_text(s,encoding='utf-8')
# Supersede every previously used version number, including the 0.12.39 overlay.
for relative in ['package.json','package-lock.json','src-tauri/tauri.conf.json','src-tauri/Cargo.toml','src-tauri/Cargo.lock']:
 p=Path('web')/relative
 source=p.read_text(encoding='utf-8')
 assert '0.12.35' in source or '0.12.39' in source, relative
 p.write_text(source.replace('0.12.35','0.12.46').replace('0.12.39','0.12.46'),encoding='utf-8')

# The Windows installer, not the terminating process, owns the restart.
p=Path('web/src-tauri/src/main.rs')
s=p.read_text(encoding='utf-8')
old="update.download_and_install(|_,_|{},||{}).await.map_err(|e|e.to_string())?;"
assert s.count(old)==1
s=s.replace(old,"update.restart_after_install(true).download_and_install(|_,_|{},||{}).await.map_err(|e|e.to_string())?;",1)
s=s.replace('Atualização instalada. Saia pela bandeja e abra novamente.','Atualização instalada. O Pitacco será reaberto automaticamente.')
# Do not inherit a hidden startup from the auto-start command after an update:
# the updater restarts with the current argv, so record a one-use explicit show marker
# before installation, and remove it if the verified install does not succeed.
s=s.replace("   update.restart_after_install(true).download_and_install", """   let reopen_marker=app.path().app_local_data_dir().map_err(|e|e.to_string())?.join("show-after-update");
   std::fs::write(&reopen_marker,b"1").map_err(|e|e.to_string())?;
   if let Err(e)=update.restart_after_install(true).download_and_install""")
s=s.replace("(|_,_|{},||{}).await.map_err(|e|e.to_string())?;\n   Ok(\"Atualização instalada.", """(|_,_|{},||{}).await {
    let _=std::fs::remove_file(&reopen_marker);
    return Err(e.to_string());
   }
   Ok("Atualização instalada.""")
old=' if std::env::args().any(|a|a=="--minimized"){if let Some(w)=app.get_webview_window("main"){w.hide()?;}}'
new=''' let reopen_marker=dir.join("show-after-update");
 let explicit_reopen=std::fs::remove_file(&reopen_marker).is_ok();
 let version_marker=dir.join("last-started-version");
 let current_version=app.package_info().version.to_string();
 let changed_version=std::fs::read_to_string(&version_marker).ok().as_deref()!=Some(current_version.as_str());
 let _=std::fs::write(&version_marker,current_version.as_bytes());
 let reopen=explicit_reopen||changed_version;
 if reopen{if let Some(w)=app.get_webview_window("main"){w.show()?;let _=w.set_focus();}}
 else if std::env::args().any(|a|a=="--minimized"){if let Some(w)=app.get_webview_window("main"){w.hide()?;}}'''
assert s.count(old)==1
s=s.replace(old,new,1)
assert 'if let Err(e)=update.restart_after_install(true).download_and_install(|_,_|{},||{}).await {' in s
p.write_text(s,encoding='utf-8')
p=Path('web/Operations.jsx')
s=p.read_text(encoding='utf-8')
s=s.replace('Se houver uma versão nova, o Pitacco baixa e instala a atualização assinada. Aguarde a fila de impressão terminar antes de atualizar.','Se houver uma versão nova, o Pitacco baixa e instala a atualização assinada e reabre automaticamente. Aguarde a fila de impressão terminar antes de atualizar.')
p.write_text(s,encoding='utf-8')
