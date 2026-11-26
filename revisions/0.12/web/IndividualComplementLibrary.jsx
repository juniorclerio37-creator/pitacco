import React,{useEffect,useRef,useState} from 'react';
const brl=value=>Number(value).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
const states={available:'Disponível em todos',mixed:'Disponibilidade varia por grupo',unavailable:'Indisponível',blocked:'Bloqueado em todos'};
export default function IndividualComplementLibrary({client,storeId,onChanged}){
 const [rows,setRows]=useState([]),[query,setQuery]=useState(''),[filter,setFilter]=useState('all'),[loading,setLoading]=useState(true),[busy,setBusy]=useState(''),[error,setError]=useState(''),[notice,setNotice]=useState('');
 const lock=useRef(false);
 async function read(){const {data,error}=await client.rpc('pitacco_central_complement_list',{p_store:storeId});if(error)throw error;return Array.isArray(data)?data:[];}
 useEffect(()=>{let active=true;setLoading(true);read().then(data=>{if(active)setRows(data)}).catch(e=>{if(active)setError(e.message||'Não foi possível consultar a biblioteca.')}).finally(()=>{if(active)setLoading(false)});return()=>{active=false}},[client,storeId]);
 async function change(row,available){
  if(lock.current)return;
  if(!window.confirm((available?'Disponibilizar':'Indisponibilizar')+' “'+row.name+'” em todos os grupos e produtos desta loja? Os preços e as regras de escolha serão mantidos.'))return;
  lock.current=true;setBusy(row.key);setError('');setNotice('');
  try{
   const {data,error}=await client.rpc('pitacco_central_complement_availability',{p_store:storeId,p_name_key:row.key,p_available:available});
   if(error)throw error;if(!data?.saved)throw Error('Alteração não confirmada.');
   setRows(await read());setNotice(row.name+': disponibilidade atualizada em '+data.affected_options+' vínculo(s).');onChanged?.();
  }catch(e){setError(e.message||'Não foi possível atualizar o complemento.');}finally{lock.current=false;setBusy('')}
 }
 const shown=rows.filter(r=>r.name.toLocaleLowerCase('pt-BR').includes(query.trim().toLocaleLowerCase('pt-BR'))&&(filter==='all'||r.state===filter));
 return <section className="catalog-hub" aria-label="Complementos individuais">
 <div className="catalog-hub-header"><div><span className="eyebrow">BIBLIOTECA CENTRAL</span><h3>Complementos individuais</h3><p>Um cadastro por nome. Controle a disponibilidade em todos os produtos e grupos vinculados, sem alterar os preços específicos.</p></div></div>
 <div className="catalog-stat-row"><span><strong>{rows.length}</strong> complementos</span><span><strong>{rows.filter(r=>r.state==='blocked').length}</strong> bloqueados em todos</span><span><strong>{rows.reduce((n,r)=>n+Number(r.links||0),0)}</strong> vínculos ativos</span></div>
 <div className="catalog-inline-fields"><label>Buscar complemento<input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Ex.: Leite em pó"/></label><label>Disponibilidade<select value={filter} onChange={e=>setFilter(e.target.value)}><option value="all">Todos</option>{Object.entries(states).map(([key,label])=><option key={key} value={key}>{label}</option>)}</select></label></div>
 {error&&<p className="catalog-error" role="alert">{error}</p>}{notice&&<p className="catalog-notice" role="status">{notice}</p>}{loading&&<p role="status">Carregando biblioteca…</p>}
 <div className="catalog-existing-list">{shown.map(r=><div className="catalog-existing-row" key={r.key}>
 <div><b>{r.name}</b><small>{r.products} produto(s) · {r.links} vínculo(s) · {states[r.state]||r.state}</small><small>Grupos: {(r.groups||[]).join(' · ')}</small><small>Preços por grupo: {(r.prices||[]).map(brl).join(' / ')}</small></div>
 <div className="catalog-actions">{r.state!=='available'&&<button type="button" disabled={Boolean(busy)} onClick={()=>change(r,true)}>Disponibilizar em todos</button>}{r.state!=='blocked'&&<button type="button" className="secondary" disabled={Boolean(busy)} onClick={()=>change(r,false)}>Indisponibilizar em todos</button>}</div>
 </div>)}</div>
 {!loading&&!shown.length&&<p>Nenhum complemento encontrado.</p>}
 </section>;
}
