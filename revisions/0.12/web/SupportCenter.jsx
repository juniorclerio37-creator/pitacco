import React,{useEffect,useRef,useState} from 'react';
import {Headphones,Plus,MessageCircle,RefreshCw,Clock,ChevronRight,CheckCircle,ArrowLeft,Send,ShoppingBag,Printer,Bike,Wallet,Plug,KeyRound,HelpCircle,Inbox,ShieldCheck} from 'lucide-react';
import './support-center-modern.css';
const categories={pedidos:'Pedidos',impressoes:'Impressão',entregas:'Entregas',financeiro:'Financeiro',integracoes:'Integrações',acesso:'Acesso',outros:'Outros'};
const categoryIcons={pedidos:ShoppingBag,impressoes:Printer,entregas:Bike,financeiro:Wallet,integracoes:Plug,acesso:KeyRound,outros:HelpCircle};
const statuses={open:'Aberto',in_progress:'Em atendimento',waiting_store:'Aguardando lojista',resolved:'Resolvido',closed:'Encerrado'};
const dt=new Intl.DateTimeFormat('pt-BR',{timeZone:'America/Sao_Paulo',dateStyle:'short',timeStyle:'short'});
const stamp=value=>value&&Number.isFinite(Date.parse(value))?dt.format(new Date(value)):'—';
const protocol=id=>'#'+String(id||'').slice(0,8).toUpperCase();
function Status({value}){return <span className={'psc-status psc-status-'+value}>{statuses[value]||'Situação indisponível'}</span>}
export default function SupportCenter({client,storeId=null,stores=[],owner=false}){
 const [selectedStore,setSelectedStore]=useState(storeId||''),[status,setStatus]=useState('');
 const [page,setPage]=useState(0),[revision,refresh]=useState(0);
 const [records,setRecords]=useState(null),[details,setDetails]=useState(null);
 const [opened,setOpened]=useState(null),[composer,setComposer]=useState(false),[busy,setBusy]=useState(false),[failure,setFailure]=useState(''),[notice,setNotice]=useState('');
 const [category,setCategory]=useState(''),[subject,setSubject]=useState(''),[description,setDescription]=useState('');
 const [reply,setReply]=useState(''),[newStatus,setNewStatus]=useState('in_progress'),[reason,setReason]=useState('');
 const lock=useRef(false),mounted=useRef(true),scope=useRef(storeId);
 scope.current=storeId;
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false}},[]);
 useEffect(()=>{setSelectedStore(storeId||'');setPage(0);setStatus('');setOpened(null);setDetails(null);setComposer(false);setCategory('');setSubject('');setDescription('');setReply('');setReason('');setNotice('')},[storeId]);
 useEffect(()=>{
  let live=true;
  setRecords(null);
  client.rpc('pitacco_support_list',{p_store:storeId||selectedStore||null,p_status:status||null,p_page:page})
   .then(({data,error})=>{if(error)throw error;if(live)setRecords(data)})
   .catch(err=>{if(live)setFailure(err.message||'Não foi possível carregar os chamados.')});
  return()=>{live=false};
 },[client,storeId,selectedStore,status,page,revision]);
 useEffect(()=>{
  if(!opened){setDetails(null);return;}
  let live=true;
  client.rpc('pitacco_support_details',{p_ticket:opened})
   .then(({data,error})=>{if(error)throw error;if(live&&data?.ticket?.id===opened)setDetails(data);else if(live)throw Error('Chamado não encontrado.')})
   .catch(error=>{if(live)setFailure(error.message||'Não foi possível abrir o histórico.')});
  return()=>{live=false};
 },[client,opened,revision,storeId]);
 async function act(call,params,success,confirmed){
  if(lock.current)return null;
  lock.current=true;const current=scope.current;setBusy(true);setFailure('');setNotice('');
  try{
   const {data,error}=await client.rpc(call,params);
   if(error)throw error;
   if(!confirmed(data))throw Error('A operação não foi confirmada pelo servidor.');
   if(!mounted.current||current!==scope.current)return null;
   setNotice(success);refresh(x=>x+1);
   return {data};
  }catch(err){if(mounted.current&&current===scope.current)setFailure(err.message||'Não foi possível concluir a operação.');return null;}
  finally{lock.current=false;if(mounted.current)setBusy(false)}
 }
 const valid=Boolean(category&&subject.trim().length>=8&&description.trim().length>=15&&storeId);
 async function create(event){
  event.preventDefault();if(!valid||busy)return;
  const result=await act('pitacco_support_create',{p_store:storeId,p_category:category,p_subject:subject.trim(),p_description:description.trim()},'Chamado criado. Acompanhe as respostas por aqui.',id=>typeof id==='string'&&/^[0-9a-f-]{36}$/i.test(id));
  if(result){setCategory('');setSubject('');setDescription('');setPage(0);setStatus('');setComposer(false);setDetails(null);setOpened(result.data);}
 }
 async function sendReply(event){
  event.preventDefault();if(busy||reply.trim().length<4)return;
  const result=await act('pitacco_support_reply',{p_ticket:opened,p_message:reply.trim()},'Mensagem enviada.',data=>data?.sent===true);
  if(result)setReply('');
 }
 async function changeStatus(event){
  event.preventDefault();if(busy||reason.trim().length<5)return;
  const result=await act('pitacco_owner_support_status',{p_ticket:opened,p_status:newStatus,p_reason:reason.trim()},'Situação registrada no histórico.',data=>data?.updated===true);
  if(result)setReason('');
 }
 function openTicket(id){setComposer(false);setOpened(id);setDetails(null);setReply('');setReason('');setFailure('');setNotice('')}
 function filter(value){setStatus(value);setPage(0);setOpened(null);setDetails(null);setFailure('');setNotice('')}
 return <section className="psc" aria-label={owner?'Central de suporte do Pitacco':'Chamados de suporte'}>
  <div className="psc-head"><div className="psc-head-icon"><Headphones size={25}/></div><div><span className="psc-eyebrow">ATENDIMENTO PITACCO</span><h3>{owner?'Central de suporte':'Meus chamados'}</h3><p>{owner?'Acompanhe e responda às solicitações dos estabelecimentos.':'Precisa de ajuda? Abra um chamado e acompanhe todas as respostas em um só lugar.'}</p></div>
   {!owner&&<button type="button" disabled={busy||!storeId} onClick={()=>{setComposer(true);setOpened(null);setDetails(null);setFailure('');setNotice('')}}><Plus size={18}/> Novo chamado</button>}
  </div>
  {failure&&<p className="psc-feedback psc-error" role="alert">{failure}</p>}
  {notice&&<p className="psc-feedback" role="status"><CheckCircle size={17}/>{notice}</p>}
  {!owner&&composer&&<form className="psc-card psc-compose" onSubmit={create} aria-label="Abrir chamado de suporte">
   <div className="psc-section-head"><div><span className="psc-eyebrow">NOVA SOLICITAÇÃO</span><h4>Como podemos ajudar?</h4><p>Escolha o assunto e conte o que aconteceu.</p></div><button type="button" className="secondary" disabled={busy} onClick={()=>setComposer(false)}>Voltar aos chamados</button></div>
   <label>Tipo de solicitação<select required value={category} disabled={busy} onChange={e=>setCategory(e.target.value)}><option value="">Selecione uma categoria</option>{Object.entries(categories).map(([key,label])=><option key={key} value={key}>{label}</option>)}</select></label>
   <div className="psc-categories" role="group" aria-label="Escolha rápida da categoria">{Object.entries(categories).map(([key,label])=>{const Icon=categoryIcons[key];return <button type="button" key={key} disabled={busy} aria-pressed={category===key} onClick={()=>setCategory(key)}><Icon size={19}/>{label}</button>})}</div>
   <label>Assunto<input required minLength={8} maxLength={160} value={subject} disabled={busy} onChange={e=>setSubject(e.target.value)} placeholder="Ex.: Não consigo imprimir um pedido"/></label>
   <label>Descrição<textarea required minLength={15} maxLength={3000} rows={5} value={description} disabled={busy} onChange={e=>setDescription(e.target.value)} placeholder="O que aconteceu? Em qual tela? Qual mensagem apareceu?"/><small>{description.length}/3000 caracteres</small></label>
   <div className="psc-tip"><ShieldCheck size={18}/><span>Se necessário, informe o número do pedido e a versão do aplicativo. Não envie senhas, códigos de acesso ou dados bancários.</span></div>
   <div className="psc-actions"><button type="button" className="secondary" disabled={busy} onClick={()=>setComposer(false)}>Cancelar</button><button type="submit" disabled={busy||!valid}><Send size={17}/>{busy?'Enviando…':'Abrir chamado'}</button></div>
  </form>}
  {!composer&&<div className="psc-card">
   <div className="psc-section-head"><div><h4>{owner?'Solicitações recebidas':'Histórico de atendimento'}</h4><p>Consulte a situação ou continue uma conversa.</p></div><button type="button" className="secondary" disabled={busy} onClick={()=>{setFailure('');refresh(x=>x+1)}}><RefreshCw size={16}/> Atualizar chamados</button></div>
   {owner&&<label>Loja<select aria-label="Filtrar chamados por loja" value={selectedStore} onChange={e=>{setSelectedStore(e.target.value);setPage(0);setOpened(null);setDetails(null)}}><option value="">Todas as lojas</option>{stores.map(store=><option value={store.id} key={store.id}>{store.name}</option>)}</select></label>}
   <div className="psc-filter-row" role="group" aria-label="Filtrar por situação">{[['','Todos'],...Object.entries(statuses)].map(([value,label])=><button key={value||'all'} type="button" aria-pressed={status===value} onClick={()=>filter(value)}>{label}</button>)}</div>
   {!records&&!failure&&<p role="status">Carregando chamados…</p>}
   {records?.rows?.length===0&&<div className="psc-empty"><Inbox size={35}/><strong>Nenhum chamado encontrado.</strong><p>{status?'Experimente outra situação.':'Os chamados desta loja aparecerão aqui.'}</p></div>}
   <div className="psc-list">{records?.rows?.map(row=>{const Icon=categoryIcons[row.category]||HelpCircle;return <article key={row.id} className={'psc-ticket'+(opened===row.id?' psc-ticket-active':'')}>
    <div className="psc-ticket-icon"><Icon size={20}/></div><div className="psc-ticket-main"><small>{protocol(row.id)} · {owner?row.store_name+' · ':''}{categories[row.category]||row.category}</small><strong>{row.subject}</strong><small><Clock size={13}/> {stamp(row.updated_at)} · {Number(row.messages||0)} mensagens</small></div><Status value={row.status}/><button type="button" className="secondary" onClick={()=>openTicket(row.id)} aria-label={'Ver histórico e responder: '+row.subject}>Ver chamado <ChevronRight size={16}/></button>
   </article>})}</div>
   {(page>0||records?.has_more)&&<div className="psc-actions"><button type="button" className="secondary" disabled={page===0} onClick={()=>{setPage(p=>p-1);setOpened(null)}}>Anterior</button><span>Página {page+1}</span><button type="button" className="secondary" disabled={!records?.has_more} onClick={()=>{setPage(p=>p+1);setOpened(null)}}>Próxima</button></div>}
  </div>}
  {!composer&&opened&&<section className="psc-card psc-thread" aria-label="Histórico do chamado">
   <div className="psc-section-head"><div><span className="psc-eyebrow">PROTOCOLO {protocol(opened)}</span><h4>{details?.ticket?.subject||'Carregando histórico…'}</h4>{details&&<p>{categories[details.ticket.category]} · Aberto em {stamp(details.ticket.created_at)}</p>}</div><button type="button" className="secondary" onClick={()=>{setOpened(null);setDetails(null);setReply('')}}><ArrowLeft size={17}/> Fechar histórico</button></div>
   {details&&<><div className="psc-thread-state"><Status value={details.ticket.status}/><small>Atualizado em {stamp(details.ticket.updated_at)}</small></div>
    <ol className="psc-messages">{(details.messages||[]).map(m=><li key={m.id} className={m.event_type==='status'?'psc-event':m.from_admin?'psc-message psc-admin':'psc-message psc-store'}><small>{m.event_type==='status'?'Atualização do chamado':m.from_admin?'Equipe Pitacco':'Loja'} · {stamp(m.created_at)}</small><div>{m.body}</div></li>)}</ol>
    {details.ticket.status!=='closed'?<form className="psc-reply" onSubmit={sendReply}><label>Responder<textarea required minLength={4} maxLength={3000} rows={3} disabled={busy} value={reply} onChange={e=>setReply(e.target.value)} placeholder="Escreva sua mensagem…"/></label><div className="psc-actions"><button type="submit" disabled={busy||reply.trim().length<4}><Send size={16}/> Enviar resposta</button></div></form>:<p>Este chamado foi encerrado. Abra um novo chamado caso precise de mais ajuda.</p>}
    {owner&&<form className="psc-reply" onSubmit={changeStatus} aria-label="Alterar situação do chamado"><label>Nova situação<select value={newStatus} onChange={e=>setNewStatus(e.target.value)}>{Object.entries(statuses).map(([key,label])=><option key={key} value={key}>{label}</option>)}</select></label><label>Motivo da alteração<textarea required minLength={5} maxLength={1000} rows={2} value={reason} onChange={e=>setReason(e.target.value)}/></label><div className="psc-actions"><button disabled={busy||newStatus===details.ticket.status||reason.trim().length<5}>Registrar alteração</button></div></form>}
   </>}
  </section>}
 </section>;
}
