from pathlib import Path
p=Path('web/Operations.jsx')
s=p.read_text(encoding='utf-8')
state_needle="const [deviceBound,setDeviceBound]=useState(false),[printMessage,setPrintMessage]=useState('');"
if s.count(state_needle)!=1: raise RuntimeError('Printer state changed: refusing unsafe overlay')
s=s.replace(state_needle,"const [deviceBound,setDeviceBound]=useState(false),[boundDevice,setBoundDevice]=useState(null),[printMessage,setPrintMessage]=useState('');",1)
needle=" async function createOrder(e)"
assert s.count(needle)==1, 'Printer insertion point changed'
s=s.replace(needle," async function refreshPrintDevice(){if(!storeId)return;const {data,error}=await client.from('print_devices').select('device_id,bound_at').eq('store_id',storeId).maybeSingle();if(error)throw error;setBoundDevice(data);setDeviceBound(!!data&&data.device_id===device)}\n useEffect(()=>{if(!storeId||!device||!manager)return;refreshPrintDevice().catch(e=>setError(e.message))},[client,storeId,device,manager]);\n async function bindComputer(){if(boundDevice?.device_id&&boundDevice.device_id!==device&&!window.confirm('Esta loja já possui outro computador vinculado. Deseja transferir a impressão para este computador? O anterior deixará de receber novos pedidos.'))return;await act(async()=>{await rpc('pitacco_switch_print_device',{p_store:storeId,p_device:device});await refreshPrintDevice();setPrintMessage('Computador vinculado com sucesso.')})}\n async function unbindComputer(){if(!window.confirm('Desvincular este computador? A impressão automática ficará indisponível até vincular outro.'))return;await act(async()=>{await rpc('pitacco_unbind_print_device',{p_store:storeId,p_device:device});await refreshPrintDevice();setPrintMessage('Computador desvinculado.')})}\n"+needle,1)
assert s.count('<div className="panel"><h3>Computador de impressão</h3>')==1, 'Printer device panel changed'
start=s.index('<div className="panel"><h3>Computador de impressão</h3>')
assert s.count('    <div className="panel"><h3>Impressoras por setor</h3>')==1, 'Printer sector panel changed'
end=s.index('    <div className="panel"><h3>Impressoras por setor</h3>',start)
s=s[:start]+'''<div className="panel"><h3>Computador responsável pela impressão</h3><p>Somente um computador pode estar vinculado a cada loja por vez. A troca é protegida contra trabalhos pendentes.</p>{desktop?<><p><b>Status:</b> {deviceBound?'Este computador está vinculado':boundDevice?'Outro computador está vinculado':'Nenhum computador vinculado'}</p><div className="quick-actions"><button disabled={busy||!device||deviceBound} onClick={bindComputer}>{boundDevice&&!deviceBound?'Transferir vínculo para este computador':'Vincular este computador'}</button>{deviceBound&&<button className="secondary" disabled={busy} onClick={unbindComputer}>Desvincular computador</button>}</div><details className="technical"><summary>Identificação técnica do computador</summary><code>{device||'Carregando…'}</code></details></>:<p>Abra o aplicativo Windows para gerenciar o vínculo deste computador.</p>}</div>
''' +s[end:]
# Printer sector editing is already supplied by add_printer_ui_013.py.
# Do not inject a second editor or duplicate Edit button here.
p.write_text(s,encoding='utf-8')
