"""Sync each store's general receipt template through the RLS-protected backend.
Run after add_printer_ui_013.py. Keep local fallback for stores not yet migrated.
"""
from pathlib import Path
p=Path('web/Operations.jsx')
s=p.read_text()
old="useEffect(()=>{if(!storeId)return;setTemplateHtml(localStorage.getItem('pitacco:receipt:'+storeId)||'<h2>PITACCO</h2><p>Pedido: {{pedido}}</p><p>Cliente: {{cliente}}</p><p>{{itens}}</p><p>Total: {{total}}</p><p>{{observacoes}}</p>');},[storeId]);"
new="""useEffect(()=>{
  if(!storeId)return;
  let cancelled=false;
  const fallback=localStorage.getItem('pitacco:receipt:'+storeId)||'<h2>PITACCO</h2><p>Pedido: {{pedido}}</p><p>Cliente: {{cliente}}</p><p>{{itens}}</p><p>Total: {{total}}</p><p>{{observacoes}}</p>';
  setTemplateHtml(fallback);
  if(!manager)return;
  client.from('print_receipt_templates').select('html').eq('store_id',storeId).eq('sector','geral').eq('name','Padrão').maybeSingle().then(({data,error})=>{
   if(!cancelled&&!error&&data?.html){setTemplateHtml(data.html);localStorage.setItem('pitacco:receipt:'+storeId,data.html)}
  });
  return()=>{cancelled=true};
 },[client,storeId,manager]);"""
assert s.count(old)==1, 'Could not locate template initialization'
s=s.replace(old,new)
old="onClick={()=>{localStorage.setItem('pitacco:receipt:'+storeId,templateHtml);setStatus('Modelo salvo neste computador para esta loja')}}"
new="""onClick={()=>act(async()=>{
  if(!storeId)throw Error('Selecione uma loja');
  if(!templateHtml.trim()||templateHtml.length>32768)throw Error('O modelo deve conter entre 1 e 32768 caracteres');
  if(/<\\s*(script|iframe|object|embed|link|meta|img|svg|audio|video|form|base)\\b|\\bon\\w+\\s*=|(?:src|href)\\s*=|@import|url\\s*\\(/i.test(templateHtml))throw Error('HTML contém scripts, imagens ou referências externas não permitidas');
  const {error}=await client.from('print_receipt_templates').upsert({store_id:storeId,sector:'geral',name:'Padrão',html:templateHtml,paper_width:80,is_default:true},{onConflict:'store_id,sector,name'});
  if(error)throw Error('Não foi possível sincronizar o modelo com a loja: '+error.message);
  localStorage.setItem('pitacco:receipt:'+storeId,templateHtml);
  setStatus('Modelo salvo e sincronizado para esta loja');
 })}"""
assert s.count(old)==1,'Could not locate save action'
s=s.replace(old,new)
s=s.replace('Modelo independente por loja neste computador. Campos:', 'Modelo sincronizado por estabelecimento. Campos:',1)
p.write_text(s)
