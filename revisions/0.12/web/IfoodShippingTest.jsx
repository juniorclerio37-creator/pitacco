import React,{useEffect,useState} from 'react';
const currency=new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'});
const time=v=>Number.isFinite(v)?Math.ceil(v/60)+' min':'—';
const errors={DeliveryDistanceTooHigh:'A distância excede a cobertura do iFood.',ServiceAreaMismatch:'Endereço fora da cobertura.',HighDemand:'Alta demanda de entregadores.',OffOpeningHours:'Fora do horário de funcionamento da logística.',MerchantEasyDeliveryDisabled:'Serviço sob demanda ainda não habilitado para a loja.',UnavailableFleet:'Não há entregadores disponíveis.',OriginNotFound:'Origem da loja não localizada pelo iFood.'};
export default function IfoodShippingTest({client,store}){
 const [status,setStatus]=useState(null),[order,setOrder]=useState(''),[result,setResult]=useState(null),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 const [lat,setLat]=useState(''),[lng,setLng]=useState('');
 async function call(action,extra={}){const r=await client.functions.invoke('ifood-shipping',{body:{action,store_id:store,...extra}});if(r.error){const d=await r.error.context?.clone?.().json().catch(()=>null);throw Error(d?.error||'Shipping indisponível.');}return r.data;}
 async function run(action,extra){setBusy(true);setError('');setResult(null);try{const d=await call(action,extra);if(action==='status')setStatus(d);else setResult(d)}catch(e){setError(e.message)}finally{setBusy(false)}}
 useEffect(()=>{setStatus(null);setOrder('');run('status')},[store,client]);
 return <section className="panel" aria-label="Homologação Shipping iFood">
  <h4>iFood Shipping · Entregador parceiro</h4>
  <p>Ambiente de homologação. Compare a entrega própria com a cotação oficial do iFood. A contratação ainda está desabilitada até validação dos testes.</p>
  <button type="button" className="secondary" disabled={busy} onClick={()=>run('status')}>Atualizar pedidos de teste</button>
  {status&&<><p>Aplicativo de teste: <code>{status.client_id}</code></p><p>Merchant ID: <code>{status.merchant_id}</code></p>
  <h5>Pedido recebido do iFood</h5><label>Pedido de teste elegível<select value={order} disabled={busy} onChange={e=>{setOrder(e.target.value);setResult(null)}}><option value="">Selecione</option>{(status.orders||[]).map(o=><option key={o.id} value={o.id}>#{o.number}</option>)}</select></label>
  {!status.orders?.length&&<p>Gere um pedido de teste de entrega própria no Portal do Desenvolvedor iFood.</p>}
  <button type="button" disabled={busy||!order} onClick={()=>run('inside_quote',{order_id:order})}>Consultar entregador parceiro</button>{' '}
  <button type="button" className="secondary" disabled={busy||!order} onClick={()=>run('details',{order_id:order})}>Consultar código de coleta</button>
  <h5>Pedido externo — cotação de homologação</h5>
  <form onSubmit={e=>{e.preventDefault();run('outside_quote',{latitude:Number(lat),longitude:Number(lng)})}}>
   <label>Latitude do endereço de teste<input type="number" min="-90" max="90" step="any" value={lat} required onChange={e=>setLat(e.target.value)}/></label>
   <label>Longitude do endereço de teste<input type="number" min="-180" max="180" step="any" value={lng} required onChange={e=>setLng(e.target.value)}/></label>
   <button disabled={busy}>Consultar cotação de entrega</button>
  </form></>}
  {busy&&<p role="status">Consultando…</p>}{error&&<p role="alert">{error}</p>}
  {result?.available===false&&<p role="alert">{errors[result.provider_code]||'O iFood não disponibilizou uma cotação.'} HTTP {result.provider_http}{result.provider_code?' · '+result.provider_code:''}</p>}
  {result?.quote&&<div role="status"><h5>Cotação oficial</h5><p>Valor do parceiro: <strong>{currency.format(result.quote.netValue)}</strong></p><p>Previsão: {time(result.quote.deliveryTime?.min)} – {time(result.quote.deliveryTime?.max)}</p><p>Validade: {new Date(result.quote.expirationAt).toLocaleString('pt-BR')}</p><small>Referência {result.quote.id}</small></div>}
  {result&&'pickupCode' in result&&<p>Código de coleta (pickupCode): <strong>{result.pickupCode||'Ainda não disponibilizado pelo iFood'}</strong></p>}
 </section>;
}
