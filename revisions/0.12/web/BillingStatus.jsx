import React,{useEffect,useState} from 'react';

const labels={trial:'Período de teste',active:'Ativa · pagamento confirmado',overdue:'Vencida',legacy:'Cadastro anterior à cobrança',courtesy:'Cortesia',suspended:'Suspensa'};
const money=new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'});
const date=new Intl.DateTimeFormat('pt-BR',{timeZone:'America/Sao_Paulo',dateStyle:'medium',timeStyle:'short'});

function useBilling(client,name,args){
 const [result,setResult]=useState(null),[error,setError]=useState(''),[busy,setBusy]=useState(true),[revision,setRevision]=useState(0);
 const storeId=args?.p_store;
 useEffect(()=>{
  let live=true;
  async function load(){
   setBusy(true);
   setError('');
   try{
    const response=await client.rpc(name,storeId?{p_store:storeId}:undefined);
    if(!live)return;
    if(response.error)throw response.error;
    setResult(response.data);
   }catch(failure){if(live)setError(failure.message||'Não foi possível consultar a assinatura.');}
   finally{if(live)setBusy(false);}
  }
  load();
  return()=>{live=false;};
 },[client,name,storeId,revision]);
 return {result,error,busy,refresh:()=>setRevision(value=>value+1)};
}

export default function BillingStatus({client,storeId}){
 const {result,error,busy,refresh}=useBilling(client,'pitacco_merchant_subscription_details',{p_store:storeId});
 const deadline=result?.paid_until||result?.trial_ends_at;
 return <section aria-label="Situação da assinatura" aria-busy={busy}>
  {busy&&!result&&<p role="status">Consultando assinatura…</p>}
  {error&&<p role="alert">{error}</p>}
  {result&&<>
   <div className="line"><b>Situação</b><span>{labels[result.status]||result.status}</span></div>
   {result.plan_code&&<div className="line"><b>Plano atual</b><span>{{saas:'Pitacco (contrato atual)',pitacco:'Pitacco',free:'Grátis',complete:'Completo'}[result.plan_code]||result.plan_code}</span></div>}
   {(result.registered_monthly_amount??result.amount)!=null&&<div className="line"><b>Valor informado pela cobrança</b><span>{money.format(Number(result.registered_monthly_amount??result.amount))}</span></div>}
   {result.due_date&&<div className="line"><b>Vencimento cadastrado</b><span>{result.due_date.split('-').reverse().join('/')}</span></div>}
   {result.status==='trial'&&result.trial_ends_at&&<div className="line"><b>Dias restantes de teste</b><span>{Math.max(0,Math.ceil((new Date(result.trial_ends_at)-Date.now())/86400000))}</span></div>}
   {deadline&&<div className="line"><b>{result.paid_until?'Cobertura paga até':'Fim do teste'}</b><span>{date.format(new Date(deadline))}</span></div>}
   {result.orders_blocked&&<p role="alert">Novos pedidos bloqueados. Os pedidos em andamento continuam disponíveis.</p>}
   {result.status==='overdue'&&result.regularization_url&&<a href={result.regularization_url} rel="noreferrer">Regularizar assinatura</a>}
   <h4>Histórico de pagamentos confirmados</h4>
   {result.payments?.length?<div style={{overflowX:'auto'}}><table><thead><tr><th>Pagamento</th><th>Provedor</th><th>Valor</th><th>Cobertura até</th></tr></thead><tbody>{result.payments.map((p,i)=><tr key={i}><td>{date.format(new Date(p.confirmed_at))}</td><td>{p.provider}</td><td>{money.format(Number(p.amount))}</td><td>{date.format(new Date(p.paid_until))}</td></tr>)}</tbody></table></div>:<p>Nenhum pagamento confirmado registrado.</p>}
  </>}
  <button type="button" className="secondary" disabled={busy} onClick={refresh}>Atualizar situação</button>
 </section>;
}

export function BillingOverview({client}){
 const {result,error,busy,refresh}=useBilling(client,'pitacco_subscription_overview');
 return <section aria-label="Indicadores de assinatura" aria-busy={busy}>
  {busy&&!result&&<p role="status">Consultando assinaturas…</p>}
  {error&&<p role="alert">{error}</p>}
  {result&&<dl>
   <div className="line"><dt>Estabelecimentos cadastrados</dt><dd>{result.registered}</dd></div>
   <div className="line"><dt>Em teste</dt><dd>{result.trial}</dd></div>
   <div className="line"><dt>Com pagamento ativo</dt><dd>{result.active}</dd></div>
   <div className="line"><dt>Assinaturas vencidas</dt><dd>{result.overdue}</dd></div>
   <div className="line"><dt>Cadastros anteriores à cobrança</dt><dd>{result.legacy}</dd></div>
   <div className="line"><dt>Receita mensal recorrente estimada</dt><dd>{money.format(result.monthly_recurring_revenue)}</dd></div>
  </dl>}
  <button type="button" className="secondary" disabled={busy} onClick={refresh}>Atualizar assinaturas</button>
 </section>;
}
