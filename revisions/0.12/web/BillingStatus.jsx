import React,{useEffect,useState} from 'react';

const labels={trial:'Período de teste',active:'Ativa · pagamento confirmado',overdue:'Vencida',legacy:'Cadastro anterior à cobrança'};
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
 const {result,error,busy,refresh}=useBilling(client,'pitacco_store_subscription_status',{p_store:storeId});
 const deadline=result?.paid_until||result?.trial_ends_at;
 return <section aria-label="Situação da assinatura" aria-busy={busy}>
  {busy&&!result&&<p role="status">Consultando assinatura…</p>}
  {error&&<p role="alert">{error}</p>}
  {result&&<>
   <div className="line"><b>Situação</b><span>{labels[result.status]}</span></div>
   {deadline&&<div className="line"><b>{result.paid_until?'Cobertura paga até':'Fim do teste'}</b><span>{date.format(new Date(deadline))}</span></div>}
   {result.orders_blocked&&<p role="alert">Novos pedidos bloqueados. Os pedidos em andamento continuam disponíveis.</p>}
   {result.status==='overdue'&&result.regularization_url&&<a href={result.regularization_url} rel="noreferrer">Regularizar assinatura</a>}
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
