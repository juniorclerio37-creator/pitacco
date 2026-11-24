import {MerchantPlanChange} from './PlanChange.jsx';
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


function CommercialPayments({client,storeId,onPaid}){
 const [manual,setManual]=useState(null),[reference,setReference]=useState(''),[proof,setProof]=useState(null),[pix,setPix]=useState(null),[notice,setNotice]=useState('');
 const [rows,setRows]=useState([]),[error,setError]=useState(''),[busy,setBusy]=useState(false),[doc,setDoc]=useState(''),[selected,setSelected]=useState(null),[result,setResult]=useState(null),[revision,reload]=useState(0);
 useEffect(()=>{let live=true;setRows([]);setManual(null);setReference('');setProof(null);setPix(null);setSelected(null);setResult(null);setDoc('');setError('');client.rpc('pitacco_commercial_invoices',{p_store:storeId,p_page:0}).then(({data,error})=>{if(!live)return;if(error)setError('Não foi possível consultar as cobranças.');else setRows(Array.isArray(data?.rows)?data.rows:[])});client.rpc('pitacco_merchant_commercial_billing_state',{p_store:storeId}).then(({data,error})=>{if(live&&!error)setPix(data)});return()=>{live=false}},[client,storeId,revision]);
 async function pay(){if(busy||!selected)return;setBusy(true);setError('');setResult(null);try{const {data,error}=await client.functions.invoke('pitacco-asaas-commercial-pix',{body:{invoice_id:selected.id,document:doc.replace(/\D/g,'')}});if(error||data?.error)throw Error(data?.error||'Não foi possível gerar ou consultar a cobrança. Confira o documento cadastrado ou fale com o suporte.');if(['processed','duplicate'].includes(data?.status)){setSelected(null);setDoc('');reload(n=>n+1);onPaid?.();return;}const url=new URL(data.invoice_url);if(url.protocol!=='https:'||!(url.hostname==='asaas.com'||url.hostname.endsWith('.asaas.com'))||url.username||url.password)throw Error('Endereço de pagamento inválido');setResult({...data,invoice_url:url.href});setDoc('');}catch(e){setError(e.message||'Pagamento indisponível.')}finally{setBusy(false)}}
 async function submitProof(){if(busy||!manual||!proof||reference.trim().length<5)return;setBusy(true);setError('');try{if(proof.size>2097152||!['application/pdf','image/jpeg','image/png'].includes(proof.type))throw Error('Envie PDF, JPG ou PNG de até 2 MB.');const dataUrl=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=reject;reader.readAsDataURL(proof)});const {error}=await client.rpc('pitacco_submit_commercial_payment',{p_invoice:manual.id,p_reference:reference.trim(),p_mime:proof.type,p_proof:String(dataUrl).split(',')[1]});if(error)throw error;setNotice('Comprovante enviado. Aguarde a aprovação do Super Admin.');setManual(null);setProof(null);setReference('');reload(n=>n+1)}catch(e){setError(e.message||'Não foi possível enviar o comprovante.')}finally{setBusy(false)}}
 return <section className="panel" aria-label="Cobranças e pagamentos"><h3>Cobranças e pagamentos</h3><p>Pix e cartão de crédito na página segura do Asaas. O valor é definido pelo Pitacco. Nenhum dado de cartão é armazenado aqui.</p>
 {error&&<p role="alert">{error}</p>}{notice&&<p role="status">{notice}</p>}
 <button type="button" className="secondary" disabled={busy} onClick={()=>reload(n=>n+1)}>Atualizar cobranças</button>
 {!rows.length&&<p>Nenhuma cobrança disponível neste momento.</p>}
 {rows.map(r=><article key={r.id} style={{padding:'14px 0',borderBottom:'1px solid var(--line,#e4e7eb)'}}><div className="line"><b>{r.kind==='monthly'?'Mensalidade':'Comissão semanal'}</b><strong>{money.format(r.amount_cents/100)}</strong></div><p>Vencimento: {date.format(new Date(r.due_at))} · {({paid:'Pago',open:'Em aberto',overdue:'Vencido',grace:'Em tolerância',review_required:'Em conciliação'})[r.status]||r.status}</p>
 {r.status==='paid'&&r.payment_source&&<small>Pagamento confirmado: {r.payment_source==='asaas'?'Asaas':'Pix manual'}</small>}
 {['open','overdue','grace'].includes(r.status)&&r.claim_status!=='pending'&&<button type="button" disabled={busy} onClick={()=>{setManual(null);setSelected(r);setDoc('');setResult(null);setError('');setNotice('')}}>{r.asaas_reserved?'Consultar pagamento Asaas':'Pagar com Pix ou cartão'}</button>}
 {['open','overdue','grace'].includes(r.status)&&!r.asaas_reserved&&r.claim_status!=='pending'&&pix?.pix_cnpj&&pix?.pix_recipient&&<button type="button" className="secondary" disabled={busy} onClick={()=>{setSelected(null);setResult(null);setDoc('');setManual(r);setReference('');setProof(null);setError('');setNotice('')}}>Pix manual · enviar comprovante</button>}
 {r.claim_status==='rejected'&&<p>Comprovante recusado: {r.review_note||'Consulte o suporte.'}</p>}
 {r.claim_status==='pending'&&<p>Comprovante em análise. Não efetue outro pagamento.</p>}</article>)}
 {manual&&<div style={{paddingTop:16}}><h4>Pix manual de {money.format(manual.amount_cents/100)}</h4><p>Favorecido: {pix.pix_recipient}</p><label>Chave Pix CNPJ<input readOnly value={pix.pix_cnpj}/></label><button type="button" className="secondary" onClick={()=>navigator.clipboard?.writeText(pix.pix_cnpj)}>Copiar chave</button><p>Não pague se já tiver iniciado uma cobrança pelo Asaas.</p><label>Identificador do pagamento<input value={reference} maxLength={160} onChange={e=>setReference(e.target.value)}/></label><label>Comprovante (PDF, JPG ou PNG, até 2 MB)<input type="file" accept="application/pdf,image/jpeg,image/png" onChange={e=>setProof(e.target.files?.[0]||null)}/></label><button type="button" disabled={busy||!proof||reference.trim().length<5} onClick={submitProof}>Enviar comprovante</button><button type="button" className="secondary" disabled={busy} onClick={()=>setManual(null)}>Voltar</button></div>}
 {selected&&<div style={{paddingTop:16}}><h4>Pagamento de {money.format(selected.amount_cents/100)}</h4>
 {!selected.asaas_customer_linked&&!result&&<label>CNPJ da empresa (preferencial) ou CPF já cadastrado<input value={doc} onChange={e=>setDoc(e.target.value.replace(/\D/g,'').slice(0,14))} inputMode="numeric" autoComplete="off" maxLength={14}/></label>}
 {!result&&<button type="button" disabled={busy||(!selected.asaas_customer_linked&&![11,14].includes(doc.length))} onClick={pay}>{busy?'Consultando…':'Abrir opções de pagamento'}</button>}
 {result&&<><p>Escolha a forma disponível na fatura do Asaas. A confirmação será automática após o recebimento.</p><a className="button" href={result.invoice_url} target="_blank" rel="noopener noreferrer">Abrir fatura segura do Asaas</a>{result.payload&&<><label>Pix Copia e Cola<textarea readOnly value={result.payload}/></label><button type="button" onClick={()=>navigator.clipboard?.writeText(result.payload)}>Copiar código Pix</button></> }<button type="button" className="secondary" onClick={()=>{reload(n=>n+1);onPaid?.()}}>Já paguei · atualizar</button></>}
 <button type="button" className="secondary" disabled={busy} onClick={()=>{setSelected(null);setResult(null);setDoc('')}}>Fechar</button></div>}
 <p><small>O Pix manual continua disponível quando configurado, desde que a mesma fatura não esteja reservada para pagamento pelo Asaas.</small></p></section>;
}

