"""Apply incremental 0.13 printer settings UI and receipt template changes."""
from pathlib import Path
p=Path('web/Operations.jsx')
s=p.read_text(encoding='utf-8')
s=s.replace("const [settingsTab,setSettingsTab]=useState('Impressoras')","const [editingSector,setEditingSector]=useState(null),[templateHtml,setTemplateHtml]=useState(''),[templatePreview,setTemplatePreview]=useState(false);\n const [settingsTab,setSettingsTab]=useState('Impressoras')",1)
needle=" const rpc=async(name,args)=>"
s=s.replace(needle," useEffect(()=>{if(!storeId)return;setTemplateHtml(localStorage.getItem('pitacco:receipt:'+storeId)||'<h2>PITACCO</h2><p>Pedido: {{pedido}}</p><p>Cliente: {{cliente}}</p><p>{{itens}}</p><p>Total: {{total}}</p><p>{{observacoes}}</p>');},[storeId]);\n"+needle,1)
s=s.replace("form.reset()})}\n async function createOrder","form.reset();setEditingSector(null);setSectors(old=>[...old.filter(x=>x.sector!==String(f.get('sector')).trim()),{store_id:storeId,sector:String(f.get('sector')).trim(),printer:String(f.get('printer')).trim(),width:Number(f.get('width')),copies:Number(f.get('copies')),enabled:true}])})}\n async function createOrder",1)
s=s.replace("<form onSubmit={savePrinter}><label className=\"field\">Setor", "<form key={editingSector?.sector||'new'} onSubmit={savePrinter}><label className=\"field\">Setor",1)
s=s.replace('name="sector" placeholder="Setor (ex.: cozinha)"','name="sector" defaultValue={editingSector?.sector||""} readOnly={!!editingSector} placeholder="Setor (ex.: cozinha)"',1)
s=s.replace('name="printer" list="windows-printers"','name="printer" defaultValue={editingSector?.printer||""} list="windows-printers"',1)
s=s.replace('<option value="80">80 mm</option><option value="58">58 mm</option>','<option value="80">80 mm</option><option value="58">58 mm</option>',1)
s=s.replace('aria-label="Largura"><option','aria-label="Largura" defaultValue={editingSector?.width||80}><option',1)
s=s.replace('defaultValue="1" required/></label><button disabled={busy}>Salvar setor</button>','defaultValue={editingSector?.copies||1} required/></label><button disabled={busy}>{editingSector?"Salvar alterações":"Adicionar impressora"}</button>{editingSector&&<button type="button" className="secondary" onClick={()=>setEditingSector(null)}>Cancelar edição</button>}',1)
s=s.replace("<button disabled={busy} onClick={()=>act(async()=>{const {error}=await client.from('print_sectors').update({enabled:!s.enabled})", "<button className=\"secondary\" disabled={busy} onClick={()=>setEditingSector(s)}>Editar</button><button className=\"secondary\" disabled={busy} onClick={()=>act(async()=>{if(!window.confirm('Excluir a configuração do setor '+s.sector+'?'))return;const {count,error:pendingError}=await client.from('print_jobs').select('id',{count:'exact',head:true}).eq('store_id',storeId).eq('sector',s.sector).in('state',['pending','claimed','saved','uncertain','error']);if(pendingError)throw pendingError;if(count>0)throw new Error('Existem '+count+' trabalhos pendentes ou incertos neste setor. Reassocie ou resolva esses trabalhos antes de excluir a impressora.');const {error}=await client.from('print_sectors').delete().eq('store_id',storeId).eq('sector',s.sector);if(error)throw error;setSectors(old=>old.filter(x=>x.sector!==s.sector));if(editingSector?.sector===s.sector)setEditingSector(null)})}>Excluir</button><button disabled={busy} onClick={()=>act(async()=>{const {error}=await client.from('print_sectors').update({enabled:!s.enabled})",1)
marker="   {desktop&&<div className=\"panel\"><h3>Fila persistente"
addition="""   <div className="panel"><h3>Modelo HTML da comanda</h3><p>Modelo independente por loja neste computador. Campos: {'{{pedido}}'}, {'{{cliente}}'}, {'{{itens}}'}, {'{{total}}'}, {'{{observacoes}}'}. O conteúdo é convertido para texto ESC/POS; imagens e estilos não são enviados como HTML à impressora.</p><label className="field">HTML do cupom<textarea rows={10} spellCheck={false} value={templateHtml} onChange={e=>setTemplateHtml(e.target.value)} /></label><div className="quick-actions"><button type="button" onClick={()=>{localStorage.setItem('pitacco:receipt:'+storeId,templateHtml);setStatus('Modelo salvo neste computador para esta loja')}}>Salvar modelo</button><button type="button" className="secondary" onClick={()=>setTemplatePreview(x=>!x)}>Pré-visualizar</button><button type="button" className="secondary" onClick={()=>{const original='<h2>PITACCO</h2><p>Pedido: {{pedido}}</p><p>Cliente: {{cliente}}</p><p>{{itens}}</p><p>Total: {{total}}</p><p>{{observacoes}}</p>';setTemplateHtml(original);localStorage.setItem('pitacco:receipt:'+storeId,original)}}>Restaurar padrão</button></div>{templatePreview&&<iframe title="Prévia do cupom" sandbox="" style={{width:'100%',maxWidth:340,height:330,background:'#fff',border:'1px solid #ddd'}} srcDoc={templateHtml.replace(/{{pedido}}/g,'123').replace(/{{cliente}}/g,'Cliente exemplo').replace(/{{itens}}/g,'1 x Açaí 500ml').replace(/{{total}}/g,'R$ 25,00').replace(/{{observacoes}}/g,'Sem observações')}/>}</div>
"""
s=s.replace(marker,addition+marker,1)
p.write_text(s,encoding='utf-8')
p=Path('web/printBridge.mjs');s=p.read_text(encoding='utf-8')
needle=" if(typeof job.receipt_text==='string')return job.receipt_text.split('\\n')"
insertion=""" const html=typeof localStorage!=='undefined'&&job.store_id?localStorage.getItem('pitacco:receipt:'+job.store_id):null;
 if(html&&typeof DOMParser!=='undefined'&&!/<\\s*(script|iframe|object|embed|link|meta|img|svg|audio|video|form|base)\\b|\\bon\\w+\\s*=|(?:src|href)\\s*=|@import|url\\s*\\(/i.test(html)){
  const fields={pedido:r.number||r.order_number||r.order_id||job.order_id,cliente:r.customer||r.customer_name,itens:(Array.isArray(r.items)?r.items:[]).map(x=>x.quantity+' x '+x.name).join(' | '),total:'R$ '+money(r.total),observacoes:r.notes||''};
  const escapeHtml=value=>clean(value).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\"/g,'&quot;');\n  const filled=html.replace(/{{(pedido|cliente|itens|total|observacoes)}}/g,(_,key)=>escapeHtml(fields[key]));
  const doc=new DOMParser().parseFromString(filled,'text/html');
  doc.querySelectorAll('script,style,iframe,object,embed,svg,img').forEach(x=>x.remove());
  const text=doc.body.innerText||doc.body.textContent||'';
  return text.split('\\n').flatMap(line=>{const out=[];for(let i=0;i<line.length;i+=columns)out.push(clean(line.slice(i,i+columns)));return out.length?out:[''];}).join('\\n')+'\\n\\n';
 }
"""
s=s.replace(needle,insertion+needle,1);p.write_text(s,encoding='utf-8')
