#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
mod queue;mod printer;
use std::{path::PathBuf,sync::Mutex,time::Duration};
use tauri::{Manager,menu::{Menu,MenuItem},tray::TrayIconBuilder};
use tauri_plugin_autostart::ManagerExt as AutostartExt;
use tauri_plugin_notification::NotificationExt;
struct State{path:PathBuf,active:Mutex<Option<String>>,device:String}
fn database(s:&State)->Result<rusqlite::Connection,String>{queue::open(&s.path)}
fn store(s:&State)->Result<String,String>{s.active.lock().map_err(|e|e.to_string())?.clone().ok_or("Selecione uma loja autenticada".into())}
#[tauri::command]
fn open_storefront(slug: String) -> Result<(), String> {
    let valid = (3..=60).contains(&slug.len())
        && !slug.starts_with('-')
        && slug.bytes().all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'-');
    if !valid {
        return Err("Endereço do cardápio inválido.".into());
    }
    #[cfg(windows)]
    {
        let address = format!("https://pitacco.com.br/{slug}");
        std::process::Command::new("explorer.exe")
            .arg(address)
            .spawn()
            .map(|_| ())
            .map_err(|_| "Não foi possível abrir o navegador.".into())
    }
    #[cfg(not(windows))]
    {
        Err("Disponível no Windows.".into())
    }
}
#[tauri::command]fn device_id(state:tauri::State<State>)->String{state.device.clone()}
#[tauri::command]fn set_active_store(state:tauri::State<State>,store_id:Option<String>)->Result<(),String>{if let Some(ref id)=store_id{uuid::Uuid::parse_str(id).map_err(|_|"Loja inválida")?;}*state.active.lock().map_err(|e|e.to_string())?=store_id;Ok(())}
#[tauri::command]fn enqueue_job(state:tauri::State<State>,job:queue::Job)->Result<(),String>{if store(&state)?!=job.store_id{return Err("Loja diferente da sessão ativa".into())}if job.receipt.starts_with("PITACCO_RASTER_V1:") && printer::raster_bytes(&job.receipt,job.width).is_none(){return Err("Imagem da comanda inválida".into())}queue::enqueue(&database(&state)?,&job)}
#[tauri::command]fn has_saved_print_job(state:tauri::State<State>,id:String,store_id:String,printer:String,width:u16)->Result<bool,String>{
 if store(&state)?!=store_id{return Err("Loja diferente da sessão ativa".into())}
 queue::has_saved(&database(&state)?,&id,&store_id,&printer,width)
}
#[tauri::command]fn list_jobs(state:tauri::State<State>)->Result<Vec<queue::JobState>,String>{queue::list(&database(&state)?,&store(&state)?)}
#[tauri::command]fn retry_job(state:tauri::State<State>,id:String)->Result<(),String>{queue::retry(&mut database(&state)?,&id,&store(&state)?)}
#[tauri::command]async fn test_printer(state:tauri::State<'_,State>,printer_name:String,width:u16,receipt:Option<String>)->Result<String,String>{
 let _=store(&state)?;
 if ![58,80].contains(&width){return Err("Largura inválida".into())}
 if printer_name.trim().is_empty()||printer_name.len()>256||printer_name.contains('\0'){return Err("Impressora inválida".into())}
 tauri::async_runtime::spawn_blocking(move||{
  let receipt=match receipt {
   Some(data)=>printer::raster_bytes(&data,width).ok_or_else(||"Imagem do teste inválida".to_string())?,
   None=>printer::receipt_bytes("PITACCO - TESTE DE IMPRESSAO\nImpressora configurada\nVerifique a largura e o corte\n",width)
  };
  printer::send(&printer_name,&receipt).map(|id|format!("Enviado ao spooler do Windows (trabalho {id}). Confira o papel; envio não garante impressão física.")).map_err(|e|e.message)
 }).await.map_err(|e|e.to_string())?
}
#[tauri::command]async fn list_printers()->Result<Vec<String>,String>{tauri::async_runtime::spawn_blocking(printer::printers).await.map_err(|e|e.to_string())?}
#[tauri::command]fn get_autostart(app:tauri::AppHandle)->Result<bool,String>{app.autolaunch().is_enabled().map_err(|e|e.to_string())}
#[tauri::command]fn set_autostart(app:tauri::AppHandle,enabled:bool)->Result<(),String>{if enabled{app.autolaunch().enable()}else{app.autolaunch().disable()}.map_err(|e|e.to_string())}
#[tauri::command]
fn notify_new_order(app:tauri::AppHandle,message:String)->Result<(),String>{
 app.notification().builder().title("Pitacco").body(message.chars().take(200).collect::<String>()).show().map_err(|e|e.to_string())
}
// A single professionally recorded, licensed announcement is stored locally.
// Never read files from arbitrary paths: only a validated RIFF PCM16 buffer
// imported through the desktop settings. Bell and voice levels stay separate.
#[cfg(windows)]
fn pitacco_voice_dir()->Result<std::path::PathBuf,String>{
 let root=std::env::var_os("LOCALAPPDATA").ok_or("LOCALAPPDATA indisponível")?;
 let path=std::path::PathBuf::from(root).join("Pitacco").join("NaturalVoice");
 std::fs::create_dir_all(&path).map_err(|e|e.to_string())?;
 Ok(path)
}
#[cfg(windows)]
fn pitacco_voice_payload(raw:&[u8])->Result<(usize,usize),String>{
 if raw.len()<46||raw.len()>4_000_000||&raw[0..4]!=b"RIFF"||&raw[8..12]!=b"WAVE"{
  return Err("A voz deve ser um WAV RIFF válido de até 4 MB.".into());
 }
 let mut cursor=12;let mut pcm16=false;let mut data=None;
 while cursor+8<=raw.len(){
  let size=u32::from_le_bytes(raw[cursor+4..cursor+8].try_into().unwrap()) as usize;
  let start=cursor+8;let end=start.checked_add(size).ok_or("WAV grande demais")?;
  if end>raw.len(){return Err("WAV incompleto".into());}
  if &raw[cursor..cursor+4]==b"fmt " && size>=16{
   let format=u16::from_le_bytes(raw[start..start+2].try_into().unwrap());
   let channels=u16::from_le_bytes(raw[start+2..start+4].try_into().unwrap());
   let rate=u32::from_le_bytes(raw[start+4..start+8].try_into().unwrap());
   let depth=u16::from_le_bytes(raw[start+14..start+16].try_into().unwrap());
   pcm16=format==1&&depth==16&&(channels==1||channels==2)&&(8000..=48000).contains(&rate);
  }
  if &raw[cursor..cursor+4]==b"data"{data=Some((start,end));}
  cursor=end+size%2;
 }
 if !pcm16{return Err("Use WAV PCM, 16 bits, 8–48 kHz, mono ou estéreo.".into());}
 let (a,b)=data.ok_or("Áudio WAV vazio")?;
 if b-a<2048||(b-a)%2!=0{return Err("Dados de voz incompletos.".into());}
 Ok((a,b))
}
#[tauri::command]
fn save_order_voice(audio_data:Vec<u8>)->Result<(),String>{
 #[cfg(windows)]
 {
  let (start,end)=pitacco_voice_payload(&audio_data)?;
  let folder=pitacco_voice_dir()?;
  // NORMAL uses the exact original PCM data. No gain, normalization, limiting, or changes.
  // Alternative higher levels are generated only for explicit future user choice.
  for (level,gain) in [(1u8,1.0f64),(2u8,1.5f64),(3u8,2.0f64)]{
   let mut bytes=audio_data.clone();
   if level!=1 {
    for offset in (start..end).step_by(2){
     let x=i16::from_le_bytes([bytes[offset],bytes[offset+1]]) as f64/32768.0;
     let limited=32760.0*(x*gain).tanh();
     let y=(limited.round() as i16).to_le_bytes();
     bytes[offset]=y[0];bytes[offset+1]=y[1];
    }
   }
   let file=folder.join(format!("voice-level-{}.wav",level));
   // Replace atomically when possible to avoid half-written audio.
   let tmp=folder.join(format!("voice-level-{}-new.wav",level));
   std::fs::write(&tmp,&bytes).map_err(|e|e.to_string())?;
   if file.exists(){std::fs::remove_file(&file).map_err(|e|e.to_string())?;}
   std::fs::rename(&tmp,&file).map_err(|e|e.to_string())?;
  }
  Ok(())
 }
 #[cfg(not(windows))]
 {let _=audio_data;Err("A voz nativa só está disponível no Windows.".into())}
}
#[tauri::command]
fn order_voice_status()->Result<bool,String>{
 #[cfg(windows)]{Ok(true)}
 #[cfg(not(windows))]{Ok(false)}
}

