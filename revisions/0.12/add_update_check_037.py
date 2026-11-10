"""Expose real native update-check feedback without claiming installation is available."""
from pathlib import Path
p=Path('web/Operations.jsx')
s=p.read_text(encoding='utf-8')
needle="const [settingsTab,setSettingsTab]=useState('Impressoras')"
assert s.count(needle)==1
s=s.replace(needle,"const [updateCheck,setUpdateCheck]=useState({state:'idle',message:''});\n "+needle,1)
needle=" async function saveMode(source,mode,enabled)"
assert s.count(needle)==1
fn=""" async function checkForUpdates(){
  setUpdateCheck({state:'checking',message:'Consultando atualizações assinadas…'});
  try{
   if(!desktop)throw Error('A verificação nativa está disponível somente no aplicativo Windows.');
   const result=await invoke('check_update');
   const message=typeof result==='string'?result:result==null?'A verificação terminou, mas não retornou detalhes da versão.':JSON.stringify(result);
   setUpdateCheck({state:'done',message});
  }catch(e){setUpdateCheck({state:'error',message:String(e?.message||e)})}
 }
"""
s=s.replace(needle,fn+needle,1)
needle="""<button className="secondary" disabled={busy} onClick={()=>act(async()=>{const result=await invoke('check_update');setStatus(String(result||'Verificação concluída.'))})}>Verificar atualização assinada</button>"""
assert s.count(needle)==1
s=s.replace(needle,"""<button className="secondary" disabled={busy||updateCheck.state==='checking'} onClick={checkForUpdates}>{updateCheck.state==='checking'?'Verificando…':'Verificar atualizações'}</button>""",1)
needle="<p>Ao fechar a janela, o Pitacco permanece na bandeja do Windows.</p>"
assert s.count(needle)==1
s=s.replace(needle,"""{updateCheck.state!=='idle'&&<p role="status" className={updateCheck.state==='error'?'notice error':'notice'}>{updateCheck.message}</p>}<p className="hint">A instalação com um clique será habilitada somente após configurar o atualizador Tauri e validar a assinatura digital. Esta verificação não instala arquivos.</p>"""+needle,1)
p.write_text(s,encoding='utf-8')
