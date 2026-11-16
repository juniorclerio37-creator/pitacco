import React,{useState} from 'react';

export const paymentHomologationProviders={
 mercado_pago:'Mercado Pago',
 pagbank:'PagBank (PagSeguro)',
 infinitepay:'InfinitePay',
};

export default function PaymentHomologation({client,store,provider}){
 const [busy,setBusy]=useState(false),[result,setResult]=useState(null),[failure,setFailure]=useState('');
 const infinite=provider==='infinitepay';
 const providerLabel=paymentHomologationProviders[provider];
 const referenceLabel=provider==='mercado_pago'?'ID do pagamento de teste'
  :provider==='pagbank'?'ID da cobrança Sandbox (CHAR_)':'Número da transação do pedido (order_nsu)';
 async function check(event){
  event.preventDefault();
  const form=event.currentTarget;
  const values=new FormData(form);
  const input=Object.fromEntries(values);
  form.elements.token.value='';
  setBusy(true);setFailure('');setResult(null);
  try{
   const response=await client.functions.invoke('payment-homologation',{body:{
    ...input,provider,store_id:store,expected_cents:Math.round(Number(input.amount)*100),
   }});
   if(response.error){
    const detail=response.error.context instanceof Response
     ? await response.error.context.clone().json().catch(()=>null):null;
    throw Error(detail?.error||'Não foi possível consultar o provedor.');
   }
   setResult(response.data);
  }catch(error){setFailure(error.message||'Não foi possível consultar o provedor.');}
  finally{setBusy(false);}
 }
 return <form onSubmit={check} className="panel" autoComplete="off">
  <h3>Consultar pagamento de teste · {providerLabel}</h3>
  <p>Consulte um pagamento existente e compare o valor esperado. Registre o resultado da homologação abaixo.</p>
  <fieldset disabled={!store||busy}>
   <legend>Dados da consulta</legend>
   <label>{provider==='mercado_pago'?'Access Token de teste (TEST-)':infinite?'Chave de API':'Token Sandbox'}
    <input name="token" type="password" required autoComplete="off" maxLength="512"/>
   </label>
   <label>{referenceLabel}<input name="reference" required maxLength="140"/></label>
   {infinite&&<>
    <label>Identificação da conta (handle)<input name="handle" required maxLength="140"/></label>
    <label>Código da fatura (slug)<input name="slug" required maxLength="140"/></label>
    <label>Identificador da transação (transaction_nsu)<input name="transaction" required maxLength="140"/></label>
   </>}
   <label>Valor esperado em reais<input name="amount" type="number" required min=".01" max="10000" step=".01"/></label>
   <button>{busy?'Consultando…':'Consultar pagamento'}</button>
  </fieldset>
  {failure&&<p role="alert">{failure}</p>}
  {result&&<p role="status">{result.confirmed?'Pagamento confirmado pelo provedor.':'Pagamento sem confirmação.'} {result.amount_matches?'Valor confere.':'Valor divergente.'}</p>}
 </form>;
}
