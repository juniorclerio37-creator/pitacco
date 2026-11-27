import {MerchantPlanChange} from './PlanChange.jsx';
import React,{useEffect,useState} from 'react';
import {Crown,Wallet,CreditCard,QrCode,History,Receipt,CalendarDays,Clock,RefreshCw,ShieldCheck,CheckCircle,Copy,ExternalLink} from 'lucide-react';
import './subscription-modern.css';

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


const dayLabel=v=>v?String(v).slice(0,10).split('-').reverse().join('/'):'—';
const invoicePeriod=r=>{if(r.activation_pending)return 'A partir da confirmação do pagamento';if(!r.period_start||!r.period_end)return 'Período cadastrado na fatura';const end=new Date(r.period_end+'T00:00:00Z');end.setUTCDate(end.getUTCDate()-1);return dayLabel(r.period_start)+' a '+dayLabel(end.toISOString());};
const invoicePlan=r=>r.plan_code==='free'||r.kind==='commission'?'Completo Flex':r.plan_code==='complete'?'Completo Fixo':'Mensalidade';
function CommercialPayments({client,storeId,onPaid}){
 const [manual,setManual]=useState(null),[proof,setProof]=useState(null),[pix,setPix]=useState(null),[notice,setNotice]=useState('');
 const [rows,setRows]=useState([]),[error,setError]=useState(''),[busy,setBusy]=useState(false),[method,setMethod]=useState('PIX'),[selected,setSelected]=useState(null),[result,setResult]=useState(null),[revision,reload]=useState(0);
 useEffect(()=>{let live=true;setRows([]);setManual(null);setProof(null);setPix(null);setSelected(null);setResult(null);setError('');client.rpc('pitacco_commercial_invoices',{p_store:storeId,p_page:0}).then(({data,error})=>{if(!live)return;if(error)setError('Não foi possível consultar as cobranças.');else setRows(Array.isArray(data?.rows)?data.rows:[])});client.rpc('pitacco_merchant_commercial_billing_state',{p_store:storeId}).then(({data,error})=>{if(live&&!error)setPix(data)});return()=>{live=false}},[client,storeId,revision]);
 async function pay(){if(busy||!selected||!(selected.asaas_customer_linked||selected.payer_document_ready))return;setBusy(true);setError('');setResult(null);try{const {data,error}=await client.functions.invoke('pitacco-asaas-commercial-pix',{body:{invoice_id:selected.id,method}});if(error||data?.error)throw Error(data?.error||'Não foi possível gerar ou consultar a cobrança. Tente novamente ou fale com o suporte.');if(['processed','duplicate'].includes(data?.status)){setSelected(null);reload(n=>n+1);onPaid?.();return;}const url=new URL(data.invoice_url);if(url.protocol!=='https:'||!(url.hostname==='asaas.com'||url.hostname.endsWith('.asaas.com'))||url.username||url.password)throw Error('Endereço de pagamento inválido');setResult({...data,invoice_url:url.href});}catch(e){setError(e.message||'Pagamento indisponível.')}finally{setBusy(false)}}
 async function submitProof(){if(busy||!manual||!proof)return;setBusy(true);setError('');try{if(proof.size>2097152||!['application/pdf','image/jpeg','image/png'].includes(proof.type))throw Error('Envie PDF, JPG ou PNG de até 2 MB.');const dataUrl=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=reject;reader.readAsDataURL(proof)});const {error}=await client.rpc('pitacco_submit_commercial_payment',{p_invoice:manual.id,p_reference:'pitacco:manual:'+manual.id,p_mime:proof.type,p_proof:String(dataUrl).split(',')[1]});if(error)throw error;setNotice('Comprovante enviado. Aguarde a aprovação do Super Admin.');setManual(null);setProof(null);reload(n=>n+1)}catch(e){setError(e.message||'Não foi possível enviar o comprovante.')}finally{setBusy(false)}}
 return <section id="pitacco-commercial-payments" className="sub-card" aria-label="Cobranças e pagamentos"><div className="sub-heading"><span className="sub-icon"><Wallet/></span><div><h3>Cobranças e pagamentos</h3><p>Gerencie suas faturas e mantenha seu plano ativo.</p></div><button type="button" className="sub-refresh secondary" disabled={busy} onClick={()=>reload(n=>n+1)} aria-label="Atualizar cobranças"><RefreshCw size={17}/></button></div>
 {error&&<p role="alert">{error}</p>}{notice&&<p role="status">{notice}</p>}

 {!rows.length&&<p>Nenhuma cobrança disponível neste momento.</p>}
 {rows.map(r=><article key={r.id} className="sub-invoice"><div className="sub-invoice-summary"><div><Receipt size={20}/><span><small>{r.kind==='monthly'?'Mensalidade':'Comissão semanal'}</small><strong>{money.format(r.amount_cents/100)}</strong></span></div><div><CalendarDays size={20}/><span><small>{r.activation_pending?'Pagamento':'Vencimento'}</small><b>{r.activation_pending?'Antes da ativação':date.format(new Date(r.due_at))}</b></span></div><div><Clock size={20}/><span><small>Status</small><b className={'sub-status '+(['paid','recovery_paid','waived'].includes(r.status)?'is-ok':'is-wait')}>{r.activation_pending&&['open','overdue','grace'].includes(r.status)?'Aguardando pagamento':({paid:'Pago',open:'Em aberto',overdue:'Vencido',grace:'Em tolerância',review_required:'Em conciliação',recovery_due:'Saldo de estorno a regularizar',recovery_paid:'Saldo recuperado',waived:'Saldo dispensado'})[r.status]||r.status}</b></span></div></div>
 {r.status==='recovery_due'&&<p role="alert">Saldo a regularizar: {money.format(r.recovery_amount_cents/100)} até {date.format(new Date(r.recovery_due_at))}. Envie o comprovante pelo Pix manual.</p>}{r.status==='review_required'&&<p>O financeiro está conferindo esta fatura. Não pague novamente antes da orientação.</p>}{r.status==='paid'&&r.payment_source&&<small>Pagamento confirmado: {r.payment_source==='asaas'?'Asaas':'Pix manual'}</small>}
 <div className="sub-methods">{['open','overdue','grace'].includes(r.status)&&r.asaas_resolution!=='manual_only'&&r.claim_status!=='pending'&&<>{r.asaas_reserved?<button type="button" disabled={busy} onClick={()=>{setManual(null);setSelected(r);setMethod('PIX');setResult(null);setError('');setNotice('')}}><RefreshCw size={18}/>Consultar pagamento</button>:<><button type="button" disabled={busy} onClick={()=>{setManual(null);setSelected(r);setMethod('PIX');setResult(null);setError('');setNotice('')}}><QrCode size={18}/>Pix Automático</button><button type="button" className="secondary" disabled={busy} onClick={()=>{setManual(null);setSelected(r);setMethod('CREDIT_CARD');setResult(null);setError('');setNotice('')}}><CreditCard size={18}/>Cartão de crédito</button></>}</>}
 {['open','overdue','grace','recovery_due'].includes(r.status)&&(!r.asaas_reserved||['manual_only','recovery_due'].includes(r.asaas_resolution))&&r.claim_status!=='pending'&&pix?.pix_cnpj&&pix?.pix_recipient&&<button type="button" className="secondary" disabled={busy} onClick={()=>{setSelected(null);setResult(null);setManual(r);setProof(null);setError('');setNotice('')}}><Receipt size={18}/>Pix Manual</button>}</div>
 {r.claim_status==='rejected'&&<p>Comprovante recusado: {r.review_note||'Consulte o suporte.'}</p>}
 {r.claim_status==='pending'&&<p>Comprovante em análise. Não efetue outro pagamento.</p>}</article>)}
 {manual&&<div className="sub-payment-form"><h4>Pix Manual · {money.format((manual.status==='recovery_due'?manual.recovery_amount_cents:manual.amount_cents)/100)}</h4><p>Favorecido: {pix.pix_recipient}</p><label>Chave Pix CNPJ<input readOnly value={pix.pix_cnpj}/></label><button type="button" className="secondary" onClick={()=>navigator.clipboard?.writeText(pix.pix_cnpj)}>Copiar chave</button><p>{['manual_only','recovery_due'].includes(manual.asaas_resolution)?'Pague somente o saldo autorizado pelo financeiro.':'Não pague se já tiver iniciado um pagamento automático.'}</p><section className="sub-manual-identity" aria-label="Identificação automática do pagamento"><h4>Identificação do pagamento</h4><p><b>Loja:</b> {manual.store_name||'Estabelecimento selecionado'}</p><p><b>CPF/CNPJ:</b> {manual.fiscal_identity||'Não disponível no cadastro'}</p><p><b>Plano:</b> {invoicePlan(manual)}</p><p><b>Período:</b> {invoicePeriod(manual)}</p><p><b>Fatura:</b> <span style={{overflowWrap:'anywhere'}}>{manual.id}</span></p><small>Identificação automática, não editável. Anexe somente o comprovante.</small></section><label>Comprovante (PDF, JPG ou PNG, até 2 MB)<input type="file" accept="application/pdf,image/jpeg,image/png" onChange={e=>setProof(e.target.files?.[0]||null)}/></label><button type="button" disabled={busy||!proof} onClick={submitProof}>Enviar comprovante</button><button type="button" className="secondary" disabled={busy} onClick={()=>setManual(null)}>Voltar</button></div>}
 {selected&&<div className="sub-payment-form"><div className="sub-heading"><span className="sub-icon">{method==='PIX'?<QrCode/>:<CreditCard/>}</span><div><h4>{selected.asaas_reserved?'Consultar pagamento':method==='PIX'?'Pix Automático':'Cartão de crédito'}</h4><p>Pagamento de {money.format(selected.amount_cents/100)}</p></div></div>
 {!(selected.asaas_customer_linked||selected.payer_document_ready)&&!result?<p role="alert" className="sub-warning">Complete Configurações → Dados da loja uma única vez. O Pitacco utilizará esse cadastro para gerar seus pagamentos. Depois, atualize as cobranças.</p>:!result&&<p className="sub-secure"><ShieldCheck size={18}/>Utilizaremos os dados cadastrados no Pitacco. Você não precisa ter conta no provedor de pagamento.</p>}
 {!result&&<button type="button" disabled={busy||!(selected.asaas_customer_linked||selected.payer_document_ready)} onClick={pay}>{busy?'Consultando…':selected.asaas_reserved?'Consultar cobrança':method==='PIX'?'Gerar Pix Automático':'Continuar para pagamento'}</button>}
 {result&&<><p>Acesse a fatura na forma escolhida. A confirmação será automática após o recebimento.</p><a className="button sub-link" href={result.invoice_url} target="_blank" rel="noopener noreferrer"><ExternalLink size={16}/>Abrir pagamento seguro</a>{result.payload&&<>{typeof result.encodedImage==='string'&&/^[A-Za-z0-9+/=]+$/.test(result.encodedImage)&&result.encodedImage.length<500000&&<img className="sub-qr" alt="QR Code do Pix" src={'data:image/png;base64,'+result.encodedImage}/>}<label>Pix Copia e Cola<textarea readOnly value={result.payload}/></label><button type="button" onClick={()=>navigator.clipboard?.writeText(result.payload)}><Copy size={16}/>Copiar código Pix</button></>}<button type="button" className="secondary" disabled={busy} onClick={pay}>Já paguei · atualizar</button></>}
 <button type="button" className="secondary" disabled={busy} onClick={()=>{setSelected(null);setResult(null)}}>Fechar</button></div>}
 <p className="sub-secure"><ShieldCheck size={16}/>Pagamento protegido. Não pague a mesma fatura por dois métodos.</p></section>;
}

