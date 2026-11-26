"""Apply signed startup updates before the operational workspace mounts."""
from pathlib import Path
def patch(path,old,new):
 p=Path(path);s=p.read_text(encoding='utf-8')
 assert s.count(old)==1, f'{path}: expected one anchor: {old[:100]}'
 p.write_text(s.replace(old,new,1),encoding='utf-8')
p=Path('web/src-tauri/src/main.rs')
s=p.read_text(encoding='utf-8')
start=s.index('#[tauri::command]async fn check_update(app:tauri::AppHandle)->Result<String,String>{')
end=s.index('\nfn worker(',start)
s=s[:start]+r'''// All install entrypoints share a process-wide lease. A failed check releases it.
use std::sync::atomic::{AtomicBool,Ordering};
static UPDATE_IN_PROGRESS:AtomicBool=AtomicBool::new(false);
static STARTUP_UPDATE_ATTEMPTED:AtomicBool=AtomicBool::new(false);
struct UpdateLease;
impl UpdateLease{
 fn acquire()->Result<Self,String>{
  UPDATE_IN_PROGRESS.compare_exchange(false,true,Ordering::AcqRel,Ordering::Acquire)
   .map(|_|Self).map_err(|_|"Já existe uma verificação de atualização em andamento.".into())
 }
}
impl Drop for UpdateLease{fn drop(&mut self){UPDATE_IN_PROGRESS.store(false,Ordering::Release);}}
fn update_guard(app:&tauri::AppHandle,startup:bool)->Result<(),String>{
 let state=app.state::<State>();
 if startup&&state.active.lock().map_err(|e|e.to_string())?.is_some(){
  return Err("Atualização automática adiada: operação ativa.".into());
 }
 let db=database(&state)?;
 let queued:i64=db.query_row("SELECT count(*) FROM jobs WHERE state IN ('queued','printing')",[],|row|row.get(0)).map_err(|e|e.to_string())?;
 if queued>0{return Err("Há impressões em andamento. Aguarde a fila terminar para atualizar.".into());}
 Ok(())
}
async fn install_signed_update(app:tauri::AppHandle,startup:bool)->Result<String,String>{
 use tauri_plugin_updater::UpdaterExt;
 let _lease=UpdateLease::acquire()?;
 update_guard(&app,startup)?;
 let updater=app.updater_builder().timeout(Duration::from_secs(5)).build().map_err(|e|e.to_string())?;
 if let Some(mut update)=updater.check().await.map_err(|e|e.to_string())?{
  // Download verifies the configured signature before returning the bytes.
  update.timeout=Some(Duration::from_secs(45));
  let bytes=update.download(|_,_|{},||{}).await.map_err(|e|e.to_string())?;
  // A print job may have appeared during download; never use a stale gate.
  update_guard(&app,startup)?;
  let reopen_marker=app.path().app_local_data_dir().map_err(|e|e.to_string())?.join("show-after-update");
  std::fs::write(&reopen_marker,b"1").map_err(|e|e.to_string())?;
  if let Err(e)=update.restart_after_install(true).install(bytes){
   let _=std::fs::remove_file(&reopen_marker);
   return Err(e.to_string());
  }
  Ok("Atualização instalada. O Pitacco será reaberto automaticamente.".into())
 }else{Ok("Nenhuma atualização disponível".into())}
}
#[tauri::command]async fn check_update(app:tauri::AppHandle)->Result<String,String>{
 install_signed_update(app,false).await
}
#[tauri::command]async fn startup_update(app:tauri::AppHandle)->Result<String,String>{
 // Only one automatic installation attempt per process; never interrupt a selected store.
 if STARTUP_UPDATE_ATTEMPTED.swap(true,Ordering::AcqRel){return Ok("Verificação inicial já realizada.".into());}
 install_signed_update(app,true).await
}
#[tauri::command]async fn check_update_available(app:tauri::AppHandle)->Result<Option<String>,String>{
 use tauri_plugin_updater::UpdaterExt;
 let _lease=UpdateLease::acquire()?;
 let updater=app.updater_builder().timeout(Duration::from_secs(5)).build().map_err(|e|e.to_string())?;
 // Polling is intentionally read-only: no download, install or restart.
 Ok(updater.check().await.map_err(|e|e.to_string())?.map(|u|u.version.to_string()))
}
'''+s[end:]
assert s.count('order_voice_status,check_update]')==1
s=s.replace('order_voice_status,check_update]','order_voice_status,check_update,startup_update,check_update_available]',1)
p.write_text(s,encoding='utf-8')
patch('web/src.jsx',"import {nativeAvailable} from './printBridge.mjs';","import {nativeAvailable,invoke as invokeWindowsUpdate} from './printBridge.mjs';\nimport {runWindowsStartupUpdate} from './windowsAutoUpdate.mjs';")
patch('web/src.jsx',"createRoot(document.getElementById('root')).render(<WorkspaceBoundary><App/></WorkspaceBoundary>);",'''// A cold-start update completes or fails safely before mounting order/print effects.
function WindowsStartupGate(){
 const [ready,setReady]=useState(!nativeAvailable());
 useEffect(()=>{
  if(!nativeAvailable())return;
  let live=true;
  runWindowsStartupUpdate(true,invokeWindowsUpdate).finally(()=>{if(live)setReady(true)});
  return()=>{live=false};
 },[]);
 if(!ready)return <div className="setup" role="status"><img className="auth-logo" src="/pitacco-brand-013.svg" alt="Pitacco"/><h2>Verificando atualizações</h2><p>O Pitacco verifica a versão assinada antes de abrir a operação. Se não houver conexão, o aplicativo continuará normalmente.</p></div>;
 return <App/>;
}
createRoot(document.getElementById('root')).render(<WorkspaceBoundary><WindowsStartupGate/></WorkspaceBoundary>);''')
