import React, {useEffect,useState} from 'react';

const labels={
 awaiting_acceptance:'Pedido aguardando aceite',
 acceptance_late:'Pedido aguardando aceite há mais de 10 minutos',
 preparation_late:'Preparo acima do prazo',
 order_rejected:'Pedido recusado',
 order_cancelled:'Pedido cancelado',
 delivery_cancelled:'Entrega cancelada',
 delivery_late:'Entrega acima do prazo',
 delivery_partner_failed:'Falha registrada na entrega parceira',
 acceptance_partner_failed:'Aceite recusado pelo marketplace',
 payment_failed:'Falha de pagamento registrada',
 no_courier:'Entrega própria aguardando entregador disponível'
};
const time=new Intl.DateTimeFormat('pt-BR',{timeZone:'America/Sao_Paulo',dateStyle:'short',timeStyle:'short'});

export default function OperationalAlerts({client,storeId,onNavigate}){
 const [data,setData]=useState(null),[error,setError]=useState(''),[busy,setBusy]=useState(true),[refresh,setRefresh]=useState(0);
 useEffect(()=>{
  let live=true,running=false;
  async function update(){
   if(running)return;
   running=true;
   setBusy(true);
   try{
    const result=await client.rpc('pitacco_operational_alerts',{p_store:storeId});
    if(!live)return;
    if(result.error)throw result.error;
    setData(result.data);
    setError('');
   }catch(failure){if(live)setError(failure.message||'Não foi possível carregar os alertas.');}
   finally{running=false;if(live)setBusy(false);}
  }
  update();
  const timer=setInterval(update,30000);
  return()=>{live=false;clearInterval(timer);};
 },[client,storeId,refresh]);
 return <section className="panel" aria-label="Central de alertas" aria-busy={busy}>
  <div className="dispatch-actions"><button type="button" className="secondary" disabled={busy} onClick={()=>setRefresh(value=>value+1)}>Atualizar alertas</button></div>
  {busy&&!data&&<p role="status">Carregando alertas…</p>}
  {error&&<p role="alert">{error}</p>}
  {data&&<>
   <h3>Entregadores próprios</h3>
   <dl className="operational-overview">
    <div><dt>Disponíveis</dt><dd>{data.couriers.available}</dd></div>
    <div><dt>Indisponíveis</dt><dd>{data.couriers.unavailable}</dd></div>
    <div><dt>Disponíveis com GPS recente</dt><dd>{data.couriers.recent_gps}</dd></div>
   </dl>
   <h3>Alertas recentes e em aberto</h3>
   {!data.events.length&&<p>Nenhum alerta nesta consulta.</p>}
   <ul>{data.events.map(event=><li key={event.code+event.entity_id}>
    <div><strong>{labels[event.code]}</strong>{event.reference&&' · '+event.reference}</div>
    {event.code!=='no_courier'&&<time dateTime={event.event_at}>{time.format(new Date(event.event_at))}</time>}
    {' '}<button className="secondary" type="button" onClick={()=>onNavigate(event.target)}>
      {event.target==='Pedidos'?'Abrir pedidos':'Abrir entregas e motoboys'}
    </button>
   </li>)}</ul>
  </>}
 </section>;
}
