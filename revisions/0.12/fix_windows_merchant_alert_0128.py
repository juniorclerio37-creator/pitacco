"""Restore the approved merchant bell + natural-voice sequence in native Windows.

The full bell and imported natural voice run on a dedicated Windows thread so
the second sound is not delayed by WebView background timer throttling.
Existing voice files in LOCALAPPDATA survive signed in-app updates.
"""
from pathlib import Path

p=Path("web/Operations.jsx")
s=p.read_text(encoding="utf-8")
def exactly_one(old,new):
 global s
 assert s.count(old)==1, f"Expected one merchant alert anchor, got {s.count(old)}: {old[:100]}"
 s=s.replace(old,new,1)

exactly_one(
 " const [voiceReady,setVoiceReady]=useState(false);",
 """ const [voiceReady,setVoiceReady]=useState(false);
 // Keep the order subscription stable while its alert settings change.
 // Otherwise the original polling callback closes over voiceReady=false,
 // and a real incoming order never plays the merchant's recorded voice.
 const alertLevelRef=useRef(alertLevel),voiceLevelRef=useRef(voiceLevel),voiceReadyRef=useRef(voiceReady);
 alertLevelRef.current=alertLevel;voiceLevelRef.current=voiceLevel;voiceReadyRef.current=voiceReady;"""
)
exactly_one(
 """async function naturalVoiceOnly(){
  try {
   await invoke('play_order_voice',{level:voiceLevel});""",
 """async function naturalVoiceOnly(){
  try {
   await invoke('play_order_voice',{level:voiceLevelRef.current});"""
)
old="""async function nativeOrderSound(){
  try{
   await invoke('play_order_alert',{level:alertLevel});
   setSoundMessage('');
   // Native bell remains unchanged. Natural WAV plays only after the bell.
   window.setTimeout(()=>{if(voiceReady)void naturalVoiceOnly()},2450);
  }catch{
   setSoundMessage('O sino do Windows está indisponível. Confira o áudio do computador.');
   window.setTimeout(()=>{if(voiceReady)void naturalVoiceOnly()},100);
  }
 }"""
new="""async function nativeOrderSound(onlyBell=false){
  try{
   if(onlyBell){
    await invoke('play_order_alert',{level:alertLevelRef.current});
   }else{
    // Windows plays the approved 2.38 s bell first, then the natural
    // offline WAV on a native worker thread (no throttled JS timeout).
    await invoke('play_order_alert_combo',{
     level:alertLevelRef.current,voiceLevel:voiceLevelRef.current
    });
   }
   setSoundMessage(onlyBell?'Teste do sino enviado ao Windows.':voiceReadyRef.current
    ?'Teste do sino e da voz enviado ao Windows.'
    :'Sino acionado. Importe a voz natural original abaixo para ouvir também o anúncio.');
  }catch(error){
   setSoundMessage('Falha ao reproduzir o alerta do Windows: '+String(error));
  }
 }"""
exactly_one(old,new)
exactly_one(
 """{manager&&['Painel','Pedidos'].includes(view)&&(desktop?<div className="dispatch-actions">
   <button type="button" className="secondary" onClick={()=>void nativeOrderSound()}>Testar alerta de pedido</button>""",
 """{manager&&['Painel','Pedidos','Configurações','Alertas'].includes(view)&&(desktop?<div className="dispatch-actions" aria-label="Alertas sonoros do Pitacco Windows">
   <strong>Alerta de novo pedido — sino e voz natural</strong>
   <button type="button" className="secondary" onClick={()=>void nativeOrderSound()}>Testar sino e voz</button>
   <button type="button" className="secondary" onClick={()=>void nativeOrderSound(true)}>Testar somente sino</button>"""
)
p.write_text(s,encoding="utf-8")

# Preserve the existing embedded bell command for diagnostics and earlier
# Windows installs. Add a separate native, uninterrupted bell+voice sequence.
p=Path("web/src-tauri/src/main.rs")
s=p.read_text(encoding="utf-8")
needle='#[tauri::command]\nfn play_order_alert(level:Option<u8>)->Result<(),String>{'
assert s.count(needle)==1, "Existing Windows bell must remain unchanged"
combo=r'''// The alert is played on a native thread, independent of WebView timer
// throttling when the window is minimized to the system tray.
#[tauri::command]
fn play_order_alert_combo(level:Option<u8>,voice_level:Option<u8>)->Result<(),String>{
 #[cfg(windows)]
 {
  let selected=match level.unwrap_or(3){1=>1,2=>2,_=>3};
  let selected_voice=match voice_level.unwrap_or(3){1=>1,2=>2,_=>3};
  let voice_path=pitacco_voice_dir()?.join(format!("voice-level-{}.wav",selected_voice));
  std::thread::spawn(move ||{
   #[link(name="winmm")]
   extern "system" {
    fn PlaySoundA(sound:*const u8,module:*mut std::ffi::c_void,flags:u32)->i32;
    fn PlaySoundW(sound:*const u16,module:*mut std::ffi::c_void,flags:u32)->i32;
   }
   static SOFT:&[u8]=include_bytes!("order-alert-soft.wav");
   static HIGH:&[u8]=include_bytes!("order-alert-high.wav");
   static MAX:&[u8]=include_bytes!("order-alert.wav");
   let bell=match selected{1=>SOFT,2=>HIGH,_=>MAX};
   // SND_MEMORY + SND_NODEFAULT without SND_ASYNC => synchronous bell,
   // but only inside this background thread (never blocks app UI).
   let played=unsafe{PlaySoundA(bell.as_ptr(),std::ptr::null_mut(),0x0004|0x0002)};
   if played==0{return;}
   if !voice_path.is_file(){return;}
   use std::os::windows::ffi::OsStrExt;
   let path:Vec<u16>=voice_path.as_os_str().encode_wide().chain(std::iter::once(0)).collect();
   // SND_FILENAME + SND_NODEFAULT, synchronous, after the bell.
   let _=unsafe{PlaySoundW(path.as_ptr(),std::ptr::null_mut(),0x00020000|0x0002)};
  });
  Ok(())
 }
 #[cfg(not(windows))]
 {let _=(level,voice_level);Err("Alertas nativos exigem Windows.".into())}
}
'''
s=s.replace(needle,combo+needle,1)
registry='notify_new_order,play_order_alert,save_order_voice,play_order_voice,order_voice_status,check_update]'
assert s.count(registry)==1, 'Windows native command registry changed'
s=s.replace(registry,
 'notify_new_order,play_order_alert,play_order_alert_combo,save_order_voice,play_order_voice,order_voice_status,check_update]',1)
p.write_text(s,encoding="utf-8")
print("Windows alert: native bell + natural voice; settings work without remounting subscribers.")
