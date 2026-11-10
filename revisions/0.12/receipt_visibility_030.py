from pathlib import Path
p=Path('web/Operations.jsx');s=p.read_text(encoding='utf-8')
start=s.index('<div className="panel"><h3>Modelo HTML da comanda</h3>')
end=s.index('   {desktop&&<div className="panel"><h3>Fila persistente',start)
replacement='''<div className="panel"><h3>Conteúdo da comanda</h3><p>Selecione o que aparece na impressão deste computador. As escolhas são independentes por loja.</p>{[['address','Endereço do cliente'],['phone','Telefone do cliente'],['notes','Observações'],['complements','Complementos']].map(([field,label])=><label key={field} className="field"><input type="checkbox" defaultChecked={JSON.parse(localStorage.getItem('pitacco:print-options:'+storeId)||'{}')[field]!==false} onChange={e=>{const key='pitacco:print-options:'+storeId;const next={...JSON.parse(localStorage.getItem(key)||'{}'),[field]:e.target.checked};localStorage.setItem(key,JSON.stringify(next));setStatus('Preferência de impressão salva neste computador')}}/> {label}</label>)}</div>
'''
s=s[:start]+replacement+s[end:]
p.write_text(s,encoding='utf-8')
p=Path('web/printBridge.mjs');s=p.read_text(encoding='utf-8')
start=s.index(" const html=typeof localStorage!=='undefined'&&job.store_id?")
end=s.index(" if(typeof job.receipt_text==='string')return job.receipt_text.split('\\n')",start)
replacement=""" const options=typeof localStorage!=='undefined'&&job.store_id?JSON.parse(localStorage.getItem('pitacco:print-options:'+job.store_id)||'{}'):{};
 const formatted=approvedReceipt(job,Number(job.width)===58?58:80,options);
 if(formatted)return formatted;
"""
s=s[:start]+replacement+s[end:]
p.write_text(s,encoding='utf-8')
