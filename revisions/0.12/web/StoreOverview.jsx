import React, {useState} from 'react';
import {ArrowRight, Bell, Bike, CalendarDays, ChartNoAxesCombined, CheckCircle2, Clock3, Coins, CreditCard, Package, Percent, RefreshCw, ShoppingBag, Tag} from 'lucide-react';
import {orderStage} from './orderBoard.mjs';

const date = new Intl.DateTimeFormat('sv-SE', {timeZone:'America/Sao_Paulo'});
const day = new Intl.DateTimeFormat('pt-BR', {timeZone:'America/Sao_Paulo',weekday:'short'});
const hour = new Intl.DateTimeFormat('en-GB', {timeZone:'America/Sao_Paulo',hour:'2-digit',hourCycle:'h23'});
const currency = new Intl.NumberFormat('pt-BR', {style:'currency',currency:'BRL'});
const count = new Intl.NumberFormat('pt-BR');
const percent = new Intl.NumberFormat('pt-BR', {style:'percent',maximumFractionDigits:1});
const colors = ['#e8582e','#f5a329','#2585ee','#8255d7','#1f9d7a','#69778a'];
const stages = {scheduled:'Agendado',analysis:'Pendente',preparing:'Em preparo',ready:'Pronto',delivery:'Em entrega',completed:'Concluído',cancelled:'Cancelado',rejected:'Recusado',historical:'Histórico'};
const sum = (rows, field) => rows.reduce((total,row)=>total+Number(row[field]||0),0);
const sale = order => ['accepted','historical'].includes(order.status);
const daysBefore = (now,offset) => new Date(now.getTime()-offset*86400000);

