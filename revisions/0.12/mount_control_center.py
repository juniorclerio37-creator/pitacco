from pathlib import Path
p=Path('web/src.jsx');s=p.read_text(encoding='utf-8');s="import ControlMerchantMessages from './ControlMerchantMessages.jsx';\n"+s
anchor='{message&&<div className="notice" role="status">{message}</div>}'
assert s.count(anchor)==1
s=s.replace(anchor,"{active&&!isDriver&&manager&&<ControlMerchantMessages key={'control-messages:'+selected} client={supabase} storeId={selected}/>}"+anchor,1);p.write_text(s,encoding='utf-8')
p=Path('web/Operations.jsx');s=p.read_text(encoding='utf-8');s="import packageInfo from './package.json';\n"+s
anchor="const {error}=await client.rpc('pitacco_windows_ping',{p_store:storeId,p_device:device});\n    if(error)throw error;"
assert s.count(anchor)==1
s=s.replace(anchor,anchor+"\n    void client.rpc('pitacco_control_device_ping',{p_store:storeId,p_device:device,p_app:'windows',p_version:packageInfo.version}).then(()=>{}).catch(()=>{});",1);p.write_text(s,encoding='utf-8')
