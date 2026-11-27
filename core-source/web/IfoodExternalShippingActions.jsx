import React,{useEffect,useRef,useState} from 'react';
const statusLabels={none:'Nenhuma solicitação',pending:'Aguardando decisão da loja',accepted:'Alteração confirmada pelo iFood',denied:'Alteração recusada pelo iFood',expired:'Prazo encerrado',address_unavailable:'Endereço solicitado não recebido',requesting:'Enviando solicitação',submitted:'Aguardando evento oficial',uncertain:'Resultado indefinido — não repetir',rejected:'API recusou a solicitação',failed:'Cancelamento recusado pelo iFood',cancelled:'Cancelamento confirmado pelo iFood'};
export default function IfoodExternalShippingActions({client,store,externalId}){
 const [status,setStatus]=useState(null),[reasons,setReasons]=useState(null),[selected,setSelected]=useState(''),[busy,setBusy]=useState(false),[message,setMessage]=useState('');
 const running=useRef(false);
 const call=async(action,extra={})=>{const r=await client.functions.invoke('ifood-shipping',{body:{action,store_id:store,external_id:externalId,...extra}});if(r.error){const d=await r.error.context?.clone?.().json().catch(()=>null);throw Error(d?.error||'Shipping indisponível.')}return r.data};
 const refresh=async()=>setStatus(await call('external_status'));
 useEffect(()=>{let active=true;const poll=async()=>{if(running.current)return;try{const s=await call('external_status');if(active&&!running.current)setStatus(s)}catch{}};poll();const timer=setInterval(poll,10000);return()=>{active=false;clearInterval(timer)}},[client,store,externalId]);
 async function run(fn){if(running.current)return;running.current=true;setBusy(true);setMessage('');try{await fn()}catch(e){setMessage(e.message)}finally{running.current=false;setBusy(false)}}
 const decide=(decision)=>{if(!window.confirm(decision==='cancel'?'Confirmar cancelamento do pedido de homologação?':decision==='accept_address'?'Aceitar o endereço solicitado pelo cliente?':'Recusar a alteração solicitada?'))return;run(async()=>{const r=await call('external_decision',{decision,confirmed:true,request_id:status?.address_event_id,reason_code:selected});if(r.available===false)throw Error('API indisponível: '+(r.provider_code||r.provider_http));setMessage((statusLabels[r.state]||r.state)+' · HTTP '+r.provider_http);setReasons(null);setSelected('');await refresh()})};
 const address=status?.address;
 const pending=status?.address_state==='pending'&&Date.parse(status.address_expires_at)>Date.now()&&!status.terminal&&!['requesting','submitted','uncertain','cancelled'].includes(status.cancel_state);
 const canCancel=status&&!status.terminal&&!['requesting','submitted','uncertain','cancelled'].includes(status.cancel_state)&&!['requesting','submitted','uncertain'].includes(status.address_state);
 return <section aria-label="Alteração de endereço e cancelamento iFood">
 <h5>Alteração de endereço</h5><p role="status">{statusLabels[status?.address_state]||'Consultando eventos…'}</p>
 {address&&<p>{[address.streetName,address.streetNumber,address.complement,address.neighborhood,address.city,address.state,address.postalCode].filter(Boolean).join(', ')}</p>}
 {pending&&<><p>Responder até {new Date(status.address_expires_at).toLocaleString('pt-BR')}</p><button type="button" disabled={busy} onClick={()=>decide('accept_address')}>Aceitar novo endereço</button>{' '}<button type="button" disabled={busy} onClick={()=>decide('deny_address')}>Recusar alteração</button></>}
 <h5>Cancelamento de pedido externo</h5><p role="status">{statusLabels[status?.cancel_state]||'Consultando eventos…'}</p>
 {canCancel&&<button type="button" disabled={busy} onClick={()=>run(async()=>{setSelected('');const r=await call('external_reasons');if(!r.available)throw Error('Motivos indisponíveis: '+(r.provider_code||r.provider_http));setReasons(r.reasons||[])})}>Consultar motivos de cancelamento</button>}
 {canCancel&&reasons?.length===0&&<p>O iFood não permite cancelar este pedido agora.</p>}
 {canCancel&&reasons?.length>0&&<><label>Motivo de cancelamento<select value={selected} disabled={busy} onChange={e=>setSelected(e.target.value)}><option value="">Selecione um motivo</option>{reasons.map(r=><option key={r.cancelCodeId} value={r.cancelCodeId}>{r.description}</option>)}</select></label><button type="button" disabled={busy||!selected} onClick={()=>decide('cancel')}>Confirmar cancelamento</button></>}
 {message&&<p role="alert">{message}</p>}
 </section>;
}
