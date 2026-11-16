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
replace('<Pedidos orders={orders}', '<Pedidos merchantLayout={!desktop} orders={orders}')
replace("settingsTab==='Impressoras'&&<>", "settingsTab==='Impressoras'&&<div className=\"merchant-print-layout\">")
replace("</>}\n {settingsTab==='Aceite de pedidos'", "</div>}\n {settingsTab==='Aceite de pedidos'")
replace(r'</PrinterPanelBoundary>}\n<div', '</PrinterPanelBoundary>}\n<div')
replace("JSON.parse(localStorage.getItem('pitacco:print-options:'+storeId)||'{}')[field]", "readPrintPreferences(storeId)[field]")
replace("const key='pitacco:print-options:'+storeId;const next={...JSON.parse(localStorage.getItem(key)||'{}'),[field]:e.target.checked};localStorage.setItem(key,JSON.stringify(next));setStatus('Preferência de impressão salva neste computador')",
        "if(savePrintPreference(storeId,field,e.target.checked))setStatus('Preferência de impressão salva neste computador');else setError('Não foi possível salvar a preferência de impressão neste navegador.')")
replace("(o.receipt?.items||[]).map", "receiptItems(o.receipt).map")
operations.write_text(source, encoding='utf-8')