#[tauri::command]
fn play_order_voice(level:Option<u8>)->Result<(),String>{
 #[cfg(windows)]{
  #[link(name="winmm")]
  extern "system" {fn PlaySoundA(sound:*const u8,module:*mut std::ffi::c_void,flags:u32)->i32;}
  let selected=match level.unwrap_or(1){1=>1,2=>2,_=>3};
  let bytes=merchant_voice_bytes(selected);
  let result=unsafe{PlaySoundA(bytes.as_ptr(),std::ptr::null_mut(),0x0004|0x0001|0x0002)};
  if result!=0{Ok(())}else{Err("Não foi possível reproduzir a gravação oficial.".into())}
 }
 #[cfg(not(windows))]{let _=level;Err("Voz oficial disponível no Windows.".into())}
}
// Only five authored Pitacco bells are selectable. All files are embedded
// directly in the signed executable, and no Windows computer imports audio.
#[cfg(windows)]
fn merchant_bell_bytes(name:&str,level:u8)->&'static [u8]{
 static ORIGINAL_1:&[u8]=include_bytes!("order-alert-soft.wav");
 static ORIGINAL_2:&[u8]=include_bytes!("order-alert-high.wav");
 static ORIGINAL_3:&[u8]=include_bytes!("order-alert.wav");
 static MODERNO_1:&[u8]=include_bytes!("order-bell-moderno-1.wav");
 static MODERNO_2:&[u8]=include_bytes!("order-bell-moderno-2.wav");
 static MODERNO_3:&[u8]=include_bytes!("order-bell-moderno-3.wav");
 static CLASSICO_1:&[u8]=include_bytes!("order-bell-classico-1.wav");
 static CLASSICO_2:&[u8]=include_bytes!("order-bell-classico-2.wav");
 static CLASSICO_3:&[u8]=include_bytes!("order-bell-classico-3.wav");
 static DUPLO_1:&[u8]=include_bytes!("order-bell-duplo-1.wav");
 static DUPLO_2:&[u8]=include_bytes!("order-bell-duplo-2.wav");
 static DUPLO_3:&[u8]=include_bytes!("order-bell-duplo-3.wav");
 static INTENSO_1:&[u8]=include_bytes!("order-bell-intenso-1.wav");
 static INTENSO_2:&[u8]=include_bytes!("order-bell-intenso-2.wav");
 static INTENSO_3:&[u8]=include_bytes!("order-bell-intenso-3.wav");
 match (name,level){
  ("moderno",1)=>MODERNO_1,("moderno",2)=>MODERNO_2,("moderno",_)=>MODERNO_3,
  ("classico",1)=>CLASSICO_1,("classico",2)=>CLASSICO_2,("classico",_)=>CLASSICO_3,
  ("duplo",1)=>DUPLO_1,("duplo",2)=>DUPLO_2,("duplo",_)=>DUPLO_3,
  ("intenso",1)=>INTENSO_1,("intenso",2)=>INTENSO_2,("intenso",_)=>INTENSO_3,
  (_,1)=>ORIGINAL_1,(_,2)=>ORIGINAL_2,(_,_)=>ORIGINAL_3
 }
}
#[cfg(windows)]
fn merchant_voice_bytes(level:u8)->&'static [u8]{
 static VOICE_1:&[u8]=include_bytes!("order-merchant-voice-1.wav");
 static VOICE_2:&[u8]=include_bytes!("order-merchant-voice-2.wav");
 static VOICE_3:&[u8]=include_bytes!("order-merchant-voice-3.wav");
 match level{1=>VOICE_1,2=>VOICE_2,_=>VOICE_3}
}
#[tauri::command]
fn play_order_bell(level:Option<u8>,bell:Option<String>)->Result<(),String>{
 #[cfg(windows)]{
  let name=bell.unwrap_or_else(||"original".into());
  #[link(name="winmm")]
  extern "system" {fn PlaySoundA(sound:*const u8,module:*mut std::ffi::c_void,flags:u32)->i32;}
  let bytes=merchant_bell_bytes(&name,level.unwrap_or(3));
  let played=unsafe{PlaySoundA(bytes.as_ptr(),std::ptr::null_mut(),0x0004|0x0001|0x0002)};
  if played!=0{Ok(())}else{Err("Não foi possível tocar o sino do Pitacco.".into())}
 }
 #[cfg(not(windows))]{let _=(level,bell);Err("Sino nativo disponível no Windows.".into())}
}
#[tauri::command]
fn play_order_alert_combo(level:Option<u8>,voice_level:Option<u8>,bell:Option<String>)->Result<(),String>{
 #[cfg(windows)]{
  let name=bell.unwrap_or_else(||"original".into());
  let bell_wav=merchant_bell_bytes(&name,level.unwrap_or(3));
  let voice_wav=merchant_voice_bytes(voice_level.unwrap_or(3));
  std::thread::spawn(move ||{
   #[link(name="winmm")]
   extern "system" {fn PlaySoundA(sound:*const u8,module:*mut std::ffi::c_void,flags:u32)->i32;}
   // SND_MEMORY | SND_NODEFAULT; synchronous playback on worker thread
   // guarantees the same fixed recorded voice plays after the selected bell.
   let played=unsafe{PlaySoundA(bell_wav.as_ptr(),std::ptr::null_mut(),0x0004|0x0002)};
   if played!=0{
    let _=unsafe{PlaySoundA(voice_wav.as_ptr(),std::ptr::null_mut(),0x0004|0x0002)};
   }
  });
  Ok(())
 }
 #[cfg(not(windows))]{let _=(level,voice_level,bell);Err("Alertas exigem Windows.".into())}
}
#[tauri::command]
fn play_order_alert(level:Option<u8>)->Result<(),String>{
 #[cfg(windows)]
 {
  #[link(name="winmm")]
  extern "system" {fn PlaySoundA(sound:*const u8,module:*mut std::ffi::c_void,flags:u32)->i32;}
  static SOFT:&[u8]=include_bytes!("order-alert-soft.wav");
  static HIGH:&[u8]=include_bytes!("order-alert-high.wav");
  static MAX:&[u8]=include_bytes!("order-alert.wav");
  let audio=match level.unwrap_or(3){1=>SOFT,2=>HIGH,_=>MAX};
  // Memory playback is asynchronous. Embedded bytes live for the process lifetime.
  let played=unsafe{PlaySoundA(audio.as_ptr(),std::ptr::null_mut(),0x0004|0x0001|0x0002)};
  if played!=0{Ok(())}else{Err("O áudio de pedidos do Windows não pôde ser reproduzido.".into())}
 }
 #[cfg(not(windows))]
 {Err("O alerta nativo é exclusivo do Windows.".into())}
}
#[tauri::command]fn notify(app:tauri::AppHandle,message:String)->Result<(),String>{
 #[cfg(windows)]unsafe{#[link(name="user32")]unsafe extern "system"{fn MessageBeep(kind:u32)->i32;}MessageBeep(0x40);}
 app.notification().builder().title("Pitacco").body(message.chars().take(200).collect::<String>()).show().map_err(|e|e.to_string())
}
#[tauri::command]async fn check_update(app:tauri::AppHandle)->Result<String,String>{
 use tauri_plugin_updater::UpdaterExt;
 let updater=app.updater().map_err(|_|"Atualizações não configuradas pelo distribuidor".to_string())?;
 if let Some(update)=updater.check().await.map_err(|e|e.to_string())?{
   // Only explicit user request invokes this command. Plugin verifies signed bundle.
   let reopen_marker=app.path().app_local_data_dir().map_err(|e|e.to_string())?.join("show-after-update");
   std::fs::write(&reopen_marker,b"1").map_err(|e|e.to_string())?;
   if let Err(e)=update.restart_after_install(true).download_and_install(|_,_|{},||{}).await {
    let _=std::fs::remove_file(&reopen_marker);
    return Err(e.to_string());
   }
   Ok("Atualização instalada. O Pitacco será reaberto automaticamente.".into())
 }else{Ok("Nenhuma atualização disponível".into())}
}
fn worker(app:tauri::AppHandle){std::thread::spawn(move||loop{
 std::thread::sleep(Duration::from_secs(2));let s=app.state::<State>();let Ok(active)=store(&s)else{continue};let Ok(mut db)=database(&s)else{let _=notify(app.clone(),"Falha ao abrir fila local. Verifique espaço e permissões.".into());continue};
 let job=match queue::claim(&mut db,&active){Ok(Some(j))=>j,Ok(None)=>continue,Err(e)=>{let _=notify(app.clone(),format!("Falha na fila: {e}"));continue}};
 let result=printer::send(&job.printer,&printer::receipt_bytes(&job.receipt,job.width));
 let done=match result{Ok(id)=>queue::finish(&db,&job.id,"submitted",None,Some(id)),Err(e)=>{let status=if e.uncertain{"uncertain"}else{"error"};let saved=queue::finish(&db,&job.id,status,Some(&e.message),None);let _=notify(app.clone(),format!("Falha de impressão: {}",e.message));saved}};
 if done.is_err(){// A durable 'printing' record must not be resent after a save error.
 let _=notify(app.clone(),"Não foi possível salvar o resultado da impressão. Reinicie e confira a fila antes de reimprimir.".into());}
});}
fn main(){tauri::Builder::default()
 .plugin(tauri_plugin_single_instance::init(|app,_,_|{if let Some(w)=app.get_webview_window("main"){let _=w.show();let _=w.set_focus();}}))
 .plugin(tauri_plugin_autostart::init(tauri_plugin_autostart::MacosLauncher::LaunchAgent,Some(vec!["--minimized"])))
 .plugin(tauri_plugin_notification::init()).plugin(tauri_plugin_updater::Builder::new().build())
 .invoke_handler(tauri::generate_handler![open_storefront,device_id,set_active_store,enqueue_job,has_saved_print_job,list_jobs,retry_job,list_printers,test_printer,get_autostart,set_autostart,notify,notify_new_order,start_background_order_watch,stop_background_order_watch,update_background_order_sound,play_order_alert,play_order_bell,play_order_alert_combo,save_order_voice,play_order_voice,order_voice_status,check_update])
 .setup(|app|{
 let dir=app.path().app_local_data_dir()?;std::fs::create_dir_all(&dir)?;let path=dir.join("print-queue.sqlite3");
 let db=queue::open(&path).map_err(std::io::Error::other)?;queue::recover(&db).map_err(std::io::Error::other)?;
 db.execute("INSERT OR IGNORE INTO meta(key,value) VALUES('device',?)",[uuid::Uuid::new_v4().to_string()])?;
 let device:String=db.query_row("SELECT value FROM meta WHERE key='device'",[],|r|r.get(0))?;
 app.manage(State{path,active:Mutex::new(None),device});
 let open=MenuItem::with_id(app,"open","Abrir Pitacco",true,None::<&str>)?;
 let exit=MenuItem::with_id(app,"exit","Sair (pausar impressão)",true,None::<&str>)?;
 let menu=Menu::with_items(app,&[&open,&exit])?;
 let icon=app.default_window_icon().ok_or_else(||std::io::Error::other("Ícone ausente"))?.clone();
 TrayIconBuilder::new().icon(icon).tooltip("Pitacco — pedidos e impressão").menu(&menu).on_menu_event(|app,event|match event.id.as_ref(){"open"=>{if let Some(w)=app.get_webview_window("main"){let _=w.show();let _=w.set_focus();}},"exit"=>app.exit(0),_=>{}}).build(app)?;
 let reopen_marker=dir.join("show-after-update");
 let explicit_reopen=std::fs::remove_file(&reopen_marker).is_ok();
 let version_marker=dir.join("last-started-version");
 let current_version=app.package_info().version.to_string();
 let changed_version=std::fs::read_to_string(&version_marker).ok().as_deref()!=Some(current_version.as_str());
 let _=std::fs::write(&version_marker,current_version.as_bytes());
 let reopen=explicit_reopen||changed_version;
 if reopen{if let Some(w)=app.get_webview_window("main"){w.show()?;let _=w.set_focus();}}
 else if std::env::args().any(|a|a=="--minimized"){if let Some(w)=app.get_webview_window("main"){w.hide()?;}}
 worker(app.handle().clone());Ok(())
 })
 .on_window_event(|window,event|{if let tauri::WindowEvent::CloseRequested{api,..}=event{api.prevent_close();let _=window.hide();}})
 .run(tauri::generate_context!()).expect("Falha ao iniciar Pitacco");}


