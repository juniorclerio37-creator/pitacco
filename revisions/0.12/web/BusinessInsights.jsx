import React,{useEffect,useState} from 'react';

const brl=new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'});
const weekdays=['','Segunda','Terça','Quarta','Quinta','Sexta','Sábado','Domingo'];

function ExpertChat({client,storeId}){
 const [question,setQuestion]=useState(''),[answer,setAnswer]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const examples=['Como aumento meu ticket médio?','Quais combos devo testar esta semana?','Como atrair mais pedidos nos dias fracos?','Como melhorar a apresentação do meu cardápio?'];
 async function consult(e){
  e.preventDefault();if(busy||question.trim().length<5)return;setBusy(true);setAnswer('');setError('');
  try{const {data,error}=await client.auth.getSession();if(error||!data?.session?.access_token)throw Error('Entre novamente para consultar o especialista.');
   const r=await fetch('/api/intelligence/sales',{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer '+data.session.access_token},body:JSON.stringify({storeId,question:question.trim()}),cache:'no-store'});
   const p=await r.json().catch(()=>({}));if(!r.ok||typeof p.answer!=='string')throw Error(p.error||'Consultor indisponível.');
   setAnswer(p.answer);
  }catch(e){setError(e.message||'Não foi possível consultar.');}finally{setBusy(false);}
 }
 return <section className="panel" aria-label="Especialista em vendas de delivery" style={{marginTop:16}}><h3>Converse com seu especialista em delivery</h3><p>Peça um plano de vendas, sugestões de combos, estratégias de fidelização ou ideias de promoção.</p><div className="dispatch-actions" style={{flexWrap:'wrap',gap:8}}>{examples.map(q=><button key={q} type="button" className="secondary" disabled={busy} onClick={()=>setQuestion(q)}>{q}</button>)}</div><form onSubmit={consult}><label>Sua pergunta<textarea value={question} onChange={e=>setQuestion(e.target.value)} minLength={5} maxLength={1000} required disabled={busy} rows={3}/></label><p className="hint">A pergunta e indicadores comerciais resumidos são processados pelo Workers AI. Não inclua dados pessoais nem credenciais. As respostas são consultivas e não publicam alterações.</p><button disabled={busy||question.trim().length<5}>{busy?'Analisando…':'Consultar especialista'}</button></form>{error&&<p role="alert">{error}</p>}{answer&&<article className="panel" aria-live="polite"><h4>Plano recomendado</h4><p style={{whiteSpace:'pre-wrap',overflowWrap:'anywhere'}}>{answer}</p><p className="hint">Valide preços e descontos no simulador antes de publicar.</p></article>}</section>;
}
function DeliverySalesCoach({data}){
 const products=data.catalog||[],pairs=data.combo_candidates||[];
 const [first,setFirst]=useState(''),[second,setSecond]=useState(''),[cost,setCost]=useState(''),[fee,setFee]=useState(''),[fixed,setFixed]=useState(''),[margin,setMargin]=useState('20'),[discount,setDiscount]=useState('10');
 const a=products.find(p=>p.id===first),b=products.find(p=>p.id===second);
 const base=a?Number(a.price)+(b?Number(b.price):0):0;
 const numbers=[cost,fee,fixed,margin,discount].map(Number);
 const [c,f,x,m,d]=numbers;
 const ready=!!a&&[cost,fee,fixed,margin,discount].every(v=>v.trim()!=='')&&numbers.every(v=>Number.isFinite(v)&&v>=0)&&f+m<100&&d<100&&c>0;
 const minimum=ready?Math.ceil((c+x)/(1-(f+m)/100)*100)/100:null;
 const proposed=ready?Math.floor(base*(1-d/100)*100+1e-7)/100:null;
 const contribution=ready?proposed*(1-f/100)-c-x:null;
 const safe=ready&&proposed>=minimum;
 function choose(p,q){setFirst(p?.id||'');setSecond(q?.id||'');setCost('');}
 const validPairs=pairs.filter(p=>products.some(x=>x.id===p.first.id)&&products.some(x=>x.id===p.second.id));
 return <section className="panel" aria-label="Consultor de vendas delivery" style={{margin:'16px 0'}}>
  <h3>Seu consultor de vendas de delivery</h3>
  <p>Escolha oportunidades baseadas no cardápio e teste ofertas antes de publicar. Não prometemos aumento de vendas; compare os resultados da campanha.</p>
  <h4>Combos com evidência de compra conjunta</h4>
  <p className="hint">{data.identified_orders||0} pedidos com pelo menos um item elegível identificado nos últimos 28 dias. Pedidos importados sem identificação de produto não entram nesta análise.</p>
  {validPairs.length?validPairs.map(p=><article className="panel" key={p.first.id+'-'+p.second.id} style={{margin:'8px 0'}}><strong>{p.first.name} + {p.second.name}</strong><p>Comprados juntos em {p.together_orders} pedidos · separados: {brl.format(Number(p.first.price)+Number(p.second.price))}</p><button type="button" onClick={()=>choose(p.first,p.second)}>Simular combo</button></article>):<p>Ainda não há pares com três compras conjuntas. Teste combinações do cardápio manualmente; elas serão hipóteses, não recomendações comprovadas.</p>}
  <h4>Produtos para destacar e vender adicionais</h4>
  {products.filter(p=>p.orders>0).slice(0,5).map(p=><article key={p.id} className="panel" style={{margin:'8px 0'}}><strong>{p.name}</strong> · {p.orders} pedidos identificados · {brl.format(p.price)} <button type="button" className="secondary" onClick={()=>choose(p,null)}>Simular promoção</button></article>)}
  {!products.some(p=>p.orders>0)&&<p>Sem histórico identificado suficiente para ranquear produtos.</p>}
  <h4>Simulador de preços, combos e promoções</h4>
  <label>Produto principal<select value={first} onChange={e=>{setFirst(e.target.value);if(e.target.value===second)setSecond('');setCost('');}}><option value="">Selecione</option>{products.map(p=><option key={p.id} value={p.id}>{p.name} · {brl.format(p.price)}</option>)}</select></label>
  <label>Segundo produto (opcional)<select value={second} onChange={e=>{setSecond(e.target.value);setCost('');}}><option value="">Sem segundo produto</option>{products.filter(p=>p.id!==first).map(p=><option key={p.id} value={p.id}>{p.name} · {brl.format(p.price)}</option>)}</select></label>
  {a&&<p>Preço de referência: <strong>{brl.format(base)}</strong> · {a.recorded_cost!==null&&(!b||b.recorded_cost!==null)?'Custo cadastrado dos produtos: '+brl.format(Number(a.recorded_cost)+(b?Number(b.recorded_cost):0))+' (confirme insumos e embalagem).':'Custo de produto incompleto no cadastro.'}</p>}
  <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(min(100%,12rem),1fr))',gap:10}}>
   <label>Custo total dos produtos e embalagem (R$)<input type="number" min="0.01" step="0.01" value={cost} onChange={e=>setCost(e.target.value)} placeholder="Confirme o custo"/></label>
   <label>Comissões e taxas sobre a venda (%)<input type="number" min="0" max="99" step="0.01" value={fee} onChange={e=>setFee(e.target.value)} placeholder="Informe 0 se não houver"/></label>
   <label>Frete subsidiado e outros custos por pedido (R$)<input type="number" min="0" step="0.01" value={fixed} onChange={e=>setFixed(e.target.value)} placeholder="Informe 0 se não houver"/></label>
   <label>Margem de contribuição desejada (%)<input type="number" min="0" max="99" step="0.01" value={margin} onChange={e=>setMargin(e.target.value)}/></label>
   <label>Desconto pago pela loja (%)<input type="number" min="0" max="99" step="0.01" value={discount} onChange={e=>setDiscount(e.target.value)}/></label>
  </div>
  {ready?<article className="panel" aria-live="polite"><h4>{safe?'Oferta compatível com a margem informada':'Reveja a oferta: margem abaixo da meta'}</h4><p>Preço sugerido pelo desconto: <strong>{brl.format(proposed)}</strong> · preço mínimo para a meta: <strong>{brl.format(minimum)}</strong></p><p>Contribuição estimada por pedido: {brl.format(contribution)} {proposed>0?'('+((contribution/proposed)*100).toFixed(1)+'%)':''}</p><p>{minimum<=base?'Desconto máximo aproximado: '+(Math.floor((1-minimum/base)*10000)/100).toFixed(2)+'%.':'O preço atual não cobre a meta; revise preço, custos ou margem.'}</p><p>Teste por sete dias, compare pedidos, ticket médio e contribuição com dias equivalentes. Não publique ofertas com estoque ou margem insuficientes.</p></article>:<p className="hint">Selecione um produto e informe todos os custos e taxas para receber um preço. A soma da taxa e margem deve ser menor que 100%.</p>}
  <p className="hint">Simulação para uma unidade de cada item, sem adicionais. Taxas percentuais incidem sobre o preço final; ajuste custos fixos conforme o canal. Não inclui despesas fixas, impostos não informados nem subsídios externos. Até 30 produtos simples elegíveis; pizzas e combos existentes exigem cálculo específico.</p>
 </section>;
}

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
   <ExpertChat key={'expert-'+storeId} client={client} storeId={storeId}/>
   <DeliverySalesCoach key={storeId} data={data}/>
   <h4>Alertas de reposição</h4>
   {data.stock_alerts.length===0?<p>Nenhum insumo cadastrado atingiu os critérios de alerta; confirme se o estoque está atualizado.</p>:data.stock_alerts.map((item,i)=><article key={i} className="panel" style={{margin:'8px 0'}}><strong>{item.name}</strong><p>Saldo: {item.balance} {item.unit} · mínimo: {item.minimum} {item.unit}</p><p>{Number(item.balance)<=Number(item.minimum)?'Estoque no mínimo ou abaixo. ':''}{item.days_left!==null?'Cobertura estimada: '+item.days_left+' dias.':'Histórico de consumo insuficiente para estimar cobertura.'}</p></article>)}
   <p className="hint">Até 20 alertas. A previsão utiliza consumo registrado de pedidos em pelo menos sete dias distintos; não inclui consumo não registrado.</p>
   <h4>Pedidos por dia da semana</h4><div style={{display:'grid',gap:8}}>{days.map(day=><div key={day.weekday}><span>{weekdays[day.weekday]} · {day.average_orders} pedidos/dia</span><progress style={{width:'100%'}} max={Math.max(1,...days.map(d=>Number(d.average_orders)))} value={Number(day.average_orders)}/></div>)}</div>
  </>}
 </section>;
}

