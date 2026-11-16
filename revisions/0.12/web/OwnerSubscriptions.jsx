import React,{useEffect,useMemo,useState} from 'react';
const money=new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'});
const dates=new Intl.DateTimeFormat('pt-BR',{timeZone:'America/Sao_Paulo',dateStyle:'short'});
const statuses={active:'Ativa',trial:'Em teste',overdue:'Vencida',legacy:'Anterior à cobrança'};
const date=value=>value?dates.format(new Date(value)):'—';
export default function OwnerSubscriptions({client}){
 const [rows,setRows]=useState([]),[busy,setBusy]=useState(true),[error,setError]=useState('');
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
 const current=rows.find(r=>r.id===selected);
 const count=status=>rows.filter(r=>r.status===status).length;
 return <section aria-label="Gestão de assinaturas">
  <div className="panel">
   <h3>Assinaturas dos estabelecimentos</h3>
   <p>Consulta administrativa. Os dados de pagamentos são somente confirmações registradas no Pitacco.</p>
   <dl><div className="line"><dt>Ativas</dt><dd>{count('active')}</dd></div>
   <div className="line"><dt>Em teste</dt><dd>{count('trial')}</dd></div>
   <div className="line"><dt>Vencidas</dt><dd>{count('overdue')}</dd></div>
   <div className="line"><dt>Receita recorrente estimada (ativas)</dt><dd>{money.format(rows.filter(r=>r.status==='active').reduce((n,r)=>n+Number(r.monthly_amount||0),0))}</dd></div></dl>
   <div className="line">
    <label>Buscar loja <input type="search" value={search} onChange={e=>setSearch(e.target.value)} /></label>
    <label>Situação <select value={filter} onChange={e=>setFilter(e.target.value)}>
     <option value="all">Todas</option><option value="active">Ativas</option><option value="trial">Em teste</option><option value="overdue">Vencidas</option><option value="legacy">Anteriores à cobrança</option>
    </select></label>
    <button type="button" className="secondary" disabled={busy} onClick={()=>setReload(n=>n+1)}>Atualizar</button>
   </div>
   {busy&&<p role="status">Consultando assinaturas…</p>}
   {error&&<p role="alert">{error}</p>}
   {!busy&&!error&&visible.length===0&&<p>Nenhuma assinatura encontrada.</p>}
   <div style={{overflowX:'auto'}}><table><thead><tr><th>Loja</th><th>Situação</th><th>Valor</th><th>Cobertura / teste</th><th>Detalhes</th></tr></thead>
   <tbody>{visible.map(r=><tr key={r.id}><td>{r.name}</td><td>{statuses[r.status]||r.status}</td>
    <td>{money.format(Number(r.monthly_amount||59.90))}</td><td>{date(r.paid_until||r.trial_ends_at)}</td>
    <td><button type="button" className="secondary" onClick={()=>setSelected(r.id)}>Ver ficha</button></td></tr>)}</tbody></table></div>
  </div>
  {current&&<section className="panel" aria-label={'Assinatura de '+current.name}>
   <div className="line"><h3>{current.name}</h3><button type="button" className="secondary" onClick={()=>setSelected(null)}>Fechar</button></div>
   <dl>{[['Situação',statuses[current.status]||current.status],['Plano',current.plan],['Mensalidade',money.format(Number(current.monthly_amount||59.90))],['Cadastro',date(current.created_at)],['Fim do teste',date(current.trial_ends_at)],['Cobertura paga até',date(current.paid_until)],['Vencimento cadastrado',current.due_date?date(current.due_date):'—'],['Telefone',current.phone||'—'],['Pedidos registrados',current.orders_count],['Último pedido',date(current.last_order_at)]].map(([label,value])=><div className="line" key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
   <h4>Pagamentos confirmados no Pitacco</h4>
   {!current.payments?.length?<p>Nenhum pagamento confirmado registrado.</p>:<div style={{overflowX:'auto'}}><table><thead><tr><th>Data</th><th>Provedor</th><th>Valor</th><th>Cobertura até</th><th>Referência</th></tr></thead><tbody>{current.payments.map(p=><tr key={p.provider+':'+p.payment_id}><td>{date(p.confirmed_at)}</td><td>{p.provider}</td><td>{money.format(Number(p.amount))}</td><td>{date(p.paid_until)}</td><td>{p.payment_id}</td></tr>)}</tbody></table></div>}
   <p><small>Liberações, cortesias e mudanças de vencimento exigem fluxo auditável próprio; nenhuma alteração financeira é feita nesta tela.</small></p>
  </section>}
 </section>;
}
