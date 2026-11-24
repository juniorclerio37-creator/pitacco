import MarketplaceReconciliation from './MarketplaceReconciliation.jsx';
import OrderProfitReport from './OrderProfitReport.jsx';
import React, {useEffect, useRef, useState} from 'react';

const dateFormat = new Intl.DateTimeFormat('sv-SE', {timeZone:'America/Sao_Paulo'});
const money = new Intl.NumberFormat('pt-BR', {style:'currency',currency:'BRL'});
const decimal = new Intl.NumberFormat('pt-BR', {useGrouping:false,minimumFractionDigits:2,maximumFractionDigits:2});
const labels = {
  vendas: 'Vendas registradas',
  taxas: 'Taxas registradas',
  pedidos_pendentes: 'Pedidos aguardando aceite',
  recebimentos: 'Recebimentos confirmados no caixa',
  recebimentos_fiado: 'Recebimentos registrados na caderneta',
  fiado_a_receber: 'Fiado em aberto — saldo atual das vendas do período',
  fiado_reservado: 'Fiado reservado — pedidos do período ainda não entregues',
  despesas: 'Despesas lançadas',
  acertos_entregadores: 'Pagamentos registrados aos entregadores'
};

function csvValue(value) {
  const text = String(value);
  const safe = /^[=+@\-\t\r]/.test(text) ? "'" + text : text;
  return '"' + safe.replaceAll('"','""') + '"';
}

export default function FinancialReport({client,store,initialView='report',navigationKey}) {
  const today = dateFormat.format(new Date());
  const [view,setView]=useState(initialView);
  useEffect(()=>setView(initialView),[initialView,navigationKey]);
  const [start,setStart] = useState(today.slice(0,8)+'01');
  const [end,setEnd] = useState(today);
  const [report,setReport] = useState(null);
  const [busy,setBusy] = useState(false);
  const [error,setError] = useState('');
  const table = useRef(null);

  async function load(event) {
    event.preventDefault();
    setBusy(true);
    setError('');
    setReport(null);
    try {
      const {data,error} = await client.rpc('pitacco_period_financial_report',{p_store:store.id,p_start:start,p_end:end});
      if (error) throw error;
      const rows = [...data].sort((a,b)=>
        Object.keys(labels).indexOf(a.metric)-Object.keys(labels).indexOf(b.metric)||
        String(a.channel||'').localeCompare(String(b.channel||''),'pt-BR'));
      setReport({start,end,rows});
    } catch (failure) {
      setError(failure.message || 'Não foi possível gerar o relatório.');
    } finally {
      setBusy(false);
    }
  }

  function download() {
    setError('');
    const rows = [
      ['Início','Fim','Indicador','Canal','Registros','Valor (R$)'],
      ...report.rows.map(row=>[report.start,report.end,labels[row.metric],row.channel||'',row.entries,decimal.format(row.amount)])
    ];
    const file = new Blob(['\uFEFF',rows.map(row=>row.map(csvValue).join(';')).join('\r\n')], {type:'text/csv;charset=utf-8'});
    const url = URL.createObjectURL(file);
    const link = document.createElement('a');
    link.href=url;
    link.download=`pitacco-financeiro-${report.start}_${report.end}.csv`;
    link.click();
    setTimeout(()=>URL.revokeObjectURL(url),1000);
  }

  function print() {
    setError('');
    const preview = window.open('','_blank','popup,width=860,height=720');
    if (!preview) {
      setError('Permita a abertura da janela do relatório e tente novamente.');
      return;
    }
    preview.opener=null;
    const doc = preview.document;
    doc.title = 'Relatório financeiro Pitacco';
    const style = doc.createElement('style');
    style.textContent = 'body{font:14px system-ui;color:#29221d;margin:30px}h1{font-size:22px}table{border-collapse:collapse;width:100%}th,td{padding:9px;border-bottom:1px solid #ddd;text-align:left}tr{break-inside:avoid}th{border-top:2px solid #d45c26}';
    doc.head.append(style);
    const heading = doc.createElement('h1');
    heading.textContent = 'Relatório financeiro — ' + store.name;
    const period = doc.createElement('p');
    period.textContent = `Período de ${report.start.split('-').reverse().join('/')} a ${report.end.split('-').reverse().join('/')}`;
    doc.body.append(heading,period,table.current.cloneNode(true));
    preview.focus();
    preview.print();
  }

  return <>
    <div className="pitacco-local-tabs" role="group" aria-label="Tipos de relatório">
      <button type="button" className={view==='report'?'active':'secondary'} onClick={()=>setView('report')}>Resumo financeiro</button>
      <button type="button" className={view==='orders'?'active':'secondary'} onClick={()=>setView('orders')}>Resultado por pedido</button>
      <button type="button" className={view==='settlement'?'active':'secondary'} onClick={()=>setView('settlement')}>Conciliação de repasses</button>
    </div>
    {view==='settlement'&&<MarketplaceReconciliation client={client} storeId={store.id}/>}
    {view==='orders'&&<OrderProfitReport client={client} storeId={store.id}/>}
    {view==='report'&&<section className="panel" aria-label="Relatório financeiro" aria-busy={busy}>
    <h3>Resumo financeiro por período</h3>
    <p>Vendas registradas não significam dinheiro recebido. Os pagamentos da caderneta aparecem separadamente dos recebimentos do caixa. Os saldos de fiado mostram a situação atual dos pedidos criados no período selecionado.</p>
    <form onSubmit={load}>
      <label>Data inicial <input type="date" required value={start} max={end||undefined} onChange={event=>setStart(event.target.value)}/></label>
      <label>Data final <input type="date" required value={end} min={start||undefined} onChange={event=>setEnd(event.target.value)}/></label>
      <button disabled={busy}>{busy?'Gerando…':'Gerar relatório'}</button>
    </form>
    {error&&<p role="alert">{error}</p>}
    {report&&<>
      <div style={{overflowX:'auto'}}>
        <table ref={table}>
          <thead><tr><th>Indicador</th><th>Canal</th><th>Registros</th><th>Valor</th></tr></thead>
          <tbody>{report.rows.map(row=><tr key={row.metric+'|'+(row.channel||'')}>
            <td>{labels[row.metric]}</td><td>{row.channel||'Todos'}</td><td>{row.entries}</td><td>{money.format(row.amount)}</td>
          </tr>)}</tbody>
        </table>
      </div>
      <div className="dispatch-actions">
        <button type="button" className="secondary" onClick={download}>Baixar planilha CSV</button>
        <button type="button" className="secondary" onClick={print}>Salvar como PDF</button>
      </div>
    </>}
  </section>}
  </>;
}