export default function StoreOverview({store,orders,deliveries,expenses,navigate,refresh,allowed}) {
  const [period,setPeriod] = useState(1);
  const [mode,setMode] = useState('sales');
  const [busy,setBusy] = useState(false);
  const now = new Date();
  const today = date.format(now);
  const first = date.format(daysBefore(now,period-1));
  const inPeriod = value => Boolean(value) && date.format(new Date(value))>=first && date.format(new Date(value))<=today;
  const recent = orders.filter(order=>order.store_id===store.id);
  const rows = recent.filter(order=>inPeriod(order.created_at));
  const sales = rows.filter(sale);
  const storeDeliveries = deliveries.filter(delivery=>delivery.store_id===store.id);
  const completed = storeDeliveries.filter(delivery=>delivery.status==='entregue'&&inPeriod(delivery.updated_at));
  const gross = sum(sales,'gross');
  const fees = sum(sales,'fees');
  const spend = sum(expenses.filter(expense=>expense.store_id===store.id&&inPeriod(expense.created_at)),'amount');
  const kpis = [
    [Coins,'Faturamento',currency.format(gross),'Vendas registradas','green'],
    [ShoppingBag,'Pedidos',count.format(rows.length),'No período selecionado','blue'],
    [CreditCard,'Saldo estimado',currency.format(gross-fees-spend),'Após taxas e despesas lançadas','purple'],
    [Tag,'Ticket médio',sales.length?currency.format(gross/sales.length):'—','Por venda registrada','orange'],
    [Percent,'Taxas e comissões',currency.format(fees),gross?percent.format(fees/gross)+' do faturamento':'No período selecionado','red'],
    [Bike,'Entregas concluídas',count.format(completed.length),'No período selecionado','blue']
  ];
  const channelSales = new Map();
  sales.forEach(order=>{
    const channel = order.channel||'Loja';
    channelSales.set(channel,(channelSales.get(channel)||0)+Number(order.gross||0));
  });
  const platforms = [...channelSales].filter(([,value])=>value>0).sort((a,b)=>b[1]-a[1]);
  const comparisonStart=date.format(daysBefore(now,period+6));
  const previousSales=new Map();
  recent.filter(order=>sale(order)&&order.created_at).forEach(order=>{
    const when=date.format(new Date(order.created_at));
    if(when<comparisonStart||when>=first)return;
    const channel=order.channel||'Loja';
    previousSales.set(channel,(previousSales.get(channel)||0)+Number(order.gross||0));
  });
  let segment = 0;
  const gradient = platforms.map(([,value],index)=>{
    const from=segment;segment+=value/gross*100;
    return `${colors[index%colors.length]} ${from}% ${segment}%`;
  }).join(',');
  const buckets = Array.from({length:period===1?24:period},(_,i)=>{
    const dayAt=daysBefore(now,period-1-i);
    return {key:period===1?String(i).padStart(2,'0'):date.format(dayAt),
      label:period===1?i+'h':period===7?day.format(dayAt).replace('.',''):String(Number(date.format(dayAt).slice(-2))), value:0};
  });
  const bucketIndex = new Map(buckets.map(point=>[point.key,point]));
  (mode==='sales'?sales:rows).forEach(order=>{
    const at=new Date(order.created_at);
    const point=bucketIndex.get(period===1?hour.format(at):date.format(at));
    if(point)point.value+=mode==='sales'?Number(order.gross||0):1;
  });
  const week = Array.from({length:7},(_,i)=>{
    const at=daysBefore(now,6-i);
    return {label:day.format(at).replace('.',''),value:sum(recent.filter(order=>sale(order)&&order.created_at&&date.format(new Date(order.created_at))===date.format(at)),'gross')};
  });
  const ceiling = Math.max(1,...buckets.map(point=>point.value));
  const xy = buckets.map((point,i)=>[12+i*596/(buckets.length-1),126-point.value/ceiling*112]);
  const line=xy.map(point=>point.join(',')).join(' ');
  const active=rows.filter(order=>order.status==='accepted').length;
  const rejected=rows.filter(order=>['cancelled','rejected'].includes(order.status)).length;
  const delayed=recent.filter(order=>orderStage(order)==='analysis'&&now-new Date(order.scheduled_release_at||order.created_at)>600000).length;
  const waiting=storeDeliveries.filter(delivery=>delivery.status==='pendente'&&!delivery.courier_id).length;
  const trend = Math.max(1,...week.map(point=>point.value));

  return <div className="store-overview">
    <div className="store-overview-tools">
      <label><CalendarDays size={16}/> <select aria-label="Período da visão geral" value={period} onChange={event=>setPeriod(Number(event.target.value))}>
        <option value={1}>Hoje</option><option value={7}>Últimos 7 dias</option><option value={30}>Últimos 30 dias</option>
      </select></label>
      <button type="button" className="secondary" disabled={busy} onClick={async()=>{
        setBusy(true);
        try{await refresh();}finally{setBusy(false);}
      }}><RefreshCw size={15}/>{busy?'Atualizando…':'Atualizar'}</button>
    </div>
    <section className="store-summary-cards" aria-label="Indicadores da loja">
      {kpis.map(([Icon,label,value,detail,tone])=><article key={label} data-tone={tone}>
        <span className="store-stat-icon"><Icon size={21}/></span><div><span>{label}</span><strong>{value}</strong><small>{detail}</small></div>
      </article>)}
    </section>
    <div className="store-overview-grid store-overview-charts">
      <section className="panel"><div className="store-panel-title"><h3><ChartNoAxesCombined/> {period===1?'Movimento por hora':'Movimento por dia'}</h3>
        <div className="store-chart-switch" role="group" aria-label="Indicador do gráfico">
          <button type="button" aria-pressed={mode==='sales'} onClick={()=>setMode('sales')}>Vendas</button>
          <button type="button" aria-pressed={mode==='orders'} onClick={()=>setMode('orders')}>Pedidos</button>
        </div></div>
        <div className="store-line-chart">
          <div className="store-chart-scale">{[ceiling,ceiling/2,0].map((value,i)=><span key={i}>{mode==='sales'?currency.format(value):count.format(Math.round(value))}</span>)}</div>
          <div className="store-chart-plot">
            <svg viewBox="0 0 620 132" preserveAspectRatio="none" role="img" aria-label={mode==='sales'?'Gráfico de vendas registradas':'Gráfico de pedidos registrados'}>
              <defs><linearGradient id="store-sales-fill" x2="0" y2="1"><stop stopColor="#f87a50" stopOpacity=".34"/><stop offset="100%" stopColor="#f87a50" stopOpacity=".04"/></linearGradient></defs>
              {[14,70,126].map(y=><line key={y} x1="12" x2="608" y1={y} y2={y} stroke="var(--line,#e4e7ee)" vectorEffect="non-scaling-stroke"/>)}
              <polygon points={`12,126 ${line} 608,126`} fill="url(#store-sales-fill)"/>
              <polyline points={line} fill="none" stroke="#e9552d" strokeWidth="2.5" vectorEffect="non-scaling-stroke" strokeLinejoin="round"/>
              {xy.map(([x,y],i)=>buckets[i].value>0&&<circle key={i} cx={x} cy={y} r="3.5" fill="#fff" stroke="#e9552d"><title>{buckets[i].label}: {mode==='sales'?currency.format(buckets[i].value):count.format(buckets[i].value)}</title></circle>)}
            </svg>
            <div className="store-chart-labels">{buckets.filter((_,i)=>i===0||i===buckets.length-1||i%(period===7?1:period===30?5:4)===0).map(point=><span key={point.key}>{point.label}</span>)}</div>
          </div>
        </div>
      </section>
      <section className="panel"><div className="store-panel-title"><h3><Package/> Vendas por plataforma</h3></div>
        <div className="store-platforms">
          <div className="store-donut" style={gradient?{background:`conic-gradient(${gradient})`}:undefined}>
            <div><strong>{currency.format(gross)}</strong><small>Total</small></div>
          </div>
          {platforms.length?<ul>{platforms.map(([name,amount],index)=><li key={name}>
            <span><i style={{background:colors[index%colors.length]}}/>{name}</span><small>{percent.format(amount/gross)}</small><strong>{currency.format(amount)}</strong>
          </li>)}</ul>:<p>Nenhuma venda por plataforma no período.</p>}
        </div>
      </section>
    </div>
    <div className="store-overview-grid store-overview-status">
      <section className="panel"><div className="store-panel-title"><h3><CheckCircle2/> Desempenho do período</h3></div>
        <div className="store-performance"><div><strong>{active}</strong><small>Pedidos aceitos</small></div><div><strong>{completed.length}</strong><small>Entregas concluídas</small></div><div><strong>{rejected}</strong><small>Cancelados ou recusados</small></div></div>
      </section>
      <section className="panel"><div className="store-panel-title"><h3><ChartNoAxesCombined/> Comparativo de plataformas</h3></div>
        {platforms.length?<ul className="store-comparison" aria-label="Média diária comparada aos sete dias anteriores">
          {platforms.slice(0,4).map(([name,value],index)=>{
            const baseline=(previousSales.get(name)||0)/7;
            const change=baseline?(value/period-baseline)/baseline:null;
            return <li key={name}><span>{name}</span><i><b style={{width:value/platforms[0][1]*100+'%',background:colors[index]}}/></i>
              <strong data-change={change===null?'':change>=0?'up':'down'}>{change===null?'Sem base':(change>0?'+':'')+percent.format(change)}</strong>
            </li>;
          })}
        </ul>:<p>Nenhuma venda para comparar.</p>}
      </section>
      <section className="panel"><div className="store-panel-title"><h3><Bell/> Alertas e ocorrências</h3></div>
        <div className="store-overview-alerts">
          <button type="button" onClick={()=>navigate('Pedidos')}><Clock3 size={17}/>{delayed} pedido(s) aguardando aceite há mais de 10 min<ArrowRight size={15}/></button>
          {allowed('Entregadores')&&<button type="button" onClick={()=>navigate('Entregadores')}><Bike size={17}/>{waiting} entrega(s) sem entregador<ArrowRight size={15}/></button>}
          {allowed('Alertas')&&<button type="button" onClick={()=>navigate('Alertas')}><Bell size={17}/> Central de alertas<ArrowRight size={15}/></button>}
        </div>
      </section>
    </div>
    <div className="store-overview-grid store-overview-bottom">
      <section className="panel"><div className="store-panel-title"><h3><ShoppingBag/> Últimos pedidos</h3><button type="button" className="store-text-button" onClick={()=>navigate('Pedidos')}>Ver todos <ArrowRight size={15}/></button></div>
        {rows.length?<div className="approved-table-scroll"><table><thead><tr><th>Pedido</th><th>Cliente</th><th>Plataforma</th><th>Valor</th><th>Status</th></tr></thead>
          <tbody>{rows.slice(0,5).map(order=>{
            const stage=orderStage(order,storeDeliveries.find(delivery=>delivery.order_id===order.id));
            return <tr key={order.id}><td>#{order.receipt?.display_number||order.receipt?.external_order_number||order.id.slice(0,8)}</td><td>{order.receipt?.customer||'—'}</td><td>{order.channel||'Loja'}</td><td>{currency.format(order.gross)}</td><td><span className="store-stage" data-stage={stage}>{stages[stage]}</span></td></tr>;
          })}</tbody></table></div>:<p>Nenhum pedido no período.</p>}
      </section>
      <section className="panel"><div className="store-panel-title"><h3><CreditCard/> Faturamento (7 dias)</h3></div>
        <div className="store-week-chart" role="img" aria-label={week.map(point=>point.label+' '+currency.format(point.value)).join(', ')}>
          {week.map((point,i)=><div key={i}><span title={currency.format(point.value)} style={{height:point.value/trend*100+'%'}}/><small>{point.label}</small></div>)}
        </div>
      </section>
    </div>
  </div>;
}
