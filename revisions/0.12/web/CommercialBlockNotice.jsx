import React,{useEffect,useState} from 'react';
const formatDate=value=>value?new Intl.DateTimeFormat('pt-BR',{timeZone:'America/Sao_Paulo',dateStyle:'short',timeStyle:'short'}).format(new Date(value)):'';
const notices={
 due_today:{title:'Sua cobrança vence hoje',body:'Efetue o pagamento até o horário do vencimento para manter a assinatura regularizada.',color:'#92400e',border:'#eab308',background:'#fffbeb'},
 grace:{title:'Pagamento pendente — prazo de tolerância',body:'O vencimento já passou. Efetue o pagamento dentro do prazo de tolerância para evitar o bloqueio de novos pedidos em todos os canais.',color:'#9a3412',border:'#ea580c',background:'#fff7ed'},
 overdue:{title:'Cobrança vencida — regularização necessária',body:'O prazo de tolerância terminou. Regularize as cobranças pendentes.',color:'#881337',border:'#b91c1c',background:'#fff1f2'},
 blocked:{title:'Estabelecimento bloqueado por inadimplência',body:'O recebimento de novos pedidos está suspenso em todos os canais. Regularize as cobranças vencidas para voltar a operar. Pedidos em andamento continuam disponíveis.',color:'#881337',border:'#b91c1c',background:'#fff1f2'}
};
export default function CommercialBlockNotice({client,storeId,manager,onRegularize}){
 const [state,setState]=useState(null);
 useEffect(()=>{if(!client||!storeId)return;let live=true,running=false;const abort=new AbortController();
 async function load(){if(!live||running)return;running=true;try{const {data,error}=await client.rpc('pitacco_store_commercial_block_status',{p_store:storeId}).abortSignal(abort.signal);if(!error&&live&&typeof data?.orders_blocked==='boolean')setState({storeId,data})}catch{}finally{running=false}}
 void load();const visible=()=>{if(document.visibilityState==='visible')void load()};const timer=setInterval(visible,10000);window.addEventListener('focus',visible);document.addEventListener('visibilitychange',visible);return()=>{live=false;abort.abort();clearInterval(timer);window.removeEventListener('focus',visible);document.removeEventListener('visibilitychange',visible)}},[client,storeId]);
 const data=state?.storeId===storeId?state.data:null;
 const stage=data?.orders_blocked?'blocked':data?.notice_stage;
 const notice=notices[stage];
 if(!notice)return null;
 const allInReview=data.awaiting_review>0&&data.payment_required===0;
 const body=allInReview?'Seu comprovante está em análise. Acompanhe a confirmação do recebimento na área de assinaturas; não efetue um novo pagamento da mesma cobrança.':notice.body;
 return <section role="alert" aria-label={notice.title} className="panel" style={{border:'1px solid '+notice.border,background:notice.background,color:notice.color,margin:'12px 0',padding:16}}>
 <strong>{notice.title}</strong><p>{body}</p>
 {stage==='due_today'&&data.due_at&&<p>Vencimento: {formatDate(data.due_at)} (horário de Brasília).</p>}
 {stage==='grace'&&data.grace_until&&<p>Prazo final: {formatDate(data.grace_until)} (horário de Brasília). {data.orders_blocked?'':'Novos pedidos permanecem disponíveis até o fim da tolerância, se não houver outro bloqueio.'}</p>}
 {allInReview&&stage==='blocked'&&<p>O recebimento de novos pedidos continua suspenso até a confirmação e regularização das pendências.</p>}
 {!allInReview&&data.awaiting_review>0&&<p>Há também comprovantes aguardando análise. Confira cada cobrança antes de pagar.</p>}
 {manager?<button type="button" onClick={onRegularize}>{allInReview?'Acompanhar pagamento':stage==='blocked'||stage==='overdue'?'Regularizar agora':'Pagar agora'}</button>:<p>Solicite a regularização ao gestor da loja.</p>}
 </section>
}
