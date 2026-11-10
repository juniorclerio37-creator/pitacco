from pathlib import Path
p=Path('web/Operations.jsx')
s=p.read_text(encoding='utf-8')
s=s.replace("const [settingsTab,setSettingsTab]=useState('Impressoras')","const [deviceBound,setDeviceBound]=useState(false),[printMessage,setPrintMessage]=useState('');\n const [settingsTab,setSettingsTab]=useState('Impressoras')",1)
s=s.replace("setSectors(results[2].data||[]);setStatus(","setSectors(results[2].data||[]);setStatus(",1)
s=s.replace("if(error)throw error;form.reset()})}","if(error)throw error;setSectors(old=>[...old.filter(x=>x.sector!==String(f.get('sector')).trim()),{store_id:storeId,sector:String(f.get('sector')).trim(),printer:String(f.get('printer')).trim(),width:Number(f.get('width')),copies:Number(f.get('copies')),enabled:true}]);setPrintMessage('Impressora salva.');form.reset()})}",1)
needle=" async function createOrder(e)"
assert s.count(needle)==1
s=s.replace(needle," async function removePrinter(sector){if(!window.confirm('Excluir a impressora do setor '+sector+' desta loja?'))return;await act(async()=>{const {error}=await client.from('print_sectors').delete().eq('store_id',storeId).eq('sector',sector);if(error)throw error;setSectors(old=>old.filter(x=>x.sector!==sector));setPrintMessage('Configuração de impressora excluída. A impressora continua instalada no Windows.')})}\n"+needle,1)
needle="<button disabled={busy||!device} onClick={()=>act(()=>rpc('bind_print_device',{p_store:storeId,p_device:device}))}>Vincular este computador</button>"
assert s.count(needle)==1
s=s.replace(needle,"<p><b>Computador atual:</b> {device?'Identificado pelo Pitacco':'Aguardando identificação'}</p><p>{deviceBound?'Vinculação solicitada com sucesso. Este computador está configurado para receber as impressões desta loja.':'Vincule este computador uma vez para habilitar o recebimento de comandas.'}</p><button disabled={busy||!device} onClick={()=>act(async()=>{await rpc('bind_print_device',{p_store:storeId,p_device:device});setDeviceBound(true);setPrintMessage('Computador vinculado à loja.')})}>{deviceBound?'Vincular novamente':'Vincular este computador'}</button>",1)
needle="{sectors.map(s=><div className=\"line\""
assert s.count(needle)==1
s=s.replace(needle,"{printMessage&&<p role=\"status\">{printMessage}</p>}{sectors.map(s=><div className=\"line\"",1)
needle="{s.enabled?'Desativar':'Ativar'}</button></div>)"
assert s.count(needle)==1
s=s.replace(needle,"{s.enabled?'Desativar':'Ativar'}</button><button type=\"button\" disabled={busy} onClick={()=>removePrinter(s.sector)}>Excluir impressora</button></div>)",1)
start=s.index("   {desktop&&<div className=\"panel\"><h3>Fila persistente deste computador</h3>")
end=s.index("\n </>}",start)
s=s[:start]+"""   {desktop&&jobs.some(j=>['error','uncertain'].includes(j.state))&&<div className="panel"><h3>Atenção à impressão</h3><p>Há {jobs.filter(j=>['error','uncertain'].includes(j.state)).length} trabalho(s) com falha ou resultado incerto. Eles permanecem registrados para diagnóstico, mas não serão exibidos em uma fila de erros. Confira a impressora e use a reimpressão no pedido se necessário.</p></div>}"""+s[end:]
p.write_text(s,encoding='utf-8')
