import React,{useEffect,useState} from 'react';

const categories={pedidos:'Pedidos',impressoes:'Impressão',entregas:'Entregas',financeiro:'Financeiro',integracoes:'Integrações',acesso:'Acesso',outros:'Outros'};
const statuses={open:'Aberto',in_progress:'Em atendimento',waiting_store:'Aguardando lojista',resolved:'Resolvido',closed:'Encerrado'};
const dt=new Intl.DateTimeFormat('pt-BR',{timeZone:'America/Sao_Paulo',dateStyle:'short',timeStyle:'short'});
const stamp=value=>value?dt.format(new Date(value)):'—';

export default function SupportCenter({client,storeId=null,stores=[],owner=false}){
 const [selectedStore,setSelectedStore]=useState(storeId||''),[status,setStatus]=useState('');
 const [page,setPage]=useState(0),[revision,refresh]=useState(0);
 const [records,setRecords]=useState(null),[details,setDetails]=useState(null);
 const [opened,setOpened]=useState(null),[busy,setBusy]=useState(false),[failure,setFailure]=useState(''),[notice,setNotice]=useState('');
 const [category,setCategory]=useState('pedidos'),[subject,setSubject]=useState(''),[description,setDescription]=useState('');
 const [reply,setReply]=useState(''),[newStatus,setNewStatus]=useState('in_progress'),[reason,setReason]=useState('');

 useEffect(()=>{
  let live=true;
  setFailure('');setRecords(null);
  client.rpc('pitacco_support_list',{p_store:storeId||selectedStore||null,p_status:status||null,p_page:page})
   .then(({data,error})=>{if(error)throw error;if(live)setRecords(data)})
   .catch(err=>{if(live)setFailure(err.message||'Não foi possível carregar os chamados.')});
  return()=>{live=false};
 },[client,storeId,selectedStore,status,page,revision]);
 useEffect(()=>{
  if(!opened){setDetails(null);return;}
  let live=true;
  client.rpc('pitacco_support_details',{p_ticket:opened})
   .then(({data,error})=>{if(error)throw error;if(live)setDetails(data)})
   .catch(error=>{if(live)setFailure(error.message||'Não foi possível abrir o histórico.')});
  return()=>{live=false};
 },[client,opened,revision]);

 async function act(call,params,success){
  setBusy(true);setFailure('');setNotice('');
  try{
   const {error}=await client.rpc(call,params);
   if(error)throw error;
   setNotice(success);refresh(x=>x+1);
   return true;
  }catch(err){setFailure(err.message||'Não foi possível concluir a operação.');return false;}
  finally{setBusy(false)}
 }
 async function create(event){
  event.preventDefault();
  const ok=await act('pitacco_support_create',{p_store:storeId,p_category:category,p_subject:subject.trim(),p_description:description.trim()},'Chamado criado. O administrador poderá acompanhar e responder.');
  if(ok){setSubject('');setDescription('');setPage(0);}
 }
 async function sendReply(event){
  event.preventDefault();
  const ok=await act('pitacco_support_reply',{p_ticket:opened,p_message:reply.trim()},'Mensagem enviada ao histórico do chamado.');
  if(ok)setReply('');
 }
 async function changeStatus(event){
  event.preventDefault();
  const ok=await act('pitacco_owner_support_status',{p_ticket:opened,p_status:newStatus,p_reason:reason.trim()},'Situação registrada no histórico.');
  if(ok)setReason('');
 }
 return <section className="panel" aria-label={owner?'Central de suporte do Pitacco':'Chamados de suporte'}>
  <h3>{owner?'Central de suporte · Todas as lojas':'Falar com o suporte Pitacco'}</h3>
  <p>Envie solicitações sem sair do painel. As mensagens ficam vinculadas à loja e podem ser acompanhadas aqui.</p>
  {!owner&&<form onSubmit={create} aria-label="Abrir chamado de suporte">
   <label>Assunto<input required minLength={8} maxLength={160} value={subject} onChange={e=>setSubject(e.target.value)} placeholder="Descreva o problema em poucas palavras"/></label>
   <label>Tipo de solicitação<select value={category} onChange={e=>setCategory(e.target.value)}>
    {Object.entries(categories).map(([key,label])=><option key={key} value={key}>{label}</option>)}
   </select></label>
   <label>Descrição<textarea required minLength={15} maxLength={3000} rows={4} value={description}
    onChange={e=>setDescription(e.target.value)} placeholder="Explique o que aconteceu, sem informar senhas ou dados bancários"/></label>
   <button type="submit" disabled={busy||!storeId}>Abrir chamado</button>
  </form>}
  <div className="dispatch-actions">
   {owner&&<label>Loja<select aria-label="Filtrar chamados por loja" value={selectedStore} onChange={e=>{setSelectedStore(e.target.value);setPage(0);setOpened(null)}}>
    <option value="">Todas as lojas</option>{stores.map(store=><option value={store.id} key={store.id}>{store.name}</option>)}
   </select></label>}
   <label>Situação<select aria-label="Filtrar chamados por situação" value={status} onChange={e=>{setStatus(e.target.value);setPage(0);setOpened(null)}}>
    <option value="">Todas</option>{Object.entries(statuses).map(([key,label])=><option key={key} value={key}>{label}</option>)}
   </select></label>
   <button type="button" className="secondary" disabled={busy} onClick={()=>refresh(x=>x+1)}>Atualizar chamados</button>
  </div>
  {failure&&<p role="alert">{failure}</p>}
  {notice&&<p role="status">{notice}</p>}
  {!records&&!failure&&<p role="status">Carregando chamados…</p>}
  {records?.rows?.length===0&&<p>Nenhum chamado encontrado.</p>}
  <div style={{display:'grid',gap:8}}>
   {records?.rows?.map(row=><div key={row.id} className="panel" style={{margin:0,padding:12}}>
    <div><strong>{row.subject}</strong> · {statuses[row.status]||row.status}</div>
    <small>{owner?row.store_name+' · ':''}{categories[row.category]||row.category} · Atualizado em {stamp(row.updated_at)}</small>
    <div className="dispatch-actions"><button type="button" className="secondary" onClick={()=>{setOpened(row.id);setDetails(null);setFailure('');setNotice('')}}>Ver histórico e responder</button></div>
   </div>)}
  </div>
  {(page>0||records?.has_more)&&<div className="dispatch-actions">
   <button type="button" className="secondary" disabled={page===0} onClick={()=>{setPage(p=>p-1);setOpened(null)}}>Anterior</button>
   <span>Página {page+1}</span>
   <button type="button" className="secondary" disabled={!records?.has_more} onClick={()=>{setPage(p=>p+1);setOpened(null)}}>Próxima</button>
  </div>}
  {opened&&<section className="panel" aria-label="Histórico do chamado">
   <div className="dispatch-actions"><h4>{details?.ticket?.subject||'Carregando histórico…'}</h4><button type="button" className="secondary" onClick={()=>{setOpened(null);setDetails(null)}}>Fechar histórico</button></div>
   {details&&<>
    <p>Situação: <strong>{statuses[details.ticket.status]}</strong></p>
    <ol>{details.messages.map(m=><li key={m.id} style={{marginBottom:10}}>
     <small>{stamp(m.created_at)} · {m.event_type==='status'?'Alteração de situação':'Mensagem registrada'}</small>
     <div style={{whiteSpace:'pre-wrap',overflowWrap:'anywhere'}}>{m.body}</div>
    </li>)}</ol>
    {details.ticket.status!=='closed'&&<form onSubmit={sendReply}>
     <label>Responder<textarea required minLength={4} maxLength={3000} rows={3} value={reply} onChange={e=>setReply(e.target.value)}/></label>
     <button disabled={busy}>Enviar resposta</button>
    </form>}
    {owner&&<form onSubmit={changeStatus} aria-label="Alterar situação do chamado">
     <label>Nova situação<select value={newStatus} onChange={e=>setNewStatus(e.target.value)}>
      {Object.entries(statuses).map(([key,label])=><option key={key} value={key}>{label}</option>)}
     </select></label>
     <label>Motivo da alteração<textarea required minLength={5} maxLength={1000} rows={2} value={reason} onChange={e=>setReason(e.target.value)}/></label>
     <button disabled={busy||newStatus===details.ticket.status}>Registrar alteração</button>
    </form>}
   </>}
  </section>}
 </section>;
}
