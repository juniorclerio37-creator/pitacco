import React,{useEffect,useRef,useState} from 'react';
import {Package,Link2,Lock,Image,Search,LayoutGrid,List,X,Layers} from 'lucide-react';
const brl=value=>Number(value).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
const states={available:'Disponível em todos',mixed:'Disponibilidade varia por grupo',unavailable:'Indisponível',blocked:'Bloqueado em todos'};
export default function IndividualComplementLibrary({client,storeId,onChanged,products=[],groups=[],options=[],templates=[]}){
 const [rows,setRows]=useState([]),[query,setQuery]=useState(''),[filter,setFilter]=useState('all'),[loading,setLoading]=useState(true),[busy,setBusy]=useState(''),[error,setError]=useState(''),[notice,setNotice]=useState('');
 const [mode,setMode]=useState('grid'),[selectedKey,setSelectedKey]=useState(''),[detail,setDetail]=useState('summary'),[order,setOrder]=useState('name');
 const lock=useRef(false);
 const normalize=v=>String(v??'').trim().toLocaleLowerCase('pt-BR').replace(/\s+/g,' ');
 const imageFor=r=>options.find(o=>normalize(o.name)===r.key&&o.image_url)?.image_url||templates.flatMap(t=>t.options||[]).find(o=>normalize(o.name)===r.key&&o.image_url)?.image_url;
 const selected=rows.find(r=>r.key===selectedKey);
 const linkedGroups=selected?groups.filter(g=>g.enabled!==false&&options.some(o=>o.group_id===g.id&&normalize(o.name)===selected.key&&(!o.library_option_id||!g.library_template_id||templates.find(t=>t.id===g.library_template_id)?.options?.some(x=>x.id===o.library_option_id)))):[];
 const linkedProducts=products.filter(p=>linkedGroups.some(g=>g.product_id===p.id));
 function selectRow(r){setSelectedKey(r.key);setDetail('summary')}
 const priceText=r=>{const p=(r.prices||[]).map(Number);return !p.length?'—':Math.min(...p)===Math.max(...p)?brl(p[0]):brl(Math.min(...p))+' – '+brl(Math.max(...p))};
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
 const shown=rows.filter(r=>normalize(r.name).includes(normalize(query))&&(filter==='all'||(filter==='no_photo'?!imageFor(r):r.state===filter))).sort((a,b)=>order==='used'?b.links-a.links||a.name.localeCompare(b.name,'pt-BR'):a.name.localeCompare(b.name,'pt-BR'));
 const photo=r=><div className="complement-thumb">{imageFor(r)?<img src={imageFor(r)} alt=""/>:<Image size={25}/>}</div>;
 const status=r=><span className="complement-status" data-state={r.state}>{states[r.state]||r.state}</span>;
 const actions=r=><div className="catalog-actions complement-card-actions">{r.state!=='available'&&<button type="button" disabled={Boolean(busy)} onClick={()=>change(r,true)}>Disponibilizar em todos</button>}{r.state!=='blocked'&&<button type="button" className="secondary" disabled={Boolean(busy)} onClick={()=>change(r,false)}>Indisponibilizar em todos</button>}</div>;
 return <section className="catalog-hub" aria-label="Complementos individuais">
 <div className="catalog-hub-header"><div><span className="eyebrow">GESTÃO CENTRALIZADA</span><h3>Biblioteca de complementos</h3><p>Um cadastro por complemento. Preços e regras de escolha por grupo são preservados.</p></div></div>
 <div className="catalog-stat-row complement-metrics"><span><Package size={20}/><strong>{rows.length}</strong> complementos cadastrados</span><span><Link2 size={20}/><strong>{rows.reduce((n,r)=>n+Number(r.links||0),0)}</strong> vínculos em produtos</span><span><Lock size={20}/><strong>{rows.filter(r=>r.state==='blocked').length}</strong> bloqueados em todos</span><span><Layers size={20}/><strong>{new Set(groups.filter(g=>g.enabled!==false).map(g=>g.product_id)).size}</strong> produtos vinculados</span></div>
 <div className="complement-tools"><label className="complement-search"><Search size={17}/><input aria-label="Buscar complemento" value={query} onChange={e=>setQuery(e.target.value)} placeholder="Buscar complemento..."/></label><select aria-label="Filtrar disponibilidade" value={filter} onChange={e=>setFilter(e.target.value)}><option value="all">Todos</option>{Object.entries(states).map(([key,label])=><option key={key} value={key}>{label}</option>)}<option value="no_photo">Sem foto</option></select><select aria-label="Ordenar complementos" value={order} onChange={e=>setOrder(e.target.value)}><option value="name">Nome A–Z</option><option value="used">Mais usados</option></select><div className="catalog-actions"><button type="button" className={mode==='grid'?'':'secondary'} aria-label="Ver em cards" aria-pressed={mode==='grid'} onClick={()=>setMode('grid')}><LayoutGrid size={18}/></button><button type="button" className={mode==='list'?'':'secondary'} aria-label="Ver em lista" aria-pressed={mode==='list'} onClick={()=>setMode('list')}><List size={18}/></button></div></div>
 {error&&<p className="catalog-error" role="alert">{error}</p>}{notice&&<p className="catalog-notice" role="status">{notice}</p>}{loading&&<p role="status">Carregando biblioteca…</p>}
 <div className={'complement-individual-layout'+(selected?' has-detail':'')}>
 <div className={'complement-card-grid '+(mode==='list'?'list-mode':'')}>{shown.map(r=><article className={'complement-card'+(selectedKey===r.key?' selected':'')} key={r.key}>
 <button type="button" className="complement-card-heading" onClick={()=>selectRow(r)}>{photo(r)}<span><b>{r.name}</b>{status(r)}</span></button>
 <div className="complement-card-info"><span><Package size={15}/>{r.products} produtos</span><span><Layers size={15}/>{(r.groups||[]).length} grupos</span><span>{priceText(r)}</span></div>{actions(r)}
 </article>)}</div>
 {selected&&<section className="complement-detail" aria-label={'Detalhes de '+selected.name}><div className="complement-detail-heading">{photo(selected)}<div><h3>{selected.name}</h3>{status(selected)}</div><button className="secondary" type="button" aria-label="Fechar detalhes" onClick={()=>setSelectedKey('')}><X size={18}/></button></div>
 <div className="complement-detail-tabs" role="tablist" aria-label="Detalhes do complemento">{[['summary','Resumo'],['products','Produtos'],['groups','Grupos']].map(([id,label])=><button role="tab" type="button" key={id} aria-selected={detail===id} className={detail===id?'':'secondary'} onClick={()=>setDetail(id)}>{label}</button>)}</div>
 {detail==='summary'&&<div className="complement-settings"><div className="complement-info-box"><b>Disponibilidade em todos os produtos</b><p>Os preços e limites dos grupos não serão alterados.</p>{actions(selected)}</div><div className="complement-info-box"><b>Resumo</b><p>{selected.products} produtos · {selected.links} vínculos</p><p>Preços: {priceText(selected)}</p></div></div>}
 {detail==='products'&&<div className="complement-settings">{linkedProducts.map(p=><div className="complement-info-box" key={p.id}>{p.name}</div>)}{!linkedProducts.length&&<p>Nenhum produto vinculado.</p>}</div>}
 {detail==='groups'&&<div className="complement-settings">{(selected.groups||[]).map(g=><div className="complement-info-box" key={g}>{g}</div>)}</div>}
 </section>}
 </div>{!loading&&!shown.length&&<p>Nenhum complemento encontrado.</p>}
 </section>;
}
