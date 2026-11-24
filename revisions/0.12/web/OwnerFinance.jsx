
import React,{useEffect,useState} from 'react';
import CommercialAmounts,{CommercialClosings,CommercialInvoices} from './CommercialAmounts.jsx';
import OwnerPaymentProofs from './OwnerPaymentProofs.jsx';

const money=new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'});
const saoPaulo=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit'});
const dateParts=date=>Object.fromEntries(saoPaulo.formatToParts(date).map(({type,value})=>[type,value]));
function periods(){
 const {year,month,day}=dateParts(new Date());
 const today=year+'-'+month+'-'+day;
 const until=new Date(today+'T12:00:00Z');
 const daysAgo=days=>new Date(until.getTime()-days*86400000).toISOString().slice(0,10);
 return {today,week:daysAgo(6),last30:daysAgo(29),month:year+'-'+month+'-01'};
}
const formatDay=value=>value.split('-').reverse().join('/');
function downloadCsv(days){
 const header='Data;Pedidos concluídos;Valor bruto dos pedidos (BRL);Pagamentos Asaas;Assinaturas confirmadas no Asaas (BRL)';
 const rows=days.map(row=>[row.day,row.orders,Number(row.gross).toFixed(2).replace('.',','),row.payments,Number(row.subscriptions).toFixed(2).replace('.',',')].join(';'));
 const url=URL.createObjectURL(new Blob(['\ufeff'+[header,...rows].join('\r\n')],{type:'text/csv;charset=utf-8'}));
 const link=document.createElement('a');
 link.href=url;link.download='pitacco-financeiro-'+days[0].day+'.csv';
 document.body.appendChild(link);link.click();link.remove();
 setTimeout(()=>URL.revokeObjectURL(url),1000);
}
export default function OwnerFinance({client,stores}){
 const [tab,setTab]=useState('overview');
 const [range,setRange]=useState(()=>{const dates=periods();return {start:dates.week,end:dates.today,store:''};});
 const [report,setReport]=useState(null),[busy,setBusy]=useState(true),[error,setError]=useState(false),[detail,setDetail]=useState(null);
 useEffect(()=>{
  const controller=new AbortController();
  let live=true;
  setBusy(true);setError(false);setReport(null);setDetail(null);
  (async()=>{
   try{
    const {data,error}=await client.rpc('pitacco_owner_finance_report',{p_start:range.start,p_end:range.end,p_store:range.store||null}).abortSignal(controller.signal);
    if(error||!Array.isArray(data?.days)||!data.days.length)throw error||Error();
    if(live)setReport(data);
   }catch{if(live)setError(true);}
   finally{if(live)setBusy(false);}
  })();
  return()=>{live=false;controller.abort();};
 },[client,range]);
 function submit(event){
  event.preventDefault();
  const form=new FormData(event.currentTarget);
  const dates=periods(),preset=form.get('preset');
  setRange({start:preset==='custom'?form.get('start'):dates[preset],end:preset==='custom'?form.get('end'):dates.today,store:form.get('store')});
 }
 const [preset,setPreset]=useState('week'),[metric,setMetric]=useState('gross');
 const max=report?Math.max(0,...report.days.map(row=>Number(row[metric]))):0;
 const metricLabel=metric==='gross'?'Valor bruto dos pedidos concluídos':'Assinaturas confirmadas no Asaas';
 return <section className="panel owner-finance-report" aria-label="Financeiro do Pitacco" aria-busy={busy}>
  <nav className="pitacco-local-tabs" aria-label="Áreas financeiras"><button type="button" aria-pressed={tab==='overview'} onClick={()=>setTab('overview')}>Visão financeira</button><button type="button" aria-pressed={tab==='proofs'} onClick={()=>setTab('proofs')}>Comprovantes de pagamento</button></nav>
  {tab==='proofs'?<OwnerPaymentProofs client={client} stores={stores}/>:<><form className="admin-finance-filters" onSubmit={submit}>
   <div className="field"><label htmlFor="finance-period">Período</label><select id="finance-period" name="preset" value={preset} onChange={event=>setPreset(event.target.value)}>
    <option value="today">Hoje</option><option value="week">7 dias</option><option value="last30">30 dias</option>
    <option value="month">Mês atual</option><option value="custom">Personalizado</option>
   </select></div>
   {preset==='custom'&&<><label className="field">Início<input type="date" name="start" defaultValue={range.start} required/></label>
    <label className="field">Fim<input type="date" name="end" defaultValue={range.end} required/></label></>}
   <div className="field"><label htmlFor="finance-store">Loja</label><select id="finance-store" name="store"><option value="">Todas as lojas</option>
    {stores.map(store=><option key={store.id} value={store.id}>{store.name}</option>)}
   </select></div>
   <button disabled={busy}>Consultar</button>
  </form>
  {range.store&&<CommercialAmounts client={client} storeId={range.store}/>}
  <CommercialClosings client={client} storeId={range.store||null} owner/>
  <CommercialInvoices client={client} storeId={range.store||null} owner/>
  {busy&&<p role="status">Consultando…</p>}
  {error&&<p role="alert">Não foi possível consultar o relatório. Confira o período e tente novamente.</p>}
  {report&&<>
   <h3>{stores.find(store=>store.id===range.store)?.name||'Todas as lojas'}</h3>
   <p>De {formatDay(range.start)} a {formatDay(range.end)} · horário de Brasília</p>
   <div className="admin-plan-grid">
    <article className="panel"><h4>Valor bruto dos pedidos concluídos nas lojas</h4><strong>{money.format(report.gross)}</strong><p>{report.orders} pedidos, agrupados pela data de entrada.</p></article>
    <article className="panel"><h4>Assinaturas do Pitacco confirmadas no Asaas</h4><strong>{money.format(report.subscriptions)}</strong><p>{report.payments} pagamentos no Asaas de produção, agrupados pela confirmação. A liquidação bancária é apurada separadamente no Asaas.</p></article>
   </div>
   <div className="quick-actions admin-report-actions">
    <button type="button" className="secondary" onClick={()=>downloadCsv(report.days)}>Baixar CSV</button>
    <button type="button" className="secondary" onClick={()=>window.print()}>Imprimir ou salvar PDF</button>
   </div>
   <div className="admin-report-chart">
    <label className="field">Indicador do gráfico<select value={metric} onChange={event=>{setMetric(event.target.value);setDetail(null);}}>
     <option value="gross">Valor bruto dos pedidos concluídos</option><option value="subscriptions">Assinaturas confirmadas no Asaas</option>
    </select></label>
    {max>0&&<div className="admin-finance-bars" role="group" aria-label={metricLabel}>
     {report.days.map(row=><button type="button" key={row.day} aria-pressed={detail===row.day}
      title={formatDay(row.day)+' · '+money.format(row[metric])} aria-label={formatDay(row.day)+' · '+money.format(row[metric])}
      style={{'--bar-height':(Number(row[metric])/max*100)+'%'}} onClick={()=>setDetail(row.day)}/>)}
    </div>}
    {detail&&<p role="status">{formatDay(detail)} · {money.format(report.days.find(row=>row.day===detail)[metric])}</p>}
    {max===0&&<p>Sem valores registrados para este indicador no período.</p>}
   </div>
   <div className="owner-dashboard-table" tabIndex={0}><table><caption>Valores por dia</caption>
    <thead><tr><th scope="col">Dia</th><th scope="col">Pedidos concluídos</th><th scope="col">Valor bruto das lojas</th><th scope="col">Pagamentos Asaas</th><th scope="col">Assinaturas confirmadas</th></tr></thead>
    <tbody>{report.days.map(row=><tr key={row.day}><th scope="row">{formatDay(row.day)}</th><td>{row.orders}</td>
     <td>{money.format(row.gross)}</td><td>{row.payments}</td><td>{money.format(row.subscriptions)}</td></tr>)}</tbody>
   </table></div>
  </>}</>}
 </section>;
}
