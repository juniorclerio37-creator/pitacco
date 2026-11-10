"""Add an explicit physical printer test command to Pitacco Windows."""
from pathlib import Path
p=Path('web/src-tauri/src/main.rs')
s=p.read_text()
needle='#[tauri::command]async fn list_printers()'
assert s.count(needle)==1
command='''#[tauri::command]async fn test_printer(state:tauri::State<'_,State>,printer_name:String,width:u16)->Result<String,String>{
 let _=store(&state)?;
 if ![58,80].contains(&width){return Err("Largura inválida".into())}
 if printer_name.trim().is_empty()||printer_name.len()>256||printer_name.contains('\\0'){return Err("Impressora inválida".into())}
 tauri::async_runtime::spawn_blocking(move||{
  let receipt=printer::receipt_bytes("PITACCO - TESTE DE IMPRESSAO\\nImpressora configurada\\nVerifique a largura e o corte\\n",width);
  printer::send(&printer_name,&receipt).map(|id|format!("Enviado ao spooler do Windows (trabalho {id}). Confira o papel; envio não garante impressão física.")).map_err(|e|e.message)
 }).await.map_err(|e|e.to_string())?
}
'''
s=s.replace(needle,command+needle)
needle='retry_job,list_printers,get_autostart'
assert s.count(needle)==1
s=s.replace(needle,'retry_job,list_printers,test_printer,get_autostart')
p.write_text(s)
p=Path('web/Operations.jsx')
s=p.read_text()
needle='   {desktop&&<div className="panel"><h3>Fila persistente'
assert s.count(needle)==1
addition='''   {desktop&&<div className="panel"><h3>Teste de impressão física</h3><p>Selecione a impressora cadastrada e envie um cupom de teste diretamente ao spooler do Windows. O teste não altera nem consome pedidos.</p>{sectors.map(s=><div className="line" key={'test:'+s.sector}><b>{s.sector}</b><span>{s.printer} · {s.width} mm</span><button disabled={busy} onClick={()=>act(async()=>setStatus(await invoke('test_printer',{printerName:s.printer,width:s.width})))}>Imprimir teste</button></div>)}{!sectors.length&&<p>Cadastre uma impressora acima para testar.</p>}</div>}
'''
s=s.replace(needle,addition+needle)
p.write_text(s)
