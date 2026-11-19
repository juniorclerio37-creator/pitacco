"""Apply the merchant visual refresh after the application overlays."""
from pathlib import Path

path = Path('web/src.jsx')
source = path.read_text(encoding='utf-8')


def replace(old, new):
    global source
    assert source.count(old) == 1, old
    source = source.replace(old, new, 1)


replace("import './style.css';", "import './style.css';\nimport './merchant-reference.css';\nimport StoreOverview from './StoreOverview.jsx';")
replace(' pitacco-mobile-workspace"', ' pitacco-mobile-workspace store-reference-layout"')
replace('<div className="brand store-identity">', '''{!nativeAvailable()&&<div className="store-sidebar-brand" aria-label="Pitacco">
  <span><img src="/pitacco-brand-013.svg" alt=""/></span><strong>Pitacco</strong>
</div>}<div className="brand store-identity">''')
replace('aria-label="Selecionar loja" value={selected}', 'className="store-header-select" aria-label="Selecionar loja" value={selected}')
replace('<h2>{primary}</h2>', "<h2>{!nativeAvailable()&&tab==='Configurações'?'Impressão e aceite':!nativeAvailable()&&primary==='Motoboys'?'Motoboys e Entregas':primary}</h2>")
replace("{tab==='Painel'&&active&&<div className=\"approved-dashboard\">", """{tab==='Painel'&&active&&!nativeAvailable()&&<StoreOverview key={selected} store={active}
 orders={orders} expenses={expenses} deliveries={deliveries} allowed={allowed} navigate={setTab}
 refresh={()=>Promise.all([loadDetails(),loadDeliveries()])}/>}
{tab==='Painel'&&active&&nativeAvailable()&&<div className="approved-dashboard">""")
path.write_text(source, encoding='utf-8')

operations = Path('web/Operations.jsx')
source = operations.read_text(encoding='utf-8')
source = "import {readPrintPreferences,savePrintPreference} from './printPreferences.mjs';\nimport {receiptItems} from './receiptItems.mjs';\n" + source
replace('<Pedidos client={client} storeId={storeId} orders={orders}', '<Pedidos merchantLayout={!desktop} client={client} storeId={storeId} orders={orders}')
# The active receipt editor persists templates on the server and does not use
# the old local cache. Avoid touching that cache on every merchant screen.
replace("const [editingSector,setEditingSector]=useState(null),[templateHtml,setTemplateHtml]=useState(''),[templatePreview,setTemplatePreview]=useState(false);",
        "const [editingSector,setEditingSector]=useState(null);")
start = source.index(" useEffect(()=>{\n  if(!storeId)return;\n  let cancelled=false;\n  const fallback=localStorage.getItem('pitacco:receipt:'")
end = source.index(" const rpc=", start)
assert "setTemplateHtml" in source[start:end] and "print_receipt_templates" in source[start:end]
source = source[:start] + source[end:]
assert 'templateHtml' not in source
source = "import {operationRequestId} from './operationRequestId.mjs';\n" + source
replace('createRequest=useRef(crypto.randomUUID()), paymentRequest=useRef(crypto.randomUUID())',
        'createRequest=useRef(null), paymentRequest=useRef(null)')
replace('p_request:createRequest.current,', 'p_request:(createRequest.current??=operationRequestId()),')
replace('p_request:paymentRequest.current,', 'p_request:(paymentRequest.current??=operationRequestId()),')
replace('createRequest.current=crypto.randomUUID();', 'createRequest.current=null;')
replace('paymentRequest.current=crypto.randomUUID();', 'paymentRequest.current=null;')
replace('reprintRequests.current.set(key,crypto.randomUUID())', 'reprintRequests.current.set(key,operationRequestId())')

replace("""  const channel=client.channel(`operations:${storeId}`).on('postgres_changes',{event:'*',schema:'public',table:'orders',filter:`store_id=eq.${storeId}`},refresh).subscribe(state=>{if(state==='SUBSCRIBED')void refresh()});
  return()=>{stopped=true;clearInterval(timer);client.removeChannel(channel)};""", """  let channel;
  try{
   channel=client.channel(`operations:${storeId}`);
   channel.on('postgres_changes',{event:'*',schema:'public',table:'orders',filter:`store_id=eq.${storeId}`},refresh)
    .on('postgres_changes',{event:'*',schema:'public',table:'deliveries',filter:`store_id=eq.${storeId}`},refresh)
    .subscribe(state=>{if(state==='SUBSCRIBED')void refresh()});
  }catch{
   // The interval continues syncing orders when this browser blocks Realtime.
  }
  return()=>{
   stopped=true;clearInterval(timer);
   if(channel)void client.removeChannel(channel).catch(()=>{});
  };""")
replace("settingsTab==='Impressoras'&&<>", "settingsTab==='Impressoras'&&<div className=\"merchant-print-layout\">")
replace("</>}\n {settingsTab==='Aceite de pedidos'", "</div>}\n {settingsTab==='Aceite de pedidos'")
replace(r'</PrinterPanelBoundary>}\n<div', '</PrinterPanelBoundary>}\n<div')
replace("JSON.parse(localStorage.getItem('pitacco:print-options:'+storeId)||'{}')[field]", "readPrintPreferences(storeId)[field]")
replace("const key='pitacco:print-options:'+storeId;const next={...JSON.parse(localStorage.getItem(key)||'{}'),[field]:e.target.checked};localStorage.setItem(key,JSON.stringify(next));setStatus('Preferência de impressão salva neste computador')",
        "if(savePrintPreference(storeId,field,e.target.checked))setStatus('Preferência de impressão salva neste computador');else setError('Não foi possível salvar a preferência de impressão neste navegador.')")
replace("(o.receipt?.items||[]).map", "receiptItems(o.receipt).map")
operations.write_text(source, encoding='utf-8')
