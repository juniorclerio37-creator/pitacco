import React,{useEffect,useRef,useState} from 'react';
import {AlertTriangle,BellRing,Check,Phone,ShoppingBag} from 'lucide-react';
const labels={customer_missing:'Cliente não localizado',wrong_address:'Endereço incorreto',payment:'Problema com pagamento',customer_refused:'Cliente recusou o pedido',code:'Problema com código',vehicle:'Problema com veículo',system_error:'Pedido travado',other:'Outra ocorrência'};
export default function IncidentCenter({client,storeId,visible,onCount,onOpen,orders=[],deliveries=[]}){
 const [rows,setRows]=useState([]),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 const refreshRef=useRef(()=>{}),soundRef=useRef(null),activeId=useRef(null);
 useEffect(()=>{
  let alive=true;
  async function refresh(){try{const {data,error}=await client.from('pitacco_delivery_incidents').select('*').eq('store_id',storeId).order('created_at',{ascending:false}).limit(100);if(error)throw error;if(alive){setRows(data||[]);setError('');}}catch(e){if(alive)setError(e?.message||'Não foi possível consultar ocorrências');}}
  refreshRef.current=refresh;void refresh();
  const timer=setInterval(refresh,5000);
  let channel;try{channel=client.channel('merchant-incidents:'+storeId).on('postgres_changes',{event:'*',schema:'public',table:'pitacco_delivery_incidents',filter:'store_id=eq.'+storeId},refresh).subscribe()}catch{}
  return()=>{alive=false;clearInterval(timer);if(channel)void client.removeChannel(channel).catch(()=>{});};
 },[client,storeId]);
 const pending=rows.filter(i=>i.state==='open'||i.state==='acknowledged'),urgent=rows.find(i=>i.state==='open');
 useEffect(()=>{onCount(pending.length)},[pending.length,onCount]);
 useEffect(()=>{
  if(!urgent){activeId.current=null;return;}
  if(activeId.current===urgent.id)return;activeId.current=urgent.id;
  // Distinct three-note sound, independent of the new-order audio. The supplied voice asset can replace it.
  try{const Ctx=window.AudioContext||window.webkitAudioContext;if(!Ctx)return;const ctx=new Ctx();soundRef.current=ctx;void ctx.resume().then(()=>{for(const [idx,hz] of [740,988,740].entries()){const osc=ctx.createOscillator(),gain=ctx.createGain();osc.type='sine';osc.frequency.value=hz;osc.connect(gain);gain.connect(ctx.destination);const t=ctx.currentTime+idx*.26;gain.gain.setValueAtTime(.001,t);gain.gain.exponentialRampToValueAtTime(.28,t+.025);gain.gain.exponentialRampToValueAtTime(.001,t+.21);osc.start(t);osc.stop(t+.22);if(idx===2)osc.onended=()=>void ctx.close().catch(()=>{});}}).catch(()=>{});}catch{}
 },[urgent?.id]);
 async function change(i,state){setBusy(true);setError('');try{const {error}=await client.rpc('pitacco_update_delivery_incident',{p_incident:i.id,p_state:state});if(error)throw error;await refreshRef.current()}catch(e){setError(e?.message||'Ação não registrada')}finally{setBusy(false)}}
 function card(i){const o=orders.find(x=>x.id===i.order_id),d=deliveries.find(x=>x.id===i.delivery_id),receipt=o?.receipt||{};const num=receipt.display_number||receipt.external_order_number||i.order_id?.slice(0,8)||i.delivery_id.slice(0,8);const source=o?.source||d?.source||'';const phone=String(receipt.phone||receipt.customer_phone||'').replace(/[^+0-9]/g,'');return <article key={i.id} className="incident-card"><strong>#{num} · {source==='ifood'?'iFood':source==='99food'?'99Food':source==='keeta'?'Keeta':'Loja'}</strong><h3>{labels[i.kind]||'Ocorrência'}</h3><p>{d?.address||receipt.address||'Consulte o endereço nos detalhes do pedido'}</p><small>{new Date(i.created_at).toLocaleString('pt-BR')} · {i.state==='open'?'Aguardando atendimento':i.state==='acknowledged'?'Loja está verificando':i.state==='cancelled'?'Encerrada por cancelamento':'Resolvida'}</small>{['open','acknowledged'].includes(i.state)&&<><p>Entre em contato com o cliente pelos canais disponíveis{source==='ifood'||source==='99food'||source==='keeta'?' ou pelo suporte do marketplace':''}.</p><div className="incident-actions">{phone&&<a href={'tel:'+phone}><Phone size={16}/> Ligar</a>}{i.state==='open'&&<button type="button" disabled={busy} onClick={()=>change(i,'acknowledged')}><Check size={16}/> Estou verificando</button>}<button type="button" disabled={busy} onClick={()=>change(i,'resolved')}>Resolver ocorrência</button></div></>}</article>}
 return <>{urgent&&!visible&&<div className="incident-alert" role="alert"><BellRing size={24}/><div><strong>{labels[urgent.kind]||'Ocorrência na entrega'}</strong><p>Seu entregador precisa de assistência. Verifique os canais de contato.</p></div><button type="button" onClick={onOpen}>Abrir ocorrência</button><button type="button" disabled={busy} onClick={()=>change(urgent,'acknowledged')}>Estou verificando</button></div>}{visible&&<section className="panel incident-center" aria-label="Central de ocorrências"><h2><AlertTriangle size={20}/> Central de ocorrências · {pending.length} pendente(s)</h2>{error&&<p role="alert">{error}</p>}{!rows.length&&!error&&<p>Nenhuma ocorrência registrada.</p>}{[...pending,...rows.filter(i=>!pending.includes(i))].map(card)}</section>}</>;
}
