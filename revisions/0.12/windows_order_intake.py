"""Scope the Windows order intake and play an embedded native alert."""
from pathlib import Path
from array import array
import math
import sys
import wave


def update(path, transform):
    file = Path(path)
    file.write_text(transform(file.read_text(encoding='utf-8')), encoding='utf-8')


def replace(source, old, new):
    assert source.count(old) == 1, old
    return source.replace(old, new, 1)


def app(source):
    source = "import {windowsStore,saveWindowsStore} from './orderArrival.mjs';\n" + source
    source = replace(source, "useStoreManagerAccess(supabase,session?.user?.id,nativeAvailable()?null:selected)",
                     "useStoreManagerAccess(supabase,session?.user?.id,selected)")
    start = source.index('manager=nativeAvailable()?')
    end = source.index(',active=stores.find', start)
    source = source[:start] + 'manager=storeAccess.manager' + source[end:]
    source = replace(source, 'setProfile(null);setStores([]);return', 'setProfile(null);setStores([]);setSelected(\'\');return')
    source = replace(source, "setSelected(old=>data?.some(s=>s.id===old)?old:data?.[0]?.id||'')",
                     "setSelected(old=>nativeAvailable()?windowsStore(storage,session.user.id,data||[],old):data?.some(s=>s.id===old)?old:data?.[0]?.id||'')")
    return replace(source, '''onChange={e=>setSelected(e.target.value)}>{!stores.length&&<option value="">Nenhuma loja vinculada</option>}''',
                   '''onChange={e=>{setSelected(e.target.value);if(nativeAvailable())saveWindowsStore(storage,session.user.id,e.target.value)}}>
{!selected&&<option value="" disabled>{stores.length?'Selecione a loja deste computador':'Nenhuma loja vinculada'}</option>}''')


def operations(source):
    source = "import {newOrderTracker} from './orderArrival.mjs';\nimport {useMemo} from 'react';\n" + source
    source = replace(source, "const seen=useRef(new Set()),audio=", "const audio=")
    source = replace(source, " const ordersInitialized=useRef(false);\n", "")
    source = replace(source, " const [soundMessage,setSoundMessage]=useState('');",
                     """ const [soundMessage,setSoundMessage]=useState('');
 const [alertLevel,setAlertLevel]=useState(()=>{
  try{const level=Number(localStorage.getItem('pitacco:native-alert-volume'));return [1,2,3].includes(level)?level:3;}
  catch{return 3;}
 });
 const observeOrders=useMemo(()=>newOrderTracker(storeId),[client,storeId,manager]);
 async function nativeOrderSound(){
  try{await invoke('play_order_alert',{level:alertLevel});setSoundMessage('');sayNewOrder(2450);}
  catch{setSoundMessage('O alerta do Windows está indisponível. Confira o áudio do computador.');}
 }""")
    source = replace(source, '''{!desktop&&manager&&['Painel','Pedidos'].includes(view)&&soundControl}''',
                     '''{manager&&['Painel','Pedidos'].includes(view)&&(desktop?<div className="dispatch-actions">
  <button type="button" className="secondary" onClick={()=>void nativeOrderSound()}>Testar alerta de pedido</button>
  <label className="field" htmlFor="pitacco-native-order-volume">Volume do toque
   <select id="pitacco-native-order-volume" value={alertLevel} onChange={event=>{
    const next=Number(event.target.value);
    setAlertLevel(next);
    try{localStorage.setItem('pitacco:native-alert-volume',String(next));}catch{}
   }}>
    <option value={1}>Discreto</option><option value={2}>Alto</option><option value={3}>Máximo</option>
   </select>
  </label>
  {soundMessage&&<small role="status">{soundMessage}</small>}
 </div>:soundControl)}''')
    source = replace(source, 'setDetail(null);seen.current=new Set();ordersInitialized.current=false;',
                     'setDetail(null);')
    source = replace(source, '''    const failure=results.slice(0,6).find(result=>result.error)?.error||results[7].error;
    if(failure)throw failure;''', '''    if(results[0].error)throw results[0].error;''')
    start = source.index("    const waitingForAcceptance=")
    end = source.index("    if(desktop&&device){", start)
    source = source[:start] + '''    const scoped=incoming.filter(order=>order.store_id===storeId);
    const fresh=observeOrders(scoped);
    const supplemental=results.slice(1).some((result,index)=>result.error&&!(index===5&&scheduleColumnMissing));
    setOrders(scoped);
    if(!results[5].error)setPaymentSummary(results[5].data||[]);
    if(!results[7].error)setOrderBadges(results[7].data||[]);
    if(!results[3].error)setDeliveryRows(results[3].data||[]);
    if(!results[4].error)setCourierRows(results[4].data||[]);
    if(!results[1].error)setSettings(results[1].data||[]);
    if(!results[2].error)setSectors(results[2].data||[]);
    setStatus(supplemental?'Pedidos sincronizados · dados complementares pendentes':'Conectado · sincronização ativa');
    if(fresh.length){
     if(desktop){
      void nativeOrderSound();
      invoke('notify_new_order',{message:fresh.length===1?'Você tem um novo pedido.':`${fresh.length} novos pedidos na sua loja.`}).catch(()=>{});
     }else if(audio.current?.state==='running'){
      playOrderChime(audio.current);
      sayNewOrder();
     }
    }
''' + source[end:]
    return source


