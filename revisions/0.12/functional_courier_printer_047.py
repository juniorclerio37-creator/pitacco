"""Functional printer sector editing/removal and real courier payout search.
Preserve original backend RPCs and Windows print spooler.
"""
from pathlib import Path
p=Path('web/Operations.jsx')
s=p.read_text(encoding='utf-8')
needle=" const [settingsTab,setSettingsTab]=useState('Impressoras')"
assert s.count(needle)==1
s=s.replace(needle," const [editingSector,setEditingSector]=useState(null);\n"+needle,1)
needle='<form onSubmit={savePrinter}><label className="field">Setor (ex.: cozinha)<input name="sector"'
assert s.count(needle)==1
s=s.replace(needle,'<form key={editingSector?.sector||"new-sector"} onSubmit={async e=>{await savePrinter(e);setEditingSector(null)}}><label className="field">Setor (ex.: cozinha)<input name="sector" defaultValue={editingSector?.sector||""}',1)
needle='name="printer" list="windows-printers"'
assert s.count(needle)==1
s=s.replace(needle,'name="printer" defaultValue={editingSector?.printer||""} list="windows-printers"',1)
needle='<option value="80">80 mm</option><option value="58">58 mm</option>'
assert s.count(needle)==1
s=s.replace('<select name="width" aria-label="Largura">','<select name="width" aria-label="Largura" defaultValue={String(editingSector?.width||80)}>',1)
needle='defaultValue="1" required/></label><button disabled={busy}>Salvar setor</button></form>'
assert s.count(needle)==1
s=s.replace(needle,'defaultValue={editingSector?.copies||1} required/></label><button disabled={busy}>{editingSector?"Salvar alterações":"Salvar setor"}</button>{editingSector&&<button type="button" className="secondary" onClick={()=>setEditingSector(null)}>Cancelar edição</button>}</form>',1)
needle='<span>{s.printer} · {s.width} mm · {s.copies} via(s)</span><button disabled={busy}'
assert s.count(needle)==1
s=s.replace(needle,'<span>{s.printer} · {s.width} mm · {s.copies} via(s)</span><button type="button" className="secondary" disabled={busy} onClick={()=>setEditingSector(s)}>Editar</button><button type="button" className="secondary" disabled={busy} onClick={()=>{if(window.confirm("Excluir a configuração de impressão do setor "+s.sector+"?"))act(async()=>{const {error}=await client.from("print_sectors").delete().eq("store_id",storeId).eq("sector",s.sector);if(error)throw error;setEditingSector(null)})}}>Excluir</button><button disabled={busy}',1)
# Show configured widths using persisted sectors; never claim a printer is online without native confirmation.
needle='   {desktop&&<div className="panel"><h3>Fila persistente deste computador</h3>'
assert s.count(needle)==1
s=s.replace(needle,'   <div className="panel"><h3>Configurações salvas da loja</h3><p>As impressoras abaixo são configurações cadastradas, não confirmação de que estão online. Para testar a impressão física, use o aplicativo Windows e o botão de teste do setor.</p><div className="printer-sector-summary">{sectors.map(s=><div key={s.sector} className="line"><b>{s.sector}</b><span>{s.width===58?"Papel 58 mm":"Papel 80 mm"} · {s.enabled?"Habilitada":"Desabilitada"}</span></div>)}{!sectors.length&&<p>Nenhuma impressora cadastrada.</p>}</div></div>\n'+needle,1)
p.write_text(s,encoding='utf-8')
p=Path('web/CourierFinance.jsx')
s=p.read_text(encoding='utf-8')
needle=" const [couriers,setCouriers]=useState([])"
assert s.count(needle)==1
s=s.replace(needle," const [search,setSearch]=useState('');\n"+needle,1)
needle="<h3>{view==='Relatório de motoboys'?'Relatório de entregadores':'Pagamento de entregadores'}</h3>"
assert s.count(needle)==1
s=s.replace(needle,needle+"<label className=\"field\">Buscar entregador<input aria-label=\"Buscar entregador\" value={search} onChange={e=>setSearch(e.target.value)} placeholder=\"Nome do entregador\"/></label>",1)
s=s.replace('{couriers.map(c=>{const rows=deliveries.filter','{couriers.filter(c=>c.name.toLowerCase().includes(search.toLowerCase())).map(c=>{const rows=deliveries.filter',1)
s=s.replace('{couriers.map(c=><option key={c.id}', '{couriers.filter(c=>c.name.toLowerCase().includes(search.toLowerCase())).map(c=><option key={c.id}',1)
p.write_text(s,encoding='utf-8')
