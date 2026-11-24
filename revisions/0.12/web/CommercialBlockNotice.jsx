import React,{useEffect,useState} from 'react';
export default function CommercialBlockNotice({client,storeId,manager,onRegularize}){
 const [state,setState]=useState(null);
 useEffect(()=>{if(!client||!storeId)return;let live=true,running=false;const abort=new AbortController();
 async function load(){if(!live||running)return;running=true;try{const {data,error}=await client.rpc('pitacco_store_commercial_block_status',{p_store:storeId}).abortSignal(abort.signal);if(!error&&live&&typeof data?.orders_blocked==='boolean')setState({storeId,blocked:data.orders_blocked})}catch{}finally{running=false}}
 void load();const visible=()=>{if(document.visibilityState==='visible')void load()};const timer=setInterval(visible,10000);window.addEventListener('focus',visible);document.addEventListener('visibilitychange',visible);return()=>{live=false;abort.abort();clearInterval(timer);window.removeEventListener('focus',visible);document.removeEventListener('visibilitychange',visible)}},[client,storeId]);
 if(state?.storeId!==storeId||!state.blocked)return null;
 return <section role="alert" aria-label="Estabelecimento bloqueado por inadimplência" className="panel" style={{border:'1px solid #b91c1c',background:'#fff1f2',color:'#881337',margin:'12px 0',padding:16}}><strong>Estabelecimento bloqueado por inadimplência</strong><p>O recebimento de novos pedidos está suspenso em todos os canais. Regularize as cobranças vencidas para voltar a operar. Pedidos em andamento continuam disponíveis.</p>{manager?<button type="button" onClick={onRegularize}>Regularizar agora</button>:<p>Solicite a regularização ao gestor da loja.</p>}</section>
}