struct PitaccoBackgroundAudio {
 token:String,api_key:String,level:u8,voice_level:u8,bell:String,
}
struct PitaccoBackgroundWatcher{
 store:String,
 stop:std::sync::Arc<std::sync::atomic::AtomicBool>,
 audio:std::sync::Arc<std::sync::Mutex<PitaccoBackgroundAudio>>,
}
static PITACCO_BACKGROUND_WATCH:std::sync::OnceLock<std::sync::Mutex<Option<PitaccoBackgroundWatcher>>> =
 std::sync::OnceLock::new();

#[tauri::command]
fn start_background_order_watch(
 app:tauri::AppHandle,store_id:String,token:String,api_key:String,
 level:Option<u8>,voice_level:Option<u8>,bell:Option<String>
)->Result<(),String>{
 use std::sync::{Arc,Mutex};
 use std::sync::atomic::{AtomicBool,Ordering};
 if store_id.len()!=36||!store_id.chars().all(|c|c.is_ascii_hexdigit()||c=='-')
  ||token.len()!=64||!token.chars().all(|c|c.is_ascii_hexdigit())
  ||api_key.len()<20||api_key.len()>2048{
  return Err("Configuração do monitor de pedidos inválida".into());
 }
 let choice=bell.unwrap_or_else(||"original".into());
 let choice=if ["original","moderno","classico","duplo","intenso"].contains(&choice.as_str()){
  choice
 }else{"original".into()};
 let config=PitaccoBackgroundAudio{token,api_key,level:level.unwrap_or(3).clamp(1,3),
  voice_level:voice_level.unwrap_or(3).clamp(1,3),bell:choice};
 let state=PITACCO_BACKGROUND_WATCH.get_or_init(||Mutex::new(None));
 let mut guard=state.lock().map_err(|_|"Monitor indisponível".to_string())?;
 if let Some(existing)=guard.as_mut(){
  if existing.store==store_id&&!existing.stop.load(Ordering::SeqCst){
   *existing.audio.lock().map_err(|_|"Monitor indisponível".to_string())?=config;
   return Ok(());
  }
  existing.stop.store(true,Ordering::SeqCst);
 }
 let stop=Arc::new(AtomicBool::new(false));
 let audio=Arc::new(Mutex::new(config));
 let watcher=PitaccoBackgroundWatcher{store:store_id,stop:stop.clone(),audio:audio.clone()};
 std::thread::spawn(move||{
  use tauri::Manager;
  use std::collections::HashSet;
  let client=match reqwest::blocking::Client::builder()
   .timeout(std::time::Duration::from_secs(9)).build(){
    Ok(c)=>c,Err(_)=>return
  };
  let endpoint="https://mdevzehqcpcgxspwbiyz.supabase.co/rest/v1/rpc/pitacco_windows_watch_poll";
  let mut initialized=false;
  let mut seen:HashSet<String>=HashSet::new();
  let mut warned=false;
  let mut incident_seen:HashSet<String>=HashSet::new();
  let mut incident_last:Option<std::time::Instant>=None;
  while !stop.load(Ordering::SeqCst){
   let cfg=match audio.lock(){Ok(z)=>PitaccoBackgroundAudio{
    token:z.token.clone(),api_key:z.api_key.clone(),
    level:z.level,voice_level:z.voice_level,bell:z.bell.clone()
   },Err(_)=>break};
   let response=client.post(endpoint).header("apikey",&cfg.api_key)
    .header("cache-control","no-store")
    .json(&serde_json::json!({"p_token":cfg.token})).send();
   if let Ok(response)=response{
    if response.status()==reqwest::StatusCode::UNAUTHORIZED||
       response.status()==reqwest::StatusCode::FORBIDDEN{
     if !warned{
      let _=notify_new_order(app.clone(),
       "Monitor de pedidos expirou; abra o Pitacco para renovar a sessão.".into());
      warned=true;
     }
    }else if response.status().is_success(){
     warned=false;
     if let Ok(data)=response.json::<serde_json::Value>(){
      if let Some(rows)=data.as_array(){
       let current:HashSet<String>=rows.iter().filter_map(|o|o.get("id")
        .and_then(|id|id.as_str()).map(str::to_owned)).collect();
       if initialized{
        let fresh=current.iter().filter(|id|!seen.contains(*id)).count();
        if fresh>0{
         // Focused WebView plays the existing approved audio. Native process
         // plays ONLY while unfocused/minimized to avoid duplicate alerts.
         let focused=app.get_webview_window("main")
          .and_then(|w|w.is_focused().ok()).unwrap_or(false);
         if !focused{
          let _=play_order_alert_combo(Some(cfg.level),Some(cfg.voice_level),Some(cfg.bell));
          let msg=if fresh==1{"Você tem um novo pedido.".to_string()}
           else{format!("Você tem {} novos pedidos.",fresh)};
          let _=notify_new_order(app.clone(),msg);
         }
        }
       }
       initialized=true;
       seen.extend(current);
      }
     }
    }
   }
   // Separate authenticated feed leaves the old order watcher contract unchanged.
   if !stop.load(Ordering::SeqCst){
    let incident_url="https://mdevzehqcpcgxspwbiyz.supabase.co/rest/v1/rpc/pitacco_windows_incident_poll";
    if let Ok(r)=client.post(incident_url).header("apikey",&cfg.api_key).header("cache-control","no-store")
     .json(&serde_json::json!({"p_token":cfg.token})).send(){
     if r.status().is_success(){
      if let Ok(rows)=r.json::<Vec<serde_json::Value>>(){
       let current:HashSet<String>=rows.iter().filter_map(|x|x.get("id").and_then(|id|id.as_str()).map(str::to_owned)).collect();
       if current.is_empty(){incident_last=None;}
       else if current.iter().any(|id|!incident_seen.contains(id))||incident_last.map(|t|t.elapsed().as_secs()>=30).unwrap_or(true){
        incident_last=Some(std::time::Instant::now());
        #[cfg(windows)]{
         static INCIDENT_AUDIO:&[u8]=include_bytes!("incident-alert.wav");
         #[link(name="winmm")]
         extern "system" {fn PlaySoundA(sound:*const u8,module:*mut std::ffi::c_void,flags:u32)->i32;}
         // SND_NOSTOP prevents an incident interrupting an order chime. Retry on next poll.
         let played=unsafe{PlaySoundA(INCIDENT_AUDIO.as_ptr(),std::ptr::null_mut(),0x0004|0x0002|0x0010|0x0001)};
         if played==0{incident_last=None;}
        }
        let _=notify_new_order(app.clone(),"Atenção! Ocorrência na entrega. Abra a Central de Ocorrências.".into());
       }
       incident_seen=current;
      }
     }
    }
   }
   for _ in 0..12{
    if stop.load(Ordering::SeqCst){break;}
    std::thread::sleep(std::time::Duration::from_millis(500));
   }
  }
 });
 *guard=Some(watcher);
 Ok(())
}

