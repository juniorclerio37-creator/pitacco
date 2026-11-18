import React,{useEffect,useRef,useState} from 'react';
import {AlertTriangle,BellRing} from 'lucide-react';
import './owner-incident-notifier.css';

const labels={
 acceptance_late:'Pedido aguardando aceite além do prazo',
 preparation_late:'Preparo acima do prazo',
 delivery_late:'Entrega atrasada',
 print_error:'Falha na impressão de pedido',
 marketplace_acceptance_failed:'Aceite recusado pelo marketplace',
 delivery_partner_failed:'Falha na entrega parceira',
 payment_failed:'Falha de pagamento'
};
const POLL_MS=5000;

// This is an alert in an authenticated ADMIN browser session, not a background
// push service. Browser audio and desktop notifications require user permission.
export default function OwnerIncidentNotifier({client,onOpen}){
 const [pulse,setPulse]=useState(null),[error,setError]=useState('');
 const [audioEnabled,setAudioEnabled]=useState(false),[permission,setPermission]=useState('default');
 const seen=useRef(new Set()),initial=useRef(false),busy=useRef(false),audio=useRef(null);
 const armed=useRef(false);

 function chime(){
  if(!armed.current||!audio.current)return;
  const context=audio.current;
  try{
   if(context.state==='suspended')void context.resume();
   const now=context.currentTime;
   for(const [offset,freq] of [[0,880],[.18,1320],[.44,880]]){
    const osc=context.createOscillator(),gain=context.createGain();
    osc.type='sine';osc.frequency.value=freq;
    gain.gain.setValueAtTime(.001,now+offset);
    gain.gain.exponentialRampToValueAtTime(.14,now+offset+.02);
    gain.gain.exponentialRampToValueAtTime(.001,now+offset+.17);
    osc.connect(gain);gain.connect(context.destination);
    osc.start(now+offset);osc.stop(now+offset+.18);
   }
  }catch{}
 }
 function announce(items){
  if(!items.length)return;
  chime();
  if(typeof Notification!=='undefined'&&Notification.permission==='granted'){
   const item=items[0];
   try{
    const notice=new Notification('Pitacco Admin • falha operacional',{
     body:(labels[item.code]||'Nova ocorrência')+' · '+item.store_name+
       (items.length>1?' e mais '+(items.length-1)+' ocorrência(s)':''),
     tag:'pitacco-admin-incident-'+item.id,requireInteraction:true
    });
    notice.onclick=()=>{window.focus();onOpen();notice.close();};
   }catch{}
  }
 }

 useEffect(()=>{
  let live=true;
  async function check(){
   if(busy.current)return;
   busy.current=true;
   try{
    const {data,error:rpcError}=await client.rpc('pitacco_owner_incident_pulse');
    if(rpcError)throw rpcError;
    if(!live)return;
    const events=Array.isArray(data?.events)?data.events:[];
    const newlySeen=events.filter(item=>!seen.current.has(item.id));
    // Do not sound an alarm for historic incidents on initial page load.
    if(initial.current&&newlySeen.length)announce(newlySeen);
    events.forEach(item=>seen.current.add(item.id));
    initial.current=true;
    setPulse(data);setError('');
   }catch(failure){if(live)setError(failure.message||'Monitor de incidentes indisponível');}
   finally{busy.current=false}
  }
  void check();
  const timer=window.setInterval(check,POLL_MS);
  return()=>{live=false;window.clearInterval(timer);};
 },[client]);

 async function activate(){
  const Audio=window.AudioContext||window.webkitAudioContext;
  if(Audio){
   try{audio.current??=new Audio();await audio.current.resume();armed.current=true;setAudioEnabled(true);chime();}
   catch{armed.current=false;setAudioEnabled(false);}
  }
  if(typeof Notification!=='undefined'){
   const status=await Notification.requestPermission();
   setPermission(status);
  }else setPermission('unsupported');
 }

 const pending=Number(pulse?.unacknowledged||0);
 const urgent=Number(pulse?.urgent||0);
 return <div className="owner-alerts-header" aria-label="Monitoramento do Super Admin">
  <button type="button" className={'secondary owner-alerts-indicator'+(urgent?' owner-alerts-indicator--urgent':'')}
   onClick={onOpen} aria-label={'Abrir Central de Diagnósticos, '+pending+' incidente(s) não reconhecido(s)'}>
   <AlertTriangle size={17} aria-hidden="true"/>
   <span>{pending} alertas{urgent?' · '+urgent+' urgentes':''}</span>
  </button>
  <button type="button" className="secondary" onClick={activate}
    aria-label="Habilitar som e notificações deste navegador">
   <BellRing size={17} aria-hidden="true"/>
   {audioEnabled?'Som ativo':'Ativar alarmes'}
  </button>
  {error&&<span className="owner-alerts-error" role="alert">Falha no monitor</span>}
  {permission==='denied'&&<span className="owner-alerts-error">Notificações bloqueadas pelo navegador</span>}
  <span className="owner-alerts-sr-only" role="status" aria-live="polite">
   {pending} falha(s) abertas não reconhecidas
  </span>
 </div>;
}