export default function BillingStatus({client,storeId}){
 const {result,error,busy,refresh}=useBilling(client,'pitacco_merchant_subscription_details',{p_store:storeId});
 const [planRevision,setPlanRevision]=useState(0),[paymentRevision,setPaymentRevision]=useState(0);
 const deadline=result?.paid_until||result?.trial_ends_at;
 const stage=result?.first_payment_stage;
 const needsPlan=result?.plan_access==='selection_required',needsPayment=result?.plan_access==='payment_required';
 const graceUntil=result?.first_payment_grace_until;
 return <section className="sub-workspace" aria-label="Situação da assinatura" aria-busy={busy}>
  {busy&&!result&&<p role="status">Consultando assinatura…</p>}
  {error&&<p role="alert">{error}</p>}
  {result&&<>
   <div className="sub-hero"><span className="sub-icon sub-hero-icon"><Crown size={32}/></span><div><h3>Assinatura</h3><p>{({free:'Completo Flex',complete:'Completo Fixo'})[result.plan_code]||(needsPayment?'Completo Fixo · aguardando ativação':'Nenhum plano contratado')}</p><span className={'sub-status '+(result.status==='active'?'is-ok':'is-wait')}>{needsPlan?'Escolha obrigatória':needsPayment?'Aguardando pagamento':stage==='grace'?'Aguardando primeiro pagamento · tolerância de 48h':result.plan_code==='free'&&result.status==='active'?'Ativa · comissão semanal':labels[result.status]||result.status}</span></div><Crown className="sub-hero-decoration" aria-hidden="true"/></div><div className="sub-details">
   {!needsPlan&&(result.registered_monthly_amount??result.amount)!=null&&<div className="line"><b>Valor informado pela cobrança</b><span>{money.format(Number(result.registered_monthly_amount??result.amount))}</span></div>}
   {result.due_date&&<div className="line"><b>Vencimento cadastrado</b><span>{result.due_date.split('-').reverse().join('/')}</span></div>}
   {result.status==='trial'&&result.trial_ends_at&&<div className="line"><b>Dias restantes de teste</b><span>{Math.max(0,Math.ceil((new Date(result.trial_ends_at)-Date.now())/86400000))}</span></div>}
   {deadline&&<div className="line"><b>{result.paid_until?'Cobertura paga até':'Fim do teste'}</b><span>{date.format(new Date(deadline))}</span></div>}
   {stage==='due_today'&&<p role="alert">Seu período de teste termina hoje. Efetue o pagamento de R$ 59,90 para continuar utilizando o Pitacco.</p>}
   {stage==='grace'&&graceUntil&&<p role="alert">Seu teste terminou. Efetue o pagamento de R$ 59,90 até {date.format(new Date(graceUntil))} para evitar o bloqueio de novos pedidos.</p>}
   {stage==='blocked'&&!result.orders_blocked&&<p role="alert">O prazo de regularização do primeiro pagamento terminou. Efetue o pagamento de R$ 59,90.</p>}
   {needsPlan&&<p role="alert">Escolha e confirme um plano abaixo para receber novos pedidos. A cortesia não substitui a contratação.</p>}{needsPayment&&<p role="alert">Pague a primeira mensalidade do Completo Fixo para ativar o plano.</p>}{result.orders_blocked&&<p role="alert">Novos pedidos bloqueados. Os pedidos em andamento continuam disponíveis.</p>}
   {(result.status==='overdue'||stage==='due_today'||stage==='grace')&&result.regularization_url&&<a href={result.regularization_url} rel="noreferrer">Regularizar assinatura</a>}
   </div><details className="sub-card sub-paid-history"><summary><History size={19}/>Histórico de pagamentos confirmados</summary>
   {result.payments?.length?<div style={{overflowX:'auto'}}><table><thead><tr><th>Pagamento</th><th>Provedor</th><th>Valor</th><th>Cobertura até</th></tr></thead><tbody>{result.payments.map((p,i)=><tr key={i}><td>{date.format(new Date(p.confirmed_at))}</td><td>{p.provider}</td><td>{money.format(Number(p.amount))}</td><td>{date.format(new Date(p.paid_until))}</td></tr>)}</tbody></table></div>:<p>Nenhum pagamento confirmado registrado.</p>}</details>
  </>}
  <button type="button" className="secondary" disabled={busy} onClick={refresh}>Atualizar situação</button>
  <MerchantPlanChange key={storeId+':'+planRevision} client={client} storeId={storeId} currentPlan={result?.plan_code} onChanged={()=>{refresh();setPaymentRevision(n=>n+1)}}>
   <CommercialPayments key={'payments-'+storeId+':'+paymentRevision} client={client} storeId={storeId} onPaid={()=>{refresh();setPlanRevision(n=>n+1)}}/>
  </MerchantPlanChange>
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

export function CommercialBillingNotice({client,storeId,onRegularize}){
 const [state,setState]=useState(null);
 useEffect(()=>{let live=true;setState(null);async function refresh(){try{const {data,error}=await client.rpc('pitacco_store_commercial_block_status',{p_store:storeId});if(live&&!error)setState(data)}catch{}}refresh();const timer=setInterval(refresh,30000);window.addEventListener('focus',refresh);return()=>{live=false;clearInterval(timer);window.removeEventListener('focus',refresh)}},[client,storeId]);
 if(!state||(!state.orders_blocked&&!['due_today','grace','overdue'].includes(state.notice_stage)))return null;
 const blocked=state.orders_blocked,needsPlan=state.plan_access==='selection_required',needsPayment=state.plan_access==='payment_required';
 return <div role="alert" style={{margin:'8px',padding:'10px',border:'1px solid '+(blocked?'#b91c1c':'#b7791f'),borderRadius:8,background:blocked?'#fff1f2':'#fff7e6',color:'#472b19',fontSize:12}}><strong>{needsPlan?'Escolha um plano para receber pedidos':needsPayment?'Ative o plano para receber pedidos':blocked?'Inadimplência: novos pedidos bloqueados':state.notice_stage==='due_today'?'Pagamento vence hoje':state.notice_stage==='grace'?'Pagamento pendente · prazo de regularização':'Pagamento vencido'}</strong><p>{state.grace_until&&!blocked?'Regularize até '+date.format(new Date(state.grace_until))+'. ':''}{blocked?'Os pedidos em andamento continuam disponíveis. ':''}{state.awaiting_review>0?'Há comprovante em análise. ':''}{needsPlan?'Acesse Assinaturas e escolha seu plano.':'Acesse Assinaturas para regularizar.'}</p><button type="button" onClick={onRegularize}>{needsPlan?'Escolher plano':needsPayment?'Ativar plano':'Regularizar pagamento'}</button></div>;
}