def rust(source):
    notification = """#[tauri::command]
fn notify_new_order(app:tauri::AppHandle,message:String)->Result<(),String>{
 app.notification().builder().title("Pitacco").body(message.chars().take(200).collect::<String>()).show().map_err(|e|e.to_string())
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
"""
    source = replace(source, '#[tauri::command]fn notify(app:', notification + '#[tauri::command]fn notify(app:')
    return replace(source, ',notify,check_update]', ',notify,notify_new_order,play_order_alert,check_update]')


def chime(path, volume=1.0):
    # Two energetic bell phrases, not a short laptop beep. The maximum preset
    # is limited close to 0 dBFS without sample clipping; OS volume remains user's.
    rate = 24000
    duration = 2.38
    samples = array('h')
    notes = [(0.00, 784.00, 0.64), (0.13, 987.77, 0.61),
             (0.40, 1174.66, 0.64), (0.64, 1567.98, 0.60),
             (1.23, 784.00, 0.68), (1.36, 1174.66, 0.67),
             (1.64, 987.77, 0.67), (1.84, 1567.98, 0.68)]
    for sample in range(round(duration * rate)):
        now = sample / rate
        output = 0.0
        for start, pitch, strength in notes:
            elapsed = now - start
            if elapsed < 0:
                continue
            attack = min(1.0, elapsed / 0.004)
            wave_phase = 2 * math.pi * pitch * elapsed
            # Strong fundamental and harmonics that cut through restaurant noise.
            partials = math.sin(wave_phase) + 0.37 * math.sin(2 * wave_phase) + 0.20 * math.sin(3.01 * wave_phase)
            output += strength * attack * math.exp(-3.8 * elapsed) * partials
        fade = min(1.0, max(0.0, (duration - now) / 0.12))
        # Digital limiting raises average energy without overdriving PCM.
        amplitude = math.tanh(output * 4.15) * 0.985 * volume * fade
        samples.append(max(-32767, min(32767, round(amplitude * 32767))))
    if sys.byteorder == 'big':
        samples.byteswap()
    with wave.open(str(path), 'wb') as audio:
        audio.setparams((1, 2, rate, 0, 'NONE', 'not compressed'))
        audio.writeframes(samples.tobytes())

update('web/src.jsx', app)
update('web/Operations.jsx', operations)
update('web/src-tauri/src/main.rs', rust)
chime(Path('web/src-tauri/src/order-alert.wav'), 1.0)
chime(Path('web/src-tauri/src/order-alert-high.wav'), 0.78)
chime(Path('web/src-tauri/src/order-alert-soft.wav'), 0.45)