#[tauri::command]
fn update_background_order_sound(level:Option<u8>,voice_level:Option<u8>,bell:Option<String>)->Result<(),String>{
 let Some(state)=PITACCO_BACKGROUND_WATCH.get() else{return Ok(())};
 let guard=state.lock().map_err(|_|"Monitor indisponível".to_string())?;
 if let Some(active)=guard.as_ref(){
  let mut cfg=active.audio.lock().map_err(|_|"Monitor indisponível".to_string())?;
  cfg.level=level.unwrap_or(3).clamp(1,3);
  cfg.voice_level=voice_level.unwrap_or(3).clamp(1,3);
  let c=bell.unwrap_or_else(||"original".into());
  cfg.bell=if ["original","moderno","classico","duplo","intenso"].contains(&c.as_str()){
   c
  }else{"original".into()};
 }
 Ok(())
}
#[tauri::command]
fn stop_background_order_watch(store_id:String)->Result<(),String>{
 let Some(state)=PITACCO_BACKGROUND_WATCH.get() else{return Ok(())};
 let mut guard=state.lock().map_err(|_|"Monitor indisponível".to_string())?;
 if guard.as_ref().map(|w|w.store.as_str())==Some(store_id.as_str()){
  if let Some(old)=guard.take(){old.stop.store(true,std::sync::atomic::Ordering::SeqCst);}
 }
 Ok(())
}
