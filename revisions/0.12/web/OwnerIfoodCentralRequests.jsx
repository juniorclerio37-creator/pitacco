import React,{useEffect,useRef,useState} from 'react';
const labels={pending:'Pendente',awaiting:'Aguardando autorização iFood',active:'Ativa',rejected:'Recusada'};
export default function OwnerIfoodCentralRequests({client}){
 const [rows,setRows]=useState(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
 const running=useRef(false);
 async function load(){const r=await client.rpc('pitacco_owner_ifood_central_requests');if(r.error)throw r.error;setRows(r.data||[])}
 useEffect(()=>{load().catch(e=>setError(e.message))},[client]);
 async function run(fn){if(running.current)return;running.current=true;setBusy(true);setError('');setNotice('');try{await fn();await load()}catch(e){setError(e.message||'Não foi possível concluir a ação.')}finally{running.current=false;setBusy(false)}}
 function review(r,action){if(action==='awaiting'&&!window.confirm('Confira o Merchant ID e a titularidade. Você já solicitou a permissão no Portal do Desenvolvedor iFood?'))return;if(action==='rejected'&&!window.confirm('Recusar esta solicitação?'))return;run(async()=>{const v=await client.rpc('pitacco_owner_ifood_central_review',{p_request:r.id,p_action:action});if(v.error)throw v.error})}
 function approve(r){if(!window.confirm('Você conferiu a titularidade deste estabelecimento e a aprovação no Portal do Parceiro? A ativação ainda depende da resposta da API iFood.'))return;run(async()=>{const v=await client.functions.invoke('ifood-central-link',{body:{request_id:r.id}});if(v.error){const d=await v.error.context?.clone?.().json().catch(()=>null);throw Error(d?.error||'Falha na verificação da autorização iFood.')}if(v.data?.linked!==true)throw Error(v.data?.error||'Autorização não confirmada.');setNotice('Vínculo centralizado habilitado: '+(v.data.provider_name||r.store_name))})}
 return <section className="panel" aria-label="Solicitações de integração iFood">
  <h4>Solicitações de vinculação centralizada</h4>
  <p>Confira a titularidade e solicite acesso para cada Merchant ID no <a href="https://developer.ifood.com.br/pt-BR/" target="_blank" rel="noopener noreferrer">Portal do Desenvolvedor iFood</a>. Marque como solicitado e aguarde a aprovação do lojista. A ativação verifica a autorização na API antes de habilitar o recebimento.</p>
  <button type="button" className="secondary" disabled={busy} onClick={()=>run(async()=>{})}>Atualizar solicitações</button>
  {rows===null&&!error&&<p>Consultando…</p>}{rows?.length===0&&<p>Nenhuma solicitação registrada.</p>}
  {rows?.map(r=><article key={r.id} className="panel"><strong>{r.store_name}</strong><p>Merchant ID: <code>{r.merchant_id}</code></p><p>{labels[r.state]||r.state}{r.provider_name?' · '+r.provider_name:''}</p>
   {r.state==='pending'&&<button type="button" disabled={busy} onClick={()=>review(r,'awaiting')}>Marcar permissão solicitada</button>}
   {r.state==='awaiting'&&<button type="button" disabled={busy} onClick={()=>approve(r)}>Verificar autorização e ativar</button>}
   {['pending','awaiting'].includes(r.state)&&<button type="button" className="secondary" disabled={busy} onClick={()=>review(r,'rejected')}>Recusar</button>}
  </article>)}
  {error&&<p role="alert">{error}</p>}{notice&&<p role="status">{notice}</p>}
 </section>
}
