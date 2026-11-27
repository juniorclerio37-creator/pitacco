import React,{useEffect,useMemo,useState} from 'react';
import {BellOff,Send,RefreshCw,Users,Store,Bike} from 'lucide-react';
import './owner-courier-campaigns.css';

const audienceTypes=[
 {value:'all',label:'Todos os entregadores de todas as lojas'},
 {value:'store',label:'Entregadores de uma loja'},
 {value:'courier',label:'Um entregador específico'}
];
function dateLabel(value){
 try{return new Date(value).toLocaleString('pt-BR');}catch{return '—';}
}
function getError(error){return error?.message||String(error||'Não foi possível concluir a operação.');}

export default function OwnerCourierCampaigns({client,stores=[]}){
 const [couriers,setCouriers]=useState([]);
 const [history,setHistory]=useState([]);
 const [scope,setScope]=useState('all');
 const [storeId,setStoreId]=useState('');
 const [courierId,setCourierId]=useState('');
 const [title,setTitle]=useState('');
 const [message,setMessage]=useState('');
 const [loading,setLoading]=useState(true);
 const [sending,setSending]=useState(false);
 const [error,setError]=useState('');
 const [notice,setNotice]=useState('');
 const storeNames=useMemo(()=>new Map(stores.map(s=>[s.id,s.name])),[stores]);

 async function reload(){
  setLoading(true);setError('');
  try{
   const [a,b]=await Promise.all([
    client.rpc('pitacco_admin_courier_audience'),
    client.rpc('pitacco_admin_courier_campaign_history')
   ]);
   if(a.error)throw a.error;
   if(b.error)throw b.error;
   setCouriers(a.data||[]);
   setHistory(b.data||[]);
  }catch(failure){setError(getError(failure));}
  finally{setLoading(false);}
 }
 useEffect(()=>{let active=true;
  Promise.all([
    client.rpc('pitacco_admin_courier_audience'),
    client.rpc('pitacco_admin_courier_campaign_history')
  ]).then(([a,b])=>{
   if(!active)return;
   if(a.error)throw a.error;
   if(b.error)throw b.error;
   setCouriers(a.data||[]);setHistory(b.data||[]);
  }).catch(err=>{if(active)setError(getError(err));})
   .finally(()=>{if(active)setLoading(false);});
  return()=>{active=false};
 },[client]);

 const selectable=couriers.filter(c=>c.active);
 const displayed=selectable.filter(c=>scope!=='store'||c.store_id===storeId);
 const selectedCourier=selectable.find(c=>c.id===courierId);
 const targetCount=scope==='all'?selectable.length:
  scope==='store'?displayed.length:selectedCourier?1:0;
 const registered=scope==='all'?selectable.reduce((sum,c)=>sum+Number(c.registered_devices||0),0):
  scope==='store'?displayed.reduce((sum,c)=>sum+Number(c.registered_devices||0),0):
   Number(selectedCourier?.registered_devices||0);

 async function send(event){
  event.preventDefault();
  setError('');setNotice('');
  if(!targetCount){setError('Não existem entregadores ativos nesse público.');return;}
  if(scope==='store'&&!storeId){setError('Escolha a loja.');return;}
  if(scope==='courier'&&!courierId){setError('Escolha o entregador.');return;}
  const heading=title.trim(),content=message.trim();
  if(!heading||heading.length>80||!content||content.length>400){
   setError('Informe um título de até 80 caracteres e uma mensagem de até 400 caracteres.');return;
  }
  const group=scope==='all'?'TODOS os entregadores ativos de todas as lojas':
   scope==='store'?'os entregadores ativos de '+(storeNames.get(storeId)||'esta loja'):
   'o entregador '+(selectedCourier?.name||'selecionado');
  if(!window.confirm('Confirmar comunicado SILENCIOSO para '+group+'?\n\n'+heading+
   '\n\nNão será usado o toque de novos pedidos.'))return;
  setSending(true);
  try{
   const requestId=crypto.randomUUID();
   const {data,error:failure}=await client.rpc('pitacco_admin_send_courier_campaign',{
    p_request:requestId,p_audience:scope,
    p_store:scope==='store'?storeId:null,
    p_courier:scope==='courier'?courierId:null,
    p_title:heading,p_body:content
   });
   if(failure)throw failure;
   if(!data?.campaign_id)throw Error('Servidor não confirmou o comunicado.');
   const queued=Number(data.queued_devices||0);
   setNotice('Comunicado registrado para '+Number(data.targeted_couriers||0)+
    ' entregador(es). '+queued+' aparelho(s) apto(s) enfileirado(s). '+
    (queued?'Os envios serão processados pelo Firebase; confira o histórico para acompanhar.':
     'Nenhum aparelho compatível está registrado no momento. O texto ficará no histórico do aplicativo.'));
   setTitle('');setMessage('');
   await reload();
  }catch(failure){setError(getError(failure));}
  finally{setSending(false);}
 }

 return <section className="owner-courier-campaigns" aria-label="Comunicados aos entregadores">
  <header className="panel">
   <h3><BellOff size={21}/> Comunicados aos entregadores</h3>
   <p>Envie campanhas de incentivo e mensagens informativas com notificação <strong>sem som</strong>.
    O sino e a voz permanecem exclusivos dos pedidos atribuídos pelas lojas.</p>
  </header>
  {loading&&<p role="status">Carregando entregadores e histórico…</p>}
  {error&&<p role="alert" className="owner-courier-error">{error}</p>}
  {notice&&<p role="status" className="owner-courier-success">{notice}</p>}
  <form className="panel owner-courier-campaign-form" onSubmit={send}>
   <h4>Nova campanha</h4>
   <label>Destinatários
    <select value={scope} onChange={e=>{setScope(e.target.value);setCourierId('');setStoreId('');}}>
     {audienceTypes.map(item=><option key={item.value} value={item.value}>{item.label}</option>)}
    </select>
   </label>
   {scope==='store'&&<label>Loja
    <select required value={storeId} onChange={e=>setStoreId(e.target.value)}>
     <option value="">Selecione uma loja</option>
     {stores.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}
    </select>
   </label>}
   {scope==='courier'&&<label>Entregador
    <select required value={courierId} onChange={e=>setCourierId(e.target.value)}>
     <option value="">Selecione um entregador</option>
     {selectable.map(c=><option key={c.id} value={c.id}>
      {c.name} — {c.store_name||storeNames.get(c.store_id)||'Loja'}
     </option>)}
    </select>
   </label>}
   <div className="owner-courier-stats">
    <span><Users size={16}/> {targetCount} entregador(es) ativo(s)</span>
    <span><Bike size={16}/> {registered} aparelho(s) cadastrado(s)</span>
    <span><BellOff size={16}/> Sem sino ou voz</span>
   </div>
   <label>Título da notificação
    <input maxLength={80} required value={title} onChange={e=>setTitle(e.target.value)}
     placeholder="Ex.: Campanha de incentivo do Pitacco"/>
    <small>{title.length}/80</small>
   </label>
   <label>Mensagem
    <textarea rows={5} maxLength={400} required value={message}
     onChange={e=>setMessage(e.target.value)}
     placeholder="Ex.: Nesta semana temos uma campanha especial de incentivo para entregadores…"/>
    <small>{message.length}/400</small>
   </label>
   <p className="owner-courier-hint">Apenas o Super Admin tem permissão de enviar.
    A confirmação registra os destinatários e o histórico, inclusive quando não houver celular cadastrado.</p>
   <button type="submit" disabled={sending||loading||!targetCount}>
    <Send size={16}/> {sending?'Registrando envio…':'Confirmar e enviar comunicado'}
   </button>
  </form>
  <section className="panel owner-courier-history">
   <header><h4>Histórico dos comunicados</h4>
    <button type="button" className="secondary" onClick={reload} disabled={loading}>
     <RefreshCw size={16}/> Atualizar</button>
   </header>
   {!history.length?<p>Nenhum comunicado enviado até agora.</p>:<div className="owner-courier-history-list">
    {history.map(item=><article key={item.id}>
     <div className="owner-courier-history-heading">
      <strong>{item.title}</strong><small>{dateLabel(item.created_at)}</small>
     </div>
     <p>{item.body}</p>
     <small>{item.audience==='all'?'Todas as lojas':
      item.audience==='store'?'Loja: '+(storeNames.get(item.store_id)||item.store_id):
       'Destinatário individual'} · {item.targeted_couriers} entregador(es) ·
      {' '+item.sent_devices}/{item.queued_devices} aparelho(s) enviados via Firebase</small>
    </article>)}
   </div>}
  </section>
 </section>;
}
