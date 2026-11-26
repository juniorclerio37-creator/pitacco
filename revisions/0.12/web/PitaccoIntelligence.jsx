import React,{useEffect,useState} from 'react';
import IntelligenceRepairs from './IntelligenceRepairs.jsx';


const brl=new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'});
const weekdays=['','Segunda','Terça','Quarta','Quinta','Sexta','Sábado','Domingo'];
function BusinessInsights({client,storeId}){
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

export default function PitaccoIntelligence({client,stores=[]}){
 const [storeId,setStoreId]=useState('');
 const [question,setQuestion]=useState('');
 const [busy,setBusy]=useState(false);
 const [answer,setAnswer]=useState('');
 const [error,setError]=useState('');
 const [considered,setConsidered]=useState(null);
 const [signals,setSignals]=useState(null);
 const [signalsLoading,setSignalsLoading]=useState(false);
 const [signalsError,setSignalsError]=useState('');
 const [signalsRevision,refreshSignals]=useState(0);

 useEffect(()=>{
  let live=true;
  setSignals(null);
  setSignalsLoading(true);
  setSignalsError('');
  client.rpc('pitacco_owner_diagnostic_snapshot',{p_store:storeId||null})
   .then(({data,error})=>{
    if(!live)return;
    if(error||!data?.observed_at||!data?.printing||!data?.courier_notifications){
      setSignalsError('Sinais operacionais indisponíveis. Não é possível afirmar que todos os serviços estejam funcionando.');
      return;
    }
    setSignals(data);
   }).catch(()=>{
    if(live)setSignalsError('Não foi possível coletar os sinais operacionais.');
   }).finally(()=>{if(live)setSignalsLoading(false);});
  return()=>{live=false;};
 },[client,storeId,signalsRevision]);

 const count=value=>Number.isSafeInteger(value)&&value>=0?value:'—';
 const evidence=signals?[
  {name:'Impressão Windows',detail:'Últimas 24 horas',
   stats:`Erros: ${count(signals.printing?.error)} · Incertos: ${count(signals.printing?.uncertain)} · Aguardando há mais de 10 min: ${count(signals.printing?.waiting_over_10m)}`,
   note:`Enviados ao spooler: ${count(signals.printing?.submitted)}. Isso não comprova impressão física. Testes aguardando confirmação (7 dias): ${count(signals.printing_checks?.awaiting_confirmation)}.`,
   alert:(signals.printing?.error||0)>0||(signals.printing?.waiting_over_10m||0)>0,
   action:'Verificar fila local, vínculo do computador e status do spooler Windows antes de reimprimir.'},
  {name:'Avisos dos entregadores',detail:'Últimas 24 horas',
   stats:`Pendentes: ${count(signals.courier_notifications?.unsent_24h)} · Expirados sem envio: ${count(signals.courier_notifications?.expired_unsent_24h)} · Com tentativas: ${count(signals.courier_notifications?.retrying_unsent_24h)}`,
   note:`Serviço de push: ${signals.courier_notifications?.server_enabled===true?'habilitado':signals.courier_notifications?.server_enabled===false?'desabilitado':'não verificado'}. Sessões registradas: ${count(signals.courier_devices?.registered_active_sessions)}. Enviado não significa ouvido no Android.`,
   alert:signals.courier_notifications?.server_enabled===false||(signals.courier_notifications?.expired_unsent_24h||0)>0,
   action:'Conferir Firebase, permissões, canal de notificação Android e teste com app minimizado.'},
  {name:'Eventos iFood',detail:'Últimas 24 horas',
   stats:`Eventos: ${count(signals.ifood?.events_24h)} · Não processados: ${count(signals.ifood?.unprocessed_24h)} · Atrasados acima de 10 min: ${count(signals.ifood?.late_over_10m)}`,
   note:`Com tentativas: ${count(signals.ifood?.retrying_unprocessed_24h)}. Evento processado não comprova aceite confirmado pelo iFood.`,
   alert:(signals.ifood?.late_over_10m||0)>0,
   action:'Verificar o processamento de eventos e a confirmação retornada pelo marketplace; não reenviar ações sem idempotência.'},
  {name:'Aceite 99Food e Keeta',detail:'Últimas 24 horas',
   stats:`99Food recusados: ${count(signals.marketplace_acceptance?.['99food_rejected_24h'])} · Keeta recusados: ${count(signals.marketplace_acceptance?.keeta_rejected_24h)}`,
   note:'Estes números cobrem somente solicitações de aceite registradas no Pitacco. Não monitoram toda a disponibilidade das APIs.',
   alert:(signals.marketplace_acceptance?.['99food_rejected_24h']||0)>0||(signals.marketplace_acceptance?.keeta_rejected_24h||0)>0,
   action:'Conferir estado das solicitações na integração e homologação da resposta do parceiro.'}
 ]:[];


 async function analyze(event){
  event.preventDefault();
  if(busy)return;
  setBusy(true);setAnswer('');setError('');setConsidered(null);
  try{
   const {data,error:sessionError}=await client.auth.getSession();
   if(sessionError||!data?.session?.access_token)throw Error('Entre novamente no Super Admin para utilizar a IA.');
   const result=await fetch('/api/intelligence/analyze',{
    method:'POST',
    headers:{
     'content-type':'application/json',
     authorization:'Bearer '+data.session.access_token
    },
    body:JSON.stringify({question:question.trim(),storeId:storeId||null}),
    cache:'no-store'
   });
   const payload=await result.json().catch(()=>({}));
   if(!result.ok)throw Error(payload.error||'Não foi possível consultar a IA.');
   setAnswer(typeof payload.answer==='string'?payload.answer:'Resposta indisponível.');
   setConsidered(Number.isFinite(payload.incidentsConsidered)?payload.incidentsConsidered:null);
  }catch(failure){setError(failure.message||'Não foi possível consultar a IA.');}
  finally{setBusy(false);}
 }
 return <section className="panel" aria-label="Pitacco Intelligence — diagnóstico assistido">
  <h3>Pitacco Intelligence</h3>
  <p>Assistente técnico exclusivo do Super Admin. Analisa sua pergunta com uma amostra dos incidentes
   em aberto já detectados pelo Pitacco. Nesta primeira versão, <strong>não altera pedidos, pagamentos,
   aplicativos, integrações ou código</strong>.</p>
  <form onSubmit={analyze}>
   <label>Estabelecimento
    <select value={storeId} disabled={busy} onChange={event=>setStoreId(event.target.value)}>
     <option value="">Todas as lojas</option>
     {stores.map(store=><option key={store.id} value={store.id}>{store.name}</option>)}
    </select>
   </label>
   <label>O que você quer investigar?
    <textarea required minLength={5} maxLength={1500} rows={4}
     placeholder="Ex.: Por que alguns pedidos entram na fila mas não são impressos no Windows?"
     value={question} disabled={busy} onChange={event=>setQuestion(event.target.value)}/>
   </label>
   <p className="hint">Não inclua senhas, tokens, endereços ou dados pessoais. A pergunta e os tipos
    resumidos dos incidentes serão processados pelo modelo Workers AI da Cloudflare.</p>
   <button type="submit" disabled={busy||question.trim().length<5}>
    {busy?'Analisando…':'Analisar com IA'}
   </button>
  </form>
  {error&&<p role="alert">{error}</p>}
  {answer&&<article className="panel" style={{marginTop:16}} aria-live="polite">
   <h4>Orientação da Pitacco Intelligence</h4>
   <p style={{whiteSpace:'pre-wrap',overflowWrap:'anywhere'}}>{answer}</p>
   <small>{considered===null?'':'Incidentes resumidos considerados: '+considered+'. '}
    A orientação não significa que uma correção foi executada.</small>
  </article>}
  <section aria-label="Evidências operacionais da plataforma" style={{marginTop:20}}>
   <div className="dispatch-actions" style={{alignItems:'center',justifyContent:'space-between',gap:12}}>
    <h4 style={{margin:0}}>Sinais reais da operação</h4>
    <button type="button" className="secondary" disabled={signalsLoading}
     onClick={()=>refreshSignals(i=>i+1)}>{signalsLoading?'Atualizando…':'Atualizar sinais'}</button>
   </div>
   <p className="hint">Contagens agregadas do servidor; a ausência de registros não significa que Windows, Firebase ou marketplaces foram testados. Nenhuma ação corretiva será executada automaticamente.</p>
   {signalsError&&<p role="alert">{signalsError}</p>}
   {signalsLoading&&!signals&&<p role="status">Consultando evidências disponíveis…</p>}
   {signals&&<p className="hint">Última consulta: {new Intl.DateTimeFormat('pt-BR',{timeZone:'America/Sao_Paulo',dateStyle:'short',timeStyle:'short'}).format(new Date(signals.observed_at))} · {signals.scope==='selected_store'?'Loja selecionada':'Todas as lojas'}</p>}
   {signals&&<div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(min(100%,15rem),1fr))',gap:12}}>
    {evidence.map(item=><article key={item.name} className="panel" style={{padding:14,minWidth:0}}>
     <h4 style={{margin:'0 0 6px'}}>{item.name}</h4>
     <small>{item.detail}</small>
     <p style={{margin:'10px 0',fontWeight:600}}>{item.stats}</p>
     <p className="hint">{item.note}</p>
     {item.alert&&<p style={{fontWeight:650}}>Sinal de atenção detectado</p>}
     <p><strong>Verificação sugerida:</strong> {item.action}</p>
    </article>)}
   </div>}
  </section>
  <BusinessInsights key={storeId} client={client} storeId={storeId}/>
  <IntelligenceRepairs client={client} storeId={storeId} stores={stores}/>
 </section>;
}
