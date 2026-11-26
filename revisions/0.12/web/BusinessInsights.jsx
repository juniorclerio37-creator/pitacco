import React,{useEffect,useState} from 'react';

const brl=new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'});
const weekdays=['','Segunda','Terça','Quarta','Quinta','Sexta','Sábado','Domingo'];
export default function BusinessInsights({client,storeId}){
 const [data,setData]=useState(null),[error,setError]=useState(''),[loading,setLoading]=useState(false),[revision,refresh]=useState(0);
 useEffect(()=>{
  let live=true;setData(null);setError('');
  if(!storeId){setLoading(false);return;}
  setLoading(true);
  client.rpc('pitacco_business_insights',{p_store:storeId}).then(({data,error})=>{
   if(!live)return;if(error)throw error;if(!data?.sales||!Array.isArray(data.weekdays))throw Error('Dados comerciais indisponíveis');
   setData(data);
  }).catch(e=>{if(live)setError(e.message||'Não foi possível consultar os dados comerciais');}).finally(()=>{if(live)setLoading(false);});
  return()=>{live=false;};
 },[client,storeId,revision]);
 const s=data?.sales;
 const days=data?.weekdays||[];
 const weak=s?.orders>=28?days.reduce((a,b)=>Number(a.average_orders)<=Number(b.average_orders)?a:b,days[0]):null;
 const date=value=>String(value||'').split('-').reverse().join('/');
 return <section className="panel" aria-label="Inteligência comercial" style={{marginTop:16}}>
  <div className="dispatch-actions"><h4>Inteligência comercial · Estoque, vendas e rentabilidade</h4><button type="button" className="secondary" disabled={!storeId||loading} onClick={()=>refresh(x=>x+1)}>Atualizar análise</button></div>
  {!storeId&&<p>Selecione uma loja acima para analisar seus dados sem misturar estabelecimentos.</p>}
  {loading&&<p role="status">Analisando registros da loja…</p>}{error&&<p role="alert">{error}</p>}
  {s&&<>
   <p className="hint">Período: {date(data.period_start)} a {date(data.period_end)} · 28 dias completos. Recomendações calculadas a partir de registros reais; nenhuma alteração automática.</p>
   <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(min(100%,15rem),1fr))',gap:12}}>
    <article className="panel"><h4>Vendas registradas</h4><p><strong>{s.orders} pedidos · {brl.format(s.gross)}</strong></p><p className="hint">Pedidos aceitos e históricos; não representa saldo recebido.</p></article>
    <article className="panel"><h4>Rentabilidade</h4><p>Custos completos: {s.complete_costs} de {s.orders} pedidos.</p><p>{s.known_contribution===null?'Dados insuficientes para calcular a contribuição.':('Contribuição dos pedidos com custos completos: '+brl.format(s.known_contribution))}</p><p>{s.negative_orders} pedidos com contribuição negativa registrada.</p>{s.complete_costs<s.orders&&<p>Complete os custos faltantes antes de avaliar a margem geral.</p>}<p className="hint">Contribuição direta, não lucro líquido; despesas fixas não incluídas.</p></article>
    <article className="panel"><h4>Oportunidade comercial</h4>{weak?<><p>Menor média registrada: <strong>{weekdays[weak.weekday]}</strong> · {weak.average_orders} pedidos.</p><p>Confira os horários de funcionamento e considere testar uma oferta se a loja estiver aberta.</p></>:<p>Amostra insuficiente para recomendar um dia de promoção (mínimo de 28 pedidos).</p>}<p className="hint">Quatro ocorrências de cada dia; feriados e dias fechados podem influenciar.</p></article>
   </div>
   <h4>Alertas de reposição</h4>
   {data.stock_alerts.length===0?<p>Nenhum insumo cadastrado atingiu os critérios de alerta; confirme se o estoque está atualizado.</p>:data.stock_alerts.map((item,i)=><article key={i} className="panel" style={{margin:'8px 0'}}><strong>{item.name}</strong><p>Saldo: {item.balance} {item.unit} · mínimo: {item.minimum} {item.unit}</p><p>{Number(item.balance)<=Number(item.minimum)?'Estoque no mínimo ou abaixo. ':''}{item.days_left!==null?'Cobertura estimada: '+item.days_left+' dias.':'Histórico de consumo insuficiente para estimar cobertura.'}</p></article>)}
   <p className="hint">Até 20 alertas. A previsão utiliza consumo registrado de pedidos em pelo menos sete dias distintos; não inclui consumo não registrado.</p>
   <h4>Pedidos por dia da semana</h4><div style={{display:'grid',gap:8}}>{days.map(day=><div key={day.weekday}><span>{weekdays[day.weekday]} · {day.average_orders} pedidos/dia</span><progress style={{width:'100%'}} max={Math.max(1,...days.map(d=>Number(d.average_orders)))} value={Number(day.average_orders)}/></div>)}</div>
  </>}
 </section>;
}

