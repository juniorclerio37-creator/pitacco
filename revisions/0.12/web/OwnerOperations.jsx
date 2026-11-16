import React,{useEffect,useState} from 'react';
const day=new Intl.DateTimeFormat('pt-BR',{timeZone:'America/Sao_Paulo',dateStyle:'short',timeStyle:'short'});
const money=new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'});
const statuses={pending:'Aguardando aceite',scheduled:'Agendado',preparing:'Em preparo',ready:'Pronto',delivery:'Em entrega',completed:'Concluído',cancelled:'Cancelado',rejected:'Recusado'};
const channels={proprio:'Pedido próprio',ifood:'iFood','99food':'99Food',keeta:'Keeta'};
const delivery={store:'Loja',marketplace:'Parceira',pickup:'Retirada',unknown:'Não informado'};
const headings={orders:['Pedido','Loja','Origem','Situação','Entrega','Valor','Recebido em'],couriers:['Entregador','Loja ou frota','Vínculo','Conexão','Em andamento','Concluídas'],audit:['Loja','Ação registrada','Data']};
const titles={orders:'Pedidos globais',couriers:'Entregadores',audit:'Auditoria operacional'};
const formatDate=value=>day.format(new Date(value));
export default function OwnerOperations({client,stores,kind,storeId}){
 const [filters,setFilters]=useState({}),[page,setPage]=useState(0);
 const [result,setResult]=useState(null),[error,setError]=useState(''),[busy,setBusy]=useState(true);
 const [revision,retry]=useState(0);
 useEffect(()=>{
  let live=true;
  const controller=new AbortController();
  setBusy(true);setError('');
  (async()=>{
   try{
    const args={p_kind:kind,p_store:storeId||filters.p_store||null,p_page:page,...filters};
    if(storeId)args.p_store=storeId;
    const {data,error}=await client.rpc('pitacco_owner_operation_rows',args).abortSignal(controller.signal);
    if(error||!Array.isArray(data?.rows))throw error||Error();
    if(live)setResult(data);
   }catch{if(live){setError('Não foi possível carregar os dados. Tente novamente.');setResult(null);}}
   finally{if(live)setBusy(false);}
  })();
  return()=>{live=false;controller.abort();};
 },[client,kind,storeId,filters,page,revision]);
 function search(event){
  event.preventDefault();
  const next=Object.fromEntries([...new FormData(event.currentTarget)].filter(([,value])=>value!==''));
  for(const key of ['p_min','p_max'])if(key in next)next[key]=Number(next[key]);
  setFilters(next);
  setPage(0);
 }
 return <section className="panel" aria-label={titles[kind]} aria-busy={busy}>
  <h3>{titles[kind]}</h3>
  <form onSubmit={search}>
   {!storeId&&<label className="field">Filtrar por loja<select name="p_store"><option value="">Todas as lojas</option>{stores.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}</select></label>}
   {kind!=='couriers'&&<><label className="field">Início<input type="date" name="p_start"/></label><label className="field">Fim<input type="date" name="p_end"/></label></>}
   {kind==='orders'&&<>
    <label className="field">Origem<select name="p_source"><option value="">Todas</option>{Object.entries(channels).map(([id,name])=><option key={id} value={id}>{name}</option>)}</select></label>
    <label className="field">Situação<select name="p_status"><option value="">Todas</option>{Object.entries(statuses).map(([id,name])=><option key={id} value={id}>{name}</option>)}</select></label>
    <label className="field">Tipo de entrega<select name="p_delivery"><option value="">Todos</option>{Object.entries(delivery).map(([id,name])=><option key={id} value={id}>{name}</option>)}</select></label>
    <label className="field">Valor mínimo<input type="number" name="p_min" min="0" step=".01"/></label>
    <label className="field">Valor máximo<input type="number" name="p_max" min="0" step=".01"/></label>
   </>}
   {kind==='couriers'&&<label className="field">Conexão<select name="p_status"><option value="">Todos</option><option value="online">Online</option><option value="offline">Offline</option></select></label>}
   <button disabled={busy}>Aplicar filtros</button>
  </form>
  {busy&&<p role="status">Consultando…</p>}
  {error&&<p role="alert">{error} <button className="secondary" type="button" onClick={()=>retry(n=>n+1)}>Tentar novamente</button></p>}
  {!busy&&result?.rows.length===0&&<p>Nenhum registro para os filtros informados.</p>}
  {!!result?.rows.length&&<div className="owner-dashboard-table" tabIndex={0}>
   <table aria-label={titles[kind]}><thead><tr>{headings[kind].map(h=><th key={h} scope="col">{h}</th>)}</tr></thead>
    <tbody>{result.rows.map(r=>{
     const cells=kind==='orders'?[r.reference,r.store_name,channels[r.source]||r.source,statuses[r.status],delivery[r.delivery],money.format(r.gross),formatDate(r.created_at)]
      :kind==='couriers'?[r.name,r.store_name,r.active?'Ativo':'Inativo',r.online?'Online':'Offline',r.in_progress,r.completed]
      :[r.store_name,r.action.replaceAll('_',' '),formatDate(r.created_at)];
     return <tr key={r.id}>{cells.map((value,i)=><td key={i}>{value}</td>)}</tr>;
    })}</tbody>
   </table>
  </div>}
  {(page>0||result?.has_more)&&<div className="quick-actions"><button className="secondary" disabled={busy||page===0} onClick={()=>setPage(n=>n-1)}>Anterior</button>
   <button className="secondary" disabled={busy||!result?.has_more} onClick={()=>setPage(n=>n+1)}>Próxima</button></div>}
 </section>;
}