export default function BillingStatus({client,storeId}){
 const {result,error,busy,refresh}=useBilling(client,'pitacco_merchant_subscription_details',{p_store:storeId});
 const deadline=result?.paid_until||result?.trial_ends_at;
 const stage=result?.first_payment_stage;
 const graceUntil=result?.first_payment_grace_until;
 return <section aria-label="Situação da assinatura" aria-busy={busy}>
  {busy&&!result&&<p role="status">Consultando assinatura…</p>}
  {error&&<p role="alert">{error}</p>}
  {result&&<>
   <div className="line"><b>Situação</b><span>{stage==='grace'?'Aguardando primeiro pagamento · tolerância de 48h':labels[result.status]||result.status}</span></div>
   {result.plan_code&&<div className="line"><b>Plano atual</b><span>{{saas:'Pitacco (contrato atual)',pitacco:'Pitacco',free:'Completo Flex',complete:'Completo Fixo'}[result.plan_code]||result.plan_code}</span></div>}
   {(result.registered_monthly_amount??result.amount)!=null&&<div className="line"><b>Valor informado pela cobrança</b><span>{money.format(Number(result.registered_monthly_amount??result.amount))}</span></div>}
   {result.due_date&&<div className="line"><b>Vencimento cadastrado</b><span>{result.due_date.split('-').reverse().join('/')}</span></div>}
   {result.status==='trial'&&result.trial_ends_at&&<div className="line"><b>Dias restantes de teste</b><span>{Math.max(0,Math.ceil((new Date(result.trial_ends_at)-Date.now())/86400000))}</span></div>}
   {deadline&&<div className="line"><b>{result.paid_until?'Cobertura paga até':'Fim do teste'}</b><span>{date.format(new Date(deadline))}</span></div>}
   {stage==='due_today'&&<p role="alert">Seu período de teste termina hoje. Efetue o pagamento de R$ 59,90 para continuar utilizando o Pitacco.</p>}
   {stage==='grace'&&graceUntil&&<p role="alert">Seu teste terminou. Efetue o pagamento de R$ 59,90 até {date.format(new Date(graceUntil))} para evitar o bloqueio de novos pedidos.</p>}
   {stage==='blocked'&&!result.orders_blocked&&<p role="alert">O prazo de regularização do primeiro pagamento terminou. Efetue o pagamento de R$ 59,90.</p>}
   {result.orders_blocked&&<p role="alert">Novos pedidos bloqueados. Os pedidos em andamento continuam disponíveis.</p>}
   {(result.status==='overdue'||stage==='due_today'||stage==='grace')&&result.regularization_url&&<a href={result.regularization_url} rel="noreferrer">Regularizar assinatura</a>}
   <h4>Histórico de pagamentos confirmados</h4>
   {result.payments?.length?<div style={{overflowX:'auto'}}><table><thead><tr><th>Pagamento</th><th>Provedor</th><th>Valor</th><th>Cobertura até</th></tr></thead><tbody>{result.payments.map((p,i)=><tr key={i}><td>{date.format(new Date(p.confirmed_at))}</td><td>{p.provider}</td><td>{money.format(Number(p.amount))}</td><td>{date.format(new Date(p.paid_until))}</td></tr>)}</tbody></table></div>:<p>Nenhum pagamento confirmado registrado.</p>}
  </>}
  <button type="button" className="secondary" disabled={busy} onClick={refresh}>Atualizar situação</button>
  <CommercialPayments key={'payments-'+storeId} client={client} storeId={storeId} onPaid={refresh}/>
  <MerchantPlanChange key={storeId} client={client} storeId={storeId}/>
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
