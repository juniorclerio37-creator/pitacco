"""Prepare a disposable, opt-in map UI build. Never modify core-source or production."""
import argparse, pathlib, shutil
ROOT=pathlib.Path(__file__).resolve().parents[2]
def replace(s,old,new):
    if s.count(old)!=1:
        raise RuntimeError("Unexpected original map component anchor: "+old[:90])
    return s.replace(old,new,1)
def build(target):
    source=ROOT/'core-source'/'web'
    if target.exists() or target.resolve().is_relative_to(ROOT):
        raise RuntimeError("Use a fresh temporary directory outside the repository.")
    shutil.copytree(source,target)
    f=target/'FleetTracking.jsx';s=f.read_text()
    s=replace(s,"export default function FleetTracking({client, storeId, onBack})","export default function FleetTracking({client, storeId, onBack, experimentalMap=null})")
    s=replace(s,"        const [storeResult, couriersResult, deliveriesResult] = await Promise.all([",'''        if(experimentalMap){
          const next=await experimentalMap.readFleet();
          if(alive){setState(next);setUpdatedAt(new Date());setError('');}
          return;
        }
        const [storeResult, couriersResult, deliveriesResult] = await Promise.all([''')
    s=replace(s,"        if (alive) setError('Não foi possível atualizar o mapa: ' + (err.message || String(err)));","        if (alive) {if(experimentalMap){setState({store:null,couriers:[],deliveries:[],positions:[],motion:[]});setUpdatedAt(null);}setError('Não foi possível atualizar o mapa: ' + (err.message || String(err)));}")
    s=replace(s,"  }, [client, storeId]);","  }, [client, storeId, experimentalMap]);")
    s=replace(s,"        const {data, error} = await client.functions.invoke('delivery-quote', {","        const {data, error} = await (experimentalMap?experimentalMap.invoke:client.functions.invoke.bind(client.functions))('delivery-quote', {")
    s=replace(s,"  }, [client,storeId,state.store?.id","  }, [client,experimentalMap,storeId,state.store?.id")
    f.write_text(s)
    f=target/'StoreProfile.jsx';s=f.read_text()
    s=replace(s,"function StorePointPicker({client,store,manager,addressDirty,registrationBusy,onSaved})","function StorePointPicker({client,store,manager,addressDirty,registrationBusy,onSaved,experimentalMap=null})")
    s=replace(s," const initial=pointFromStore(store);"," const initial=experimentalMap?null:pointFromStore(store);")
    s=replace(s,"  const p=pointFromStore(store);\n  setPoint(p);","  if(experimentalMap)return;\n  const p=pointFromStore(store);\n  setPoint(p);")
    s=replace(s," },[store?.id,store?.latitude,store?.longitude]);"," },[store?.id,store?.latitude,store?.longitude,experimentalMap]);\n useEffect(()=>{\n  if(!experimentalMap||!manager)return;\n  let alive=true;\n  experimentalMap.readPoint().then(p=>{if(!alive||manualProposal.current)return;const next=pointFromStore(p);setPoint(next);setPicked(next);if(next)map.current?.setPoint(next);}).catch(err=>{if(alive){setPoint(null);setPicked(null);setError(err.message||'Mapa indisponível.');}});\n  return()=>{alive=false};\n },[experimentalMap,manager,store?.id]);")
    s=replace(s,"  if(point||!manager||!store?.id)return;","  if(experimentalMap||point||!manager||!store?.id)return;")
    s=replace(s," },[client,store?.id,Boolean(point),manager]);"," },[client,store?.id,Boolean(point),manager,experimentalMap]);")
    s=replace(s,"await locateStoreByAddress(client,store.id)","await locateStoreByAddress(experimentalMap?{functions:{invoke:experimentalMap.invoke}}:client,store.id)")
    s=replace(s,"   const {data,error}=await client.functions.invoke('delivery-quote',{","   const {data,error}=await (experimentalMap?experimentalMap.invoke:client.functions.invoke.bind(client.functions))('delivery-quote',{")
    s=replace(s,"export default function StoreProfile({client,store,manager,onSaved,onAppearance,storeLogoUrl=''})","export default function StoreProfile({client,store,manager,onSaved,onAppearance,storeLogoUrl='',experimentalMap=null})")
    s=replace(s,"<StorePointPicker key={store.id} client={client}","<StorePointPicker key={store.id} experimentalMap={experimentalMap} client={client}")
    f.write_text(s)
    # The host must explicitly supply a session-bound factory. Default remains
    # original. No token is read from localStorage, URL, or legacy session.
    f=target/'src.jsx';s=f.read_text()
    s=replace(s,"function App(){","function App({experimentalMapFactory=null}={}){")
    s=replace(s,"const currentStoreScope=React.useRef({storeId:selected,userId:session?.user?.id});","const experimentalMap=React.useMemo(()=>experimentalMapFactory&&selected&&session?.user?.id?experimentalMapFactory({store:selected,actor:session.user.id}):null,[experimentalMapFactory,selected,session?.user?.id]);\nuseEffect(()=>()=>experimentalMap?.stop(),[experimentalMap]);\nconst currentStoreScope=React.useRef({storeId:selected,userId:session?.user?.id});")
    s=replace(s,"<NavigationFleetTracking key={selected} client={supabase}","<NavigationFleetTracking key={selected} experimentalMap={experimentalMap} client={supabase}")
    s=replace(s,"<StoreProfile key={selected} client={supabase}","<StoreProfile key={selected} experimentalMap={experimentalMap} client={supabase}")
    f.write_text(s)
    shutil.copy2(ROOT/'backend'/'clients'/'merchant-map.mjs',target/'coreMerchantMap.mjs')
    # Compile a separate preview entry; original entry remains untouched.
    clients=target/'core-clients'
    clients.mkdir()
    for name in ('core-session.mjs','merchant-map.mjs','windows-print.mjs','windows-device.mjs','merchant-runtime.mjs'):
        shutil.copy2(ROOT/'backend'/'clients'/name,clients/name)
    runtime=clients/'merchant-runtime.mjs'
    runtime.write_text(replace(runtime.read_text(),"../../core-source/web/printBridge.mjs","../printBridge.mjs"))
    shutil.copy2(ROOT/'backend'/'ui'/'CoreMerchantHost.jsx',target/'CoreMerchantHost.jsx')
    shutil.copy2(ROOT/'backend'/'ui'/'core-preview.jsx',target/'core-preview.jsx')
    # No default activation. Keep identical frontend entry point and Tauri assets.
    print("Prepared isolated original React/Tauri map overlay:",target)
if __name__=='__main__':
    p=argparse.ArgumentParser()
    p.add_argument('target',type=pathlib.Path)
    build(p.parse_args().target)
