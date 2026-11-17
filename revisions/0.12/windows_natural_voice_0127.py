"""Natural recorded voice on Windows, separate from the approved bell.

No Windows SAPI voice. The operator imports one licensed Brazilian Portuguese
PCM16 WAV produced by a human voice talent or a properly licensed neural TTS.
The audio is stored on-device, pre-amplified in Rust, and works offline.
"""
from pathlib import Path

p=Path("web/Operations.jsx")
s=p.read_text(encoding="utf-8")
old=" const observeOrders=useMemo(()=>newOrderTracker(storeId),[client,storeId,manager]);"
new=""" const [voiceLevel,setVoiceLevel]=useState(()=>{
  try { const level=Number(localStorage.getItem('pitacco:natural-voice-level'));return [1,2,3].includes(level)?level:3; }
  catch{return 3;}
 });
 const [voiceReady,setVoiceReady]=useState(false);
 useEffect(()=>{
  if(!desktop)return;
  let active=true;
  invoke('order_voice_status').then(ready=>{
   if(active)setVoiceReady(ready===true);
  }).catch(()=>{if(active)setVoiceReady(false)});
  return ()=>{active=false};
 },[desktop]);
 async function naturalVoiceOnly(){
  try {
   await invoke('play_order_voice',{level:voiceLevel});
   setVoiceReady(true);
   setSoundMessage('');
  }catch(error){
   setVoiceReady(false);
   setSoundMessage('Voz natural não configurada. Importe uma gravação WAV de voz brasileira profissional (16 bits PCM) para ativá-la.');
  }
 }
 async function importNaturalVoice(event){
  const file=event.target.files?.[0];
  if(!file)return;
  if(file.size>4000000||file.size<2048){setSoundMessage('Escolha uma gravação WAV de até 4 MB.');return;}
  try {
   const audioData=Array.from(new Uint8Array(await file.arrayBuffer()));
   await invoke('save_order_voice',{audioData});
   setVoiceReady(true);
   setSoundMessage('Voz natural salva neste computador. Use “Testar somente voz” para ouvi-la.');
  } catch(e){setSoundMessage('Não foi possível importar a voz WAV: '+String(e));}
  event.target.value='';
 }
 const observeOrders=useMemo(()=>newOrderTracker(storeId),[client,storeId,manager]);"""
assert s.count(old)==1,'Order alert hook changed'
s=s.replace(old,new)
old=""" async function nativeOrderSound(){
  try{await invoke('play_order_alert',{level:alertLevel});setSoundMessage('');sayNewOrder(2450);}
  catch{setSoundMessage('O alerta do Windows está indisponível. Confira o áudio do computador.');}
 }"""
new=""" async function nativeOrderSound(){
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
assert s.count(old)==1,'Existing native order sound changed'
s=s.replace(old,new)
old="""  {soundMessage&&<small role="status">{soundMessage}</small>}"""
new="""  <small role="status">{voiceReady
   ?'Voz natural configurada neste computador. O anúncio funciona mesmo sem internet.'
   :'Voz natural ainda não configurada neste computador. O sino continuará funcionando, sem voz robótica.'}</small>
  <label className="field" htmlFor="pitacco-natural-voice-level">Volume da voz natural
   <select id="pitacco-natural-voice-level" value={voiceLevel} onChange={event=>{
     const value=Number(event.target.value);setVoiceLevel(value);
     try{localStorage.setItem('pitacco:natural-voice-level',String(value));}catch{}
   }}>
    <option value={1}>Normal</option>
    <option value={2}>Alto</option>
    <option value={3}>Máximo (voz amplificada)</option>
   </select>
  </label>
  <label className="field">Importar voz natural profissional (WAV PCM de 16 bits)
   <input type="file" accept=".wav,audio/wav,audio/x-wav" onChange={event=>void importNaturalVoice(event)}/>
  </label>
  <button type="button" className="secondary" onClick={()=>void naturalVoiceOnly()}>Testar somente voz</button>
  {soundMessage&&<small role="status">{soundMessage}</small>}"""
assert s.count(old)==2, 'Expected a browser sound status and a separate native sound status'
native_index=s.rfind(old)
s=s[:native_index]+new+s[native_index+len(old):]
p.write_text(s,encoding="utf-8")

p=Path("web/src-tauri/src/main.rs")
s=p.read_text(encoding="utf-8")
needle='#[tauri::command]\nfn play_order_alert'
assert s.count(needle)==1,'Native bell command changed'
rust=r'''// A single professionally recorded, licensed announcement is stored locally.
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
  // Three precalculated audio variants, digitally limited to PCM16 range.
  for (level,gain) in [(1u8,1.3f64),(2u8,2.5f64),(3u8,4.0f64)]{
   let mut bytes=audio_data.clone();
   for offset in (start..end).step_by(2){
    let x=i16::from_le_bytes([bytes[offset],bytes[offset+1]]) as f64/32768.0;
    let limited=32760.0*(x*gain).tanh();
    let y=(limited.round() as i16).to_le_bytes();
    bytes[offset]=y[0];bytes[offset+1]=y[1];
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
 #[cfg(windows)]
 {Ok(pitacco_voice_dir()?.join("voice-level-3.wav").is_file())}
 #[cfg(not(windows))]
 {Ok(false)}
}
#[tauri::command]
fn play_order_voice(level:Option<u8>)->Result<(),String>{
 #[cfg(windows)]
 {
  #[link(name="winmm")]
  extern "system" {fn PlaySoundW(sound:*const u16,module:*mut std::ffi::c_void,flags:u32)->i32;}
  let selected=match level.unwrap_or(3){1=>1,2=>2,_=>3};
  let path=pitacco_voice_dir()?.join(format!("voice-level-{}.wav",selected));
  if !path.is_file(){return Err("Voz natural ainda não importada.".into());}
  use std::os::windows::ffi::OsStrExt;
  let name:Vec<u16>=path.as_os_str().encode_wide().chain(std::iter::once(0)).collect();
  // SND_FILENAME | SND_ASYNC | SND_NODEFAULT; never modify system volume.
  let result=unsafe{PlaySoundW(name.as_ptr(),std::ptr::null_mut(),0x00020000|0x0001|0x0002)};
  if result!=0{Ok(())}else{Err("Não foi possível reproduzir o WAV da voz natural.".into())}
 }
 #[cfg(not(windows))]
 {let _=level;Err("A voz nativa só está disponível no Windows.".into())}
}
'''
s=s.replace(needle,rust+needle,1)
needle='notify_new_order,play_order_alert,check_update]'
assert s.count(needle)==1,'Tauri command registry changed'
s=s.replace(needle,'notify_new_order,play_order_alert,save_order_voice,play_order_voice,order_voice_status,check_update]',1)
p.write_text(s,encoding="utf-8")
print("Natural human/neural prerecorded WAV import and independent amplified playback ready.")
