"""Move Windows new-order monitoring to native Tauri process, independent of WebView."""
from pathlib import Path
import os, base64, hashlib, subprocess, tempfile, wave, math, struct
# Original supplied recording, losslessly checked after transport; compressed Opus for source control.
if os.getenv("PITACCO_WEB_ONLY")!="1":
 source=base64.b64decode(Path("revisions/0.12/approved-incident-voice.opus.b64").read_text().strip(),validate=True)
 assert hashlib.sha256(source).hexdigest()=="4b75c73b7c917cf87b2c0d26ca4058722d9a3a26f336ccf615cb25a3487cb34a"
 with tempfile.TemporaryDirectory() as tmp:
  opus=Path(tmp)/"voice.opus";opus.write_bytes(source)
  pcm=Path(tmp)/"voice.wav"
  subprocess.run(["ffmpeg","-v","error","-y","-i",str(opus),"-ar","24000","-ac","1","-c:a","pcm_s16le",str(pcm)],check=True)
  with wave.open(str(pcm),"rb") as w:
   assert w.getnchannels()==1 and w.getsampwidth()==2 and w.getframerate()==24000
   frames=w.readframes(w.getnframes())
  rate=24000; samples=[]
  for i in range(int(rate*1.05)):
   t=i/rate;v=0
   for start,hz in [(0,740),(.28,988),(.56,740)]:
    x=t-start
    if 0<=x<.25:v+=.58*math.sin(2*math.pi*hz*x)*min(1,x/.014)*math.exp(-8*x)
   samples.append(int(max(-1,min(1,v))*32767))
  voice=struct.unpack("<"+"h"*(len(frames)//2),frames)
  peak=max(abs(x) for x in voice);assert peak>500
  gain=min(2.5,30000/peak)
  samples.extend(int(max(-30000,min(30000,x*gain))) for x in voice)
  with wave.open("web/src-tauri/src/incident-alert.wav","wb") as w:
   w.setparams((1,2,rate,0,"NONE","not compressed"));w.writeframes(struct.pack("<"+"h"*len(samples),*samples))
p=Path("web/src-tauri/src/main.rs")
s=p.read_text(encoding="utf-8")
anchor="notify_new_order,play_order_alert,play_order_bell,play_order_alert_combo"
assert s.count(anchor)==1, "Tauri registry changed"
s=s.replace(anchor,"notify_new_order,start_background_order_watch,stop_background_order_watch,update_background_order_sound,play_order_alert,play_order_bell,play_order_alert_combo",1)
rust=r'''
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
'''
assert "fn start_background_order_watch" not in s
p.write_text(s+"\n"+rust,encoding="utf-8")

cargo=Path("web/src-tauri/Cargo.toml")
c=cargo.read_text(encoding="utf-8")
assert c.count("[dependencies]")==1 and "reqwest = " not in c
c=c.replace("[dependencies]",'[dependencies]\nreqwest = { version = "0.12", default-features = false, features = ["blocking", "json", "rustls-tls"] }',1)
cargo.write_text(c,encoding="utf-8")
p=Path("web/Operations.jsx")
s=p.read_text(encoding="utf-8")
marker=" const observeOrders=useMemo(()=>newOrderTracker(storeId),[client,storeId,manager]);"
assert s.count(marker)==1,"Order watcher hook moved"
watch=r'''
 // Native process polls only IDs and survives minimized/suspended WebView.
 useEffect(()=>{
  if(!desktop||!manager||!storeId)return;
  let live=true;
  async function startWatch(){
   try{
    const {data,error}=await client.rpc('pitacco_windows_watch_start',{p_store:storeId});
    if(error)throw error;
    if(!live)return;
    await invoke('start_background_order_watch',{
     storeId,token:data,apiKey:client.supabaseKey,
     level:alertLevelRef.current,voiceLevel:voiceLevelRef.current,
     bell:bellChoiceRef.current
    });
   }catch(e){if(live)setError('Monitor de pedidos em segundo plano: '+(e.message||String(e)));}
  }
  void startWatch();
  const renew=()=>{if(live&&document.hasFocus())void startWatch()};
  window.addEventListener('focus',renew);
  return()=>{
   live=false;
   window.removeEventListener('focus',renew);
   void invoke('stop_background_order_watch',{storeId}).catch(()=>{});
   void client.rpc('pitacco_windows_watch_stop',{p_store:storeId}).catch(()=>{});
  };
 },[client,desktop,manager,storeId]);
 useEffect(()=>{
  if(!desktop||!manager||!storeId)return;
  void invoke('update_background_order_sound',{level:alertLevel,voiceLevel,bell:bellChoice}).catch(()=>{});
 },[desktop,manager,storeId,alertLevel,voiceLevel,bellChoice]);
'''
s=s.replace(marker,marker+"\n"+watch,1)
# Only focused WebView alerts; native worker covers unfocused/minimized.
a="     if(desktop){\n      void nativeOrderSound();"
b="     if(desktop){\n      if(document.hasFocus()){\n       void nativeOrderSound();"
assert s.count(a)==1,"Existing new-order audio event changed"
s=s.replace(a,b,1)
a="}).catch(()=>{});\n     }else if(audio.current?.state==='running'){"
b="}).catch(()=>{});\n      }\n     }else if(audio.current?.state==='running'){"
assert s.count(a)==1,"Existing native alert close changed"
s=s.replace(a,b,1)
p.write_text(s,encoding="utf-8")
print("Pitacco Windows: new orders monitored by native Tauri thread in background.")
