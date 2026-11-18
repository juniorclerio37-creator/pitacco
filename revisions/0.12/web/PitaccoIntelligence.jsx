import React,{useState} from 'react';

export default function PitaccoIntelligence({client,stores=[]}){
 const [storeId,setStoreId]=useState('');
 const [question,setQuestion]=useState('');
 const [busy,setBusy]=useState(false);
 const [answer,setAnswer]=useState('');
 const [error,setError]=useState('');
 const [considered,setConsidered]=useState(null);

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
 </section>;
