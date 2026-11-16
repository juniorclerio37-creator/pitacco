
import React,{useEffect,useState} from 'react';

const money=new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'});
const percent=new Intl.NumberFormat('pt-BR',{style:'percent'});
export default function OwnerPlans({client}){
 const [plans,setPlans]=useState(null),[error,setError]=useState(false),[attempt,retry]=useState(0);
 useEffect(()=>{
  const controller=new AbortController();
  let live=true;
  setError(false);
  (async()=>{
   try{
    const {data,error}=await client.rpc('pitacco_owner_commercial_plans').abortSignal(controller.signal);
    if(error||!Array.isArray(data))throw error||Error();
    if(live)setPlans(data);
   }catch{if(live)setError(true);}
  })();
  return()=>{live=false;controller.abort();};
 },[client,attempt]);
 return <section className="panel" aria-label="Catálogo de planos">
  <h3>Catálogo de planos</h3>
  {error?<p role="alert">Não foi possível consultar os planos. <button type="button" className="secondary" onClick={()=>retry(n=>n+1)}>Tentar novamente</button></p>:!plans&&<p role="status">Consultando planos…</p>}
  <div className="admin-plan-grid">{plans?.map(plan=><article className="panel" key={plan.code}>
   <h4>{plan.name}</h4>
   <dl><dt>Mensalidade</dt><dd>{money.format(plan.monthly_cents/100)}</dd>
    <dt>Comissão Pitacco</dt><dd>{percent.format(plan.commission_basis_points/10000)}</dd>
    {plan.trial_days>0?<><dt>Teste para novas adesões</dt><dd>{plan.trial_days} dias</dd></>
    :<><dt>Vencimento da comissão</dt><dd>Quarta-feira às 23h59, horário de Brasília</dd>
     <dt>Tolerância</dt><dd>{plan.grace_hours} horas</dd></>}
   </dl>
  </article>)}</div>
 </section>;
}
