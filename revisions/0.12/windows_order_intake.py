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
 const observeOrders=useMemo(()=>newOrderTracker(storeId),[client,storeId,manager]);
 async function nativeOrderSound(){
  try{await invoke('play_order_alert');setSoundMessage('');sayNewOrder(1200);}
  catch{setSoundMessage('O alerta do Windows está indisponível. Confira o áudio do computador.');}
 }""")
    source = replace(source, '''{!desktop&&manager&&['Painel','Pedidos'].includes(view)&&soundControl}''',
                     '''{manager&&['Painel','Pedidos'].includes(view)&&(desktop?<div className="dispatch-actions">
  <button type="button" className="secondary" onClick={()=>void nativeOrderSound()}>Testar alerta de pedido</button>
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
fn play_order_alert()->Result<(),String>{
 #[cfg(windows)]
 {
  #[link(name="winmm")]
  extern "system" {fn PlaySoundA(sound:*const u8,module:*mut std::ffi::c_void,flags:u32)->i32;}
  static AUDIO:&[u8]=include_bytes!("order-alert.wav");
  // Memory playback is asynchronous. The embedded bytes live for the process lifetime.
  let played=unsafe{PlaySoundA(AUDIO.as_ptr(),std::ptr::null_mut(),0x0004|0x0001|0x0002)};
  if played!=0{Ok(())}else{Err("O áudio de pedidos do Windows não pôde ser reproduzido.".into())}
 }
 #[cfg(not(windows))]
 {Err("O alerta nativo é exclusivo do Windows.".into())}
}
"""
    source = replace(source, '#[tauri::command]fn notify(app:', notification + '#[tauri::command]fn notify(app:')
    return replace(source, ',notify,check_update]', ',notify,notify_new_order,play_order_alert,check_update]')


def chime(path):
    rate = 24000
    samples = array('h')
    notes = [(0.00, 783.99), (0.14, 1046.50), (0.46, 880.00), (0.61, 1174.66)]
    for sample in range(round(1.16 * rate)):
        now = sample / rate
        output = 0.0
        for start, pitch in notes:
            time = now - start
            if time < 0:
                continue
            wave_phase = 2 * math.pi * pitch * time
            ring = math.sin(wave_phase) + 0.2 * math.sin(2 * wave_phase) + 0.12 * math.sin(3.03 * wave_phase)
            output += 0.55 * min(time / 0.012, 1) * math.exp(-7.5 * time) * ring
        fade = min(1, (1.16 - now) / 0.06)
        samples.append(round(32767 * min(1, max(-1, output * fade))))
    if sys.byteorder == 'big':
        samples.byteswap()
    with wave.open(str(path), 'wb') as audio:
        audio.setparams((1, 2, rate, 0, 'NONE', 'not compressed'))
        audio.writeframes(samples.tobytes())


update('web/src.jsx', app)
update('web/Operations.jsx', operations)
update('web/src-tauri/src/main.rs', rust)
chime(Path('web/src-tauri/src/order-alert.wav'))
