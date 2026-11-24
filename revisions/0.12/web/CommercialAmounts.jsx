import React,{useEffect,useState} from 'react';
const money=v=>v==null?'Em revisão':(Number(v)/100).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
const day=v=>v?new Date(v).toLocaleString('pt-BR',{timeZone:'America/Sao_Paulo'}):'—';
export default function CommercialAmounts({client,storeId}){
 const [state,setState]=useState(null);
 useEffect(()=>{if(!storeId)return;let live=true,running=false;const abort=new AbortController();
 async function load(){if(!live||running)return;running=true;try{const {data,error}=await client.rpc('pitacco_commercial_amount_preview',{p_store:storeId}).abortSignal(abort.signal);if(error||!data)throw error||Error('Apuração indisponível');if(live)setState({storeId,data})}catch(e){if(live)setState({storeId,error:e.message||'Apuração indisponível'})}finally{running=false}}
 void load();const timer=setInterval(()=>{if(document.visibilityState==='visible')void load()},10000);
 return()=>{live=false;abort.abort();clearInterval(timer)}},[client,storeId]);
 const current=state?.storeId===storeId?state:null,r=current?.data;
 if(!storeId)return null;
 return <section className="panel" aria-label="Apuração comercial"><h3>Apuração automática do plano</h3><p>Prévia calculada pelo servidor. Não é uma fatura emitida nem uma confirmação de pagamento.</p>{!current&&<p role="status">Consultando apuração…</p>}{current?.error&&<p role="alert">{current.error}</p>}{r?.status==='unassigned'&&<p>{r.message}</p>}{r&&r.status!=='unassigned'&&<><div className="line"><b>Plano comercial</b><span>{r.plan_name}</span></div><div className="line"><b>Mensalidade do ciclo</b><span>{money(r.monthly_cents)}</span></div><div className="line"><b>Vencimento mensal</b><span>{day(r.monthly_due_at)}</span></div><div className="line"><b>Base elegível de comissão</b><span>{money(r.base_cents)}</span></div><div className="line"><b>Comissão apurada</b><span>{money(r.commission_cents)}</span></div><div className="line"><b>Vencimento da comissão</b><span>{day(r.due_at)}</span></div><div className="line"><b>Pedidos elegíveis</b><span>{r.eligible_orders}</span></div>{r.status==='trial'&&<p>Período de teste vigente.</p>}{r.unresolved_orders>0&&<p role="alert">{r.unresolved_orders} pedidos precisam de conciliação antes de fechar a comissão.</p>}</>}</section>
}
