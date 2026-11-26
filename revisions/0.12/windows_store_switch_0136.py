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
replace("async function loadDeliveries(){if(!session)return;const [ds,cs]=await Promise.all([supabase.from('deliveries').select('*').order('created_at',{ascending:false}).limit(200),supabase.from('couriers').select('*').order('name')]);","""async function loadDeliveries(){if(!session||!selected&&nativeAvailable())return;
const userId=session.user.id;const storeId=selected;
let deliveryQuery=supabase.from('deliveries').select('*'),courierQuery=supabase.from('couriers').select('*');
if(nativeAvailable()){deliveryQuery=deliveryQuery.eq('store_id',storeId);courierQuery=courierQuery.eq('store_id',storeId)}
const [ds,cs]=await Promise.all([deliveryQuery.order('created_at',{ascending:false}).limit(200),courierQuery.order('name')]);
if(currentStoreScope.current.storeId!==storeId||currentStoreScope.current.userId!==userId)return;""")
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
  queueActiveStore(manager?storeId:null).catch(e=>{if(live)setError(String(e))});
  return()=>{live=false;void queueActiveStore(null).catch(()=>{})};"""
assert s.count(old)==1, 'Native printer context anchor changed'
s=s.replace(old,new,1)
p.write_text(s,encoding='utf-8')
# Supersede every previously used version number, including the 0.12.39 overlay.
for relative in ['package.json','package-lock.json','src-tauri/tauri.conf.json','src-tauri/Cargo.toml','src-tauri/Cargo.lock']:
 p=Path('web')/relative
 source=p.read_text(encoding='utf-8')
 assert '0.12.35' in source or '0.12.39' in source, relative
 p.write_text(source.replace('0.12.35','0.12.40').replace('0.12.39','0.12.40'),encoding='utf-8')
