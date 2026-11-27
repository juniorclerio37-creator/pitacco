import React,{useState} from 'react';
import PagBankSandbox from './PagBankSandbox.jsx';

export const paymentHomologationProviders={
 mercado_pago:'Mercado Pago',
 pagbank:'PagBank (PagSeguro)',
 infinitepay:'InfinitePay',
};

const guides={
 mercado_pago:{url:'https://www.mercadopago.com.br/developers/pt/docs/checkout-api-orders/integration-test/pix',
  title:'Abrir instruções do Mercado Pago para teste Pix',
  steps:'Crie uma ordem de teste pela documentação. Use o ID ORD… da Orders API ou o ID numérico de um pagamento de teste.'},
 pagbank:{url:'https://developer.pagbank.com.br/docs/ambientes-disponiveis',
  title:'Abrir instruções do Sandbox PagBank',
  steps:'Gere o Token Sandbox e crie um pedido de teste no PagBank. Use o ID ORDE_… do pedido ou CHAR_… da cobrança.'},
};
const brl=new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'});

export default function PaymentHomologation({client,store,provider,onEvidence,merchant=false}){
 const [busy,setBusy]=useState(false),[result,setResult]=useState(null),[failure,setFailure]=useState('');
 const infinite=provider==='infinitepay';
 const providerLabel=paymentHomologationProviders[provider];
 const referenceLabel=provider==='mercado_pago'?'ID do pagamento ou da ordem de teste'
  :provider==='pagbank'?'ID do pedido (ORDE_) ou da cobrança (CHAR_)':'Número da transação do pedido (order_nsu)';
 async function check(event){
  event.preventDefault();
  const form=event.currentTarget;
  const values=new FormData(form);
  const input=Object.fromEntries(values);
  form.elements.token.value='';
  setBusy(true);setFailure('');setResult(null);
  try{
   const response=await client.functions.invoke(merchant?'merchant-payment-test':'payment-homologation',{body:{
    ...input,token:input.token.trim(),reference:input.reference.trim(),provider,store_id:store,expected_cents:Math.round(Number(input.amount)*100),
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
 return <>{provider==='pagbank'&&<PagBankSandbox key={store} client={client} store={store} onEvidence={onEvidence}/>}<form onSubmit={check} className="panel" autoComplete="off">
  <h3>Consultar pagamento de teste · {providerLabel}</h3>
   {guides[provider]&&<>
   <p>{guides[provider].steps}</p>
   <a href={guides[provider].url} target="_blank" rel="noopener noreferrer">{guides[provider].title}</a>
  </>}
  {!store&&<p>Selecione o estabelecimento usado no teste.</p>}
  <fieldset disabled={!store||busy}>
   <legend>Dados da consulta</legend>
   <label>{provider==='mercado_pago'?'Access Token de teste':infinite?'Chave de API':'Token Sandbox'}
    <input name="token" type="password" required autoComplete="off" spellCheck="false" maxLength="512"/>
   </label>
   <label>{referenceLabel}<input name="reference" required maxLength="140"/></label>
   {infinite&&<>
    <label>Identificação da conta (handle)<input name="handle" required maxLength="140"/></label>
    <label>Código da fatura (slug)<input name="slug" required maxLength="140"/></label>
    <label>Identificador da transação (transaction_nsu)<input name="transaction" required maxLength="140"/></label>
   </>}
   <label>Valor esperado em reais<input name="amount" type="number" required min=".01" max="10000" step=".01"/></label>
   <button>{busy?'Consultando…':merchant?'Testar conexão (pagamento de teste)':'Consultar pagamento'}</button>
  </fieldset>
  {failure&&<p role="alert">{failure}</p>}
  {result&&<div>
   <p role="status">{result.confirmed?'Pagamento confirmado pelo provedor.':'Pagamento sem confirmação.'} {result.amount_matches?'Valor confere.':result.amount_cents===null?'Valor ainda indisponível.':'Valor divergente.'}</p>
   {result.environment&&<p>Ambiente de teste · {result.reference}{result.provider_status&&' · '+result.provider_status}
    {Number.isInteger(result.amount_cents)&&' · '+brl.format(result.amount_cents/100)}</p>}
   {result.reference&&onEvidence&&<button type="button" className="secondary" onClick={()=>onEvidence(result)}>Usar resultado no registro</button>}
  </div>}
 </form></>;
}
