
import React,{useEffect,useState} from 'react';

const money=new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'});
const brl=cents=>money.format(cents/100);
const channels={proprio:'Pedidos próprios',ifood:'iFood','99food':'99Food',keeta:'Keeta'};
function currentMonth(){
 const parts=new Intl.DateTimeFormat('en',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit'}).formatToParts(new Date());
 return parts.find(part=>part.type==='year').value+'-'+parts.find(part=>part.type==='month').value;
}
export default function OwnerPlans({client,stores}){
 const [plan,setPlan]=useState(null),[error,setError]=useState(''),[attempt,retry]=useState(0);
 const [quote,setQuote]=useState(null),[quoteError,setQuoteError]=useState(''),[busy,setBusy]=useState(false);
 useEffect(()=>{
  const controller=new AbortController();
  let live=true;
  setError('');
  (async()=>{
   try{
    const {data,error}=await client.rpc('pitacco_owner_commercial_plans').abortSignal(controller.signal);
    const item=data?.[0];
    if(error||data?.length!==1||!Number.isInteger(item?.sales_threshold_cents))throw error||Error();
    if(live)setPlan(item);
   }catch{if(live)setError('Não foi possível consultar a assinatura.');}
  })();
  return()=>{live=false;controller.abort();};
 },[client,attempt]);
 async function estimate(event){
  event.preventDefault();
  const form=new FormData(event.currentTarget);
  const store=form.get('store'),month=form.get('month');
  setBusy(true);setQuote(null);setQuoteError('');
  try{
   const {data,error}=await client.rpc('pitacco_owner_monthly_plan_estimate',{p_store:store,p_month:month+'-01'});
   if(error||!Array.isArray(data?.channels))throw error||Error();
   setQuote({...data,storeName:stores.find(item=>item.id===store)?.name});
  }catch{setQuoteError('Não foi possível apurar as vendas. Confira a loja e o mês.');}
  finally{setBusy(false);}
 }
 return <section className="panel" aria-label="Assinatura por faturamento">
  <h3>Assinatura única Pitacco</h3>
  {error?<p role="alert">{error} <button type="button" className="secondary" onClick={()=>retry(n=>n+1)}>Tentar novamente</button></p>:!plan&&<p role="status">Consultando assinatura…</p>}
  {plan&&<>
   <p>Uma assinatura mensal por estabelecimento, sem taxa Pitacco por pedido.</p>
   <div className="owner-dashboard-table" tabIndex={0}><table aria-label="Faixas da assinatura">
    <thead><tr><th scope="col">Vendas mensais</th><th scope="col">Mensalidade</th></tr></thead>
    <tbody><tr><th scope="row">Até {brl(plan.sales_threshold_cents)}</th><td>{brl(plan.monthly_cents)}</td></tr>
     <tr><th scope="row">Acima de {brl(plan.sales_threshold_cents)}</th><td>{brl(plan.above_threshold_monthly_cents)}</td></tr></tbody>
   </table></div>
   <h4>Consultar faixa por loja</h4>
   <p>A estimativa usa o valor bruto dos pedidos concluídos registrados no mês, incluindo marketplaces, pela data de entrada em horário de Brasília.</p>
   <p>Esta consulta é uma prévia. A cobrança continua de acordo com a assinatura atual da loja.</p>
   <form className="admin-finance-filters" onSubmit={estimate}>
    <div className="field"><label htmlFor="plan-estimate-store">Loja</label><select id="plan-estimate-store" name="store" required disabled={busy}>
     <option value="">Selecione uma loja</option>{stores.map(item=><option key={item.id} value={item.id}>{item.name}</option>)}
    </select></div>
    <div className="field"><label htmlFor="plan-estimate-month">Mês</label><input id="plan-estimate-month" name="month" type="month" defaultValue={currentMonth()} max={currentMonth()} required disabled={busy}/></div>
    <button disabled={busy||!stores.length}>{busy?'Calculando…':'Calcular faixa'}</button>
   </form>
   {quoteError&&<p role="alert">{quoteError}</p>}
   {quote&&<div className="panel" role="status">
    <h4>{quote.storeName} · {quote.month.slice(0,7).split('-').reverse().join('/')}</h4>
    <p>Vendas apuradas <strong>{brl(quote.sales_cents)}</strong></p>
    <p>Mensalidade estimada <strong>{brl(quote.monthly_cents)}</strong></p>
    {!!quote.channels.length&&<ul>{quote.channels.map(channel=><li key={channel.source}>{channels[channel.source]||channel.source} · {brl(channel.sales_cents)}</li>)}</ul>}
   </div>}
  </>}
 </section>;
}
