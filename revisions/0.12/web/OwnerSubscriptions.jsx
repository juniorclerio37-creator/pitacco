import {OwnerPlanRequests} from './PlanChange.jsx';
import React,{useEffect,useMemo,useState} from 'react';
const money=new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'});
const dates=new Intl.DateTimeFormat('pt-BR',{timeZone:'America/Sao_Paulo',dateStyle:'short'});
const statuses={active:'Ativa',trial:'Em teste',overdue:'Vencida',legacy:'Anterior à cobrança',courtesy:'Cortesia',suspended:'Suspensa'};
const date=value=>value?dates.format(new Date(value)):'—';
export default function OwnerSubscriptions({client}){
 const [rows,setRows]=useState([]),[busy,setBusy]=useState(true),[error,setError]=useState('');
 const [action,setAction]=useState('courtesy'),[days,setDays]=useState(7),[value,setValue]=useState(''),[reason,setReason]=useState(''),[saving,setSaving]=useState(false),[notice,setNotice]=useState('');
 const [search,setSearch]=useState(''),[filter,setFilter]=useState('all'),[selected,setSelected]=useState(null),[reload,setReload]=useState(0);
 useEffect(()=>{let live=true;(async()=>{
  setBusy(true);setError('');
  const {data,error}=await client.rpc('pitacco_owner_subscription_details');
  if(!live)return;
  if(error)setError(error.message);
  else setRows(Array.isArray(data)?data:[]);
  setBusy(false);
 })().catch(e=>{if(live){setError(e.message);setBusy(false);}});return()=>{live=false;};},[client,reload]);
 const visible=useMemo(()=>rows.filter(r=>(filter==='all'||r.status===filter)&&r.name.toLocaleLowerCase('pt-BR').includes(search.toLocaleLowerCase('pt-BR'))),[rows,filter,search]);
 const submit=async()=>{if(!selected||!reason.trim()||!window.confirm('Confirmar '+action+' para esta loja?'))return;
 setSaving(true);setError('');setNotice('');
 try{const {error}=await client.rpc('pitacco_owner_subscription_action',{p_store:selected,p_action:action,p_days:['courtesy','extend_trial'].includes(action)?Number(days):null,p_value:['notes','due_date'].includes(action)?value:null,p_reason:reason});
 if(error)throw error;setNotice('Alteração registrada com sucesso.');setReason('');setReload(n=>n+1);}
 catch(e){setError(e.message||String(e));}finally{setSaving(false);}};
 const current=rows.find(r=>r.id===selected);
 const count=status=>rows.filter(r=>r.status===status).length;
 return <section aria-label="Gestão de assinaturas">
  <OwnerPlanRequests client={client}/>
  <div className="panel">
   <h3>Assinaturas dos estabelecimentos</h3>
   <p>Consulta administrativa. Os dados de pagamentos são somente confirmações registradas no Pitacco.</p>
   <dl><div className="line"><dt>Ativas</dt><dd>{count('active')}</dd></div>
   <div className="line"><dt>Em teste</dt><dd>{count('trial')}</dd></div>
   <div className="line"><dt>Suspensas</dt><dd>{count("suspended")}</dd></div><div className="line"><dt>Cortesia</dt><dd>{count("courtesy")}</dd></div><div className="line"><dt>Vencidas</dt><dd>{count('overdue')}</dd></div>
   <div className="line"><dt>Receita recorrente estimada (ativas)</dt><dd>{money.format(rows.filter(r=>r.status==='active').reduce((n,r)=>n+Number(r.monthly_amount||0),0))}</dd></div></dl>
   <div className="line">
    <label>Buscar loja <input type="search" value={search} onChange={e=>setSearch(e.target.value)} /></label>
    <label>Situação <select value={filter} onChange={e=>setFilter(e.target.value)}>
     <option value="all">Todas</option><option value="active">Ativas</option><option value="trial">Em teste</option><option value="overdue">Vencidas</option><option value="legacy">Anteriores à cobrança</option><option value="courtesy">Cortesia</option><option value="suspended">Suspensas</option>
    </select></label>
    <button type="button" className="secondary" disabled={busy} onClick={()=>setReload(n=>n+1)}>Atualizar</button>
   </div>
   {busy&&<p role="status">Consultando assinaturas…</p>}
   {error&&<p role="alert">{error}</p>}
   {!busy&&!error&&visible.length===0&&<p>Nenhuma assinatura encontrada.</p>}
   <div style={{overflowX:'auto'}}><table><thead><tr><th>Loja</th><th>Situação</th><th>Valor</th><th>Cobertura / teste</th><th>Detalhes</th></tr></thead>
   <tbody>{visible.map(r=><tr key={r.id}><td>{r.name}</td><td>{statuses[r.status]||r.status}</td>
    <td>{money.format(Number(r.monthly_amount??59.90))}</td><td>{date(r.paid_until||r.trial_ends_at)}</td>
    <td><button type="button" className="secondary" onClick={()=>setSelected(r.id)}>Ver ficha</button></td></tr>)}</tbody></table></div>
  </div>
  {current&&<section className="panel" aria-label={'Assinatura de '+current.name}>
   <div className="line"><h3>{current.name}</h3><button type="button" className="secondary" onClick={()=>setSelected(null)}>Fechar</button></div>
   <dl>{[['Situação',statuses[current.status]||current.status],['Plano',current.plan],['Mensalidade',money.format(Number(current.monthly_amount??59.90))],['Cadastro',date(current.created_at)],['Fim do teste',date(current.trial_ends_at)],['Cobertura paga até',date(current.paid_until)],['Vencimento cadastrado',current.due_date?date(current.due_date):'—'],['Vencimento administrativo',current.admin_due_date?date(current.admin_due_date):'—'],['Cortesia até',date(current.courtesy_until)],['Telefone',current.phone||'—'],['Pedidos registrados',current.orders_count],['Último pedido',date(current.last_order_at)]].map(([label,value])=><div className="line" key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
   <h4>Pagamentos confirmados no Pitacco</h4>
   {!current.payments?.length?<p>Nenhum pagamento confirmado registrado.</p>:<div style={{overflowX:'auto'}}><table><thead><tr><th>Data</th><th>Provedor</th><th>Valor</th><th>Cobertura até</th><th>Referência</th></tr></thead><tbody>{current.payments.map(p=><tr key={p.provider+':'+p.payment_id}><td>{date(p.confirmed_at)}</td><td>{p.provider}</td><td>{money.format(Number(p.amount))}</td><td>{date(p.paid_until)}</td><td>{p.payment_id}</td></tr>)}</tbody></table></div>}
   <h4>Ações administrativas</h4>
   <p><small>As alterações exigem justificativa, confirmação e ficam registradas. A data administrativa de vencimento não altera automaticamente a cobrança no provedor.</small></p>
   <div className="line"><label>Ação <select value={action} onChange={e=>{setAction(e.target.value);setValue('');}}>
    <option value="courtesy">Conceder cortesia</option><option value="extend_trial">Prorrogar teste</option>
    <option value="suspend">Suspender loja</option><option value="reactivate">Retirar suspensão</option>
    <option value="due_date">Registrar vencimento administrativo</option><option value="notes">Atualizar observações</option>
   </select></label>
   {['courtesy','extend_trial'].includes(action)&&<label>Dias (1 a 365) <input type="number" min="1" max="365" value={days} onChange={e=>setDays(e.target.value)}/></label>}
   {action==='due_date'&&<label>Data <input type="date" value={value} onChange={e=>setValue(e.target.value)}/></label>}
   {action==='notes'&&<label>Observações <textarea maxLength={3000} value={value} onChange={e=>setValue(e.target.value)}/></label>}
   </div>
   <label>Justificativa (obrigatória) <textarea maxLength={500} value={reason} onChange={e=>setReason(e.target.value)} placeholder="Motivo da alteração"/></label>
   <div className="line"><button type="button" disabled={saving||reason.trim().length<5||(['courtesy','extend_trial'].includes(action)&&!(Number(days)>=1&&Number(days)<=365))||(['notes','due_date'].includes(action)&&!value)} onClick={submit}>{saving?'Salvando…':'Confirmar alteração'}</button></div>
   {notice&&<p role="status">{notice}</p>}
   <h4>Observações internas</h4><p style={{whiteSpace:'pre-wrap'}}>{current.notes||'Nenhuma observação registrada.'}</p>
   <h4>Histórico administrativo</h4>
   {!current.audit?.length?<p>Nenhuma alteração registrada.</p>:<div style={{overflowX:'auto'}}><table><thead><tr><th>Quando</th><th>Ação</th><th>Responsável</th><th>Motivo</th></tr></thead><tbody>{current.audit.map((a,i)=><tr key={i}><td>{date(a.created_at)}</td><td>{a.action}</td><td>{a.actor}</td><td>{a.details?.reason}</td></tr>)}</tbody></table></div>}
  </section>}
 </section>;
}
