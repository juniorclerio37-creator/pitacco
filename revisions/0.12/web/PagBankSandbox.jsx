import React,{useEffect,useRef,useState} from 'react';

export default function PagBankSandbox({client,store,onEvidence}){
 const [connection,setConnection]=useState(null),[link,setLink]=useState(''),[charge,setCharge]=useState(null),[qr,setQr]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const request=useRef(null),mounted=useRef(true);
 async function call(action,extra={}){
  const response=await client.functions.invoke('pagbank-connect',{body:{action,store_id:store,...extra}});
  if(response.error){const detail=await response.error.context?.clone?.().json().catch(()=>null);throw Error(detail?.error||'Não foi possível concluir o teste PagBank.');}
  if(!response.data||response.data.provider_http)throw Error('PagBank recusou a operação de teste (HTTP '+(response.data?.provider_http||'indisponível')+').');
  return response.data;
 }
 async function run(fn){setBusy(true);setError('');try{await fn()}catch(e){if(mounted.current)setError(e.message||'Teste indisponível.')}finally{if(mounted.current)setBusy(false)}}
 useEffect(()=>{mounted.current=true;if(store)run(async()=>{const r=await call('status');if(mounted.current)setConnection(r)});return()=>{mounted.current=false}},[store,client]);
 useEffect(()=>{if(charge?.status!=='WAITING'||!charge?.id)return;let stop=false;let pending=false;const interval=setInterval(async()=>{if(pending)return;pending=true;try{const next=await call('check',{id:charge.id});if(!stop&&mounted.current)setCharge(next)}catch{}finally{pending=false}},4500);return()=>{stop=true;clearInterval(interval)}},[charge?.id,charge?.status,store]);
 async function start(){await run(async()=>{const r=await call('start');const u=new URL(r.authorization_url);if(u.origin!=='https://connect.sandbox.pagbank.com.br'||u.pathname!=='/oauth2/authorize')throw Error('Endereço de autorização inválido.');setLink(u.href)})}
 async function create(){await run(async()=>{request.current??=crypto.randomUUID();const r=await call('create',{id:request.current,cents:100});setCharge(r);setQr('');if(r.status==='WAITING'){try{const i=await call('qr',{id:r.id});if(/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(i.image))setQr(i.image)}catch{}}})}
 if(!store)return null;
 return <section className="panel" aria-label="PagBank Connect Sandbox">
  <h3>PagBank Connect · ambiente de testes</h3>
  <p>Conecte uma conta Sandbox na loja de homologação. Nenhum pagamento real será recebido e nenhum pedido será enviado à produção.</p>
  <p role="status">{connection?.connected?'Conta de testes vinculada.':'Conta de testes ainda não vinculada.'}</p>
  <button type="button" disabled={busy||connection?.connected} onClick={start}>Conectar conta PagBank Sandbox</button>{' '}
  <button type="button" className="secondary" disabled={busy} onClick={()=>run(async()=>setConnection(await call('status')))}>Atualizar conexão</button>
  {link&&!connection?.connected&&<p><a href={link} target="_blank" rel="noopener noreferrer">Autorizar conta Sandbox no PagBank</a> · válido por 10 minutos.</p>}
  {connection?.connected&&<button type="button" disabled={busy||!!charge} onClick={create}>Gerar Pix de teste · R$ 1,00</button>}
  {error&&<p role="alert">{error}</p>}
  {charge&&<div><h4>Pix de teste · R$ 1,00</h4><p role="status">{({WAITING:'Aguardando pagamento',PAID:'Pagamento confirmado pelo PagBank',DECLINED:'Pagamento recusado',CANCELED:'Pagamento cancelado',REFUNDED:'Pagamento estornado'})[charge.status]||charge.status}</p>
   {charge.status==='WAITING'&&<>{qr&&<img src={qr} alt="QR Code Pix fictício" width="180" height="180"/>}<p>Não pague este código com dinheiro real.</p>{charge.qr_text&&<><textarea aria-label="Pix Copia e Cola de teste" value={charge.qr_text} readOnly rows={3}/><button type="button" onClick={()=>navigator.clipboard.writeText(charge.qr_text).catch(()=>setError('Copie o código manualmente.'))}>Copiar código</button></>}<button type="button" disabled={busy} onClick={()=>run(async()=>setCharge(await call('check',{id:charge.id})))}>Consultar pagamento</button></>}
   {charge.status==='PAID'&&onEvidence&&<button type="button" onClick={()=>onEvidence({confirmed:true,amount_matches:true,environment:'sandbox',reference:charge.order_id,provider_status:'PAID',amount_cents:charge.cents})}>Usar resultado no registro</button>}
   <small>{charge.order_id}</small>
  </div>}
 </section>;
}
