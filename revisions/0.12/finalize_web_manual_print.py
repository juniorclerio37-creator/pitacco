"""Keep native printer setup/tests intact; use browser dialog only on merchant website.

Run after the legacy print module overlays; modifying their source anchors earlier
would silently drop physical printer-test controls from the Windows build.
"""
from pathlib import Path
path=Path('web/Operations.jsx')
source=path.read_text(encoding='utf-8')
start_marker=' {settingsTab===\'Impressoras\'&&<div className="merchant-print-layout">'
next_marker=" {settingsTab==='Aceite de pedidos'&&"
assert source.count(start_marker)==1, "Expected one printing settings section"
assert source.count(next_marker)==1, "Expected one acceptance settings section"
start=source.index(start_marker)
end=source.index(next_marker,start)
original=source[start:end]
closing="\n </div>}\n"
assert original.endswith(closing), "Unexpected native printer panel structure"
native=original[len(start_marker):-len(closing)]
replacement=""" {settingsTab==='Impressoras'&&(
 desktop?<div className="merchant-print-layout">

"""+native+"""
 </div>:<>
  <WindowsConnectionStatus client={client} storeId={storeId} onNavigate={onNavigate}/>
  <section className="panel" aria-label="Impressão manual no navegador">
   <h3>Impressão manual no navegador</h3>
   <p>Após aceitar um pedido em Pedidos, clique em <strong>Imprimir no navegador</strong>.
    O navegador abre sua janela de impressão e permite escolher uma impressora instalada
    e reconhecida pelo sistema operacional.</p>
   <p>A página não descobre nomes de impressoras, não imprime automaticamente e
    não confirma a saída do papel. O teste físico da impressora e o envio automático
    ao spooler são exclusivos do aplicativo Windows.</p>
   <button type="button" className="secondary" onClick={()=>onNavigate('Pedidos')}>Ir para pedidos</button>
  </section>
 </>
 )}
"""
source=source[:start]+replacement+source[end:]
# The modern Pedidos component is the actual web order board.
needle="onReprint={id=>act(()=>reprint(id))}"
assert source.count(needle)==1, "Pedidos callback changed; refusing unsafe update"
source=source.replace(needle,
 "onReprint={id=>{if(desktop){void act(()=>reprint(id));return;}"
 "const order=orders.find(o=>o.id===id);if(order)printBrowserOrder(order);}} manualPrint={!desktop}",1)

path.write_text(source,encoding='utf-8')
