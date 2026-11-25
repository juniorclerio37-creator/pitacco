"""Connect iFood reception to the shared web and desktop operations."""
from pathlib import Path


def replace(text, old, new):
    assert text.count(old) == 1, old
    return text.replace(old, new, 1)


p = Path('web/Operations.jsx')
s = p.read_text(encoding='utf-8')
s = "import {playOrderChime,sayNewOrder} from './orderSound.mjs';\n" + s
s = replace(s, 'const seen=useRef(new Set()),soundRef=useRef(false),notifySeen=useRef(new Set());', '''const seen=useRef(new Set()),audio=useRef(null),notifySeen=useRef(new Set());
 const [soundMessage,setSoundMessage]=useState('');''')
s = replace(s, ' useEffect(()=>{soundRef.current=sound},[sound]);', ''' useEffect(()=>()=>{if(audio.current)void audio.current.close().catch(()=>{});},[]);
 async function toggleOrderSound(){
  if(sound){
   const previous=audio.current;
   audio.current=null;setSound(false);setSoundMessage('');
   if(previous)await previous.close().catch(()=>{});
   return;
  }
  const Audio=window.AudioContext||window.webkitAudioContext;
  if(!Audio){setSoundMessage('Som indisponível neste navegador.');return;}
  try{
   audio.current??=new Audio();
   await audio.current.resume();
   if(audio.current.state!=='running')throw Error('som bloqueado');
   playOrderChime(audio.current);
   setSound(true);setSoundMessage('Som de pedidos ativado nesta aba.');
  }catch{setSoundMessage('Não foi possível ativar o som neste navegador.');}
 }
 const soundControl=<div className="dispatch-actions">
  <button type="button" className="secondary" aria-pressed={sound} onClick={toggleOrderSound}>
   {sound?'Desativar som de pedidos':'Ativar som de pedidos'}
  </button>
  {soundMessage&&<small role="status">{soundMessage}</small>}
 </div>;''')
s = replace(s, "    const waitingForAcceptance=incoming.filter(o=>o.status==='pending'&&orderStage(o)==='analysis');",
"""    const waitingForAcceptance=incoming.filter(o=>(o.status==='pending'&&orderStage(o)==='analysis')||(
     o.source==='ifood'&&o.status==='accepted'&&orderStage(o)!=='completed'&&
     Date.now()-Date.parse(o.receipt?.ifood_received_at)<120000));""")
start = s.index('    if(fresh.length){')
end = s.index('    if(desktop&&device){', start)
s = s[:start] + '''    if(fresh.length){
     if(desktop)invoke('notify',{message:fresh.some(o=>o.source==='ifood')
      ? 'Novo pedido do iFood no Pitacco.'
      : `${fresh.length} pedido(s) aguardando aceite.`}).catch(()=>{});
     if(desktop||audio.current?.state==='running'){
      try{
       const Audio=window.AudioContext||window.webkitAudioContext;
       const context=desktop&&Audio?new Audio():audio.current;
       if(context){
        playOrderChime(context);
        if(desktop)setTimeout(()=>context.close().catch(()=>{}),1100);
       }
       sayNewOrder();
      }catch(error){console.warn('Alerta sonoro indisponível',error);}
     }
    }
''' + s[end:]
s = replace(s, ' return <section className={"pitacco-operations', ''' return <>
 {!desktop&&manager&&['Painel','Pedidos'].includes(view)&&soundControl}
 <section className={"pitacco-operations''')
s = replace(s, '</section>\n}', '</section></>\n}')
s = replace(s, '<label className="toggle"><input type="checkbox" checked={sound} onChange={e=>setSound(e.target.checked)}/>Ativar som nesta página</label>', 'soundControl')
p.write_text(s, encoding='utf-8')

p = Path('web/orderBoard.mjs')
s = p.read_text(encoding='utf-8')
s = replace(s, " if(delivery?.status==='retirada')return 'delivery';",
            " if(delivery?.status==='retirada'||order.receipt?.ifood_status==='DISPATCHED')return 'delivery';")
p.write_text(s, encoding='utf-8')

p = Path('web/src.jsx')
s = p.read_text(encoding='utf-8')
s = "import IfoodConnections from './IfoodConnections.jsx';\n" + s
s = replace(s, "{['iFood','99Food','Keeta'].map(name=>",
            "<IfoodConnections key={selected} client={supabase} storeId={selected} canRead={manager}/>{['99Food','Keeta'].map(name=>")
p.write_text(s, encoding='utf-8')
