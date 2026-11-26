import React,{useEffect,useMemo,useRef,useState} from 'react';
import {Layers,Package,Search,Image,Link2,Settings2,Plus,Pencil,ChevronDown} from 'lucide-react';
import './complement-workspace.css';
import ProductComplements from './ProductComplements.jsx';
import IndividualComplementLibrary from './IndividualComplementLibrary.jsx';
import {uploadStoreImage,mediaUrl} from './StoreProfile.jsx';
import './catalog-studio-modern.css';

const fresh=()=>({id:null,name:'',min:0,max:1,options:[],assigned:[]});
const currency=v=>Number(v||0).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
const optionNew=()=>({id:crypto.randomUUID(),name:'',price:0,available:true,image_url:''});
export default function CentralComplementLibrary({client,storeId,products,onChanged}){
 const [libraryView,setLibraryView]=useState('individual');
 const [groupSearch,setGroupSearch]=useState(''),[optionSearch,setOptionSearch]=useState(''),[productSearch,setProductSearch]=useState(''),[detailTab,setDetailTab]=useState('items'),[expandedOption,setExpandedOption]=useState(null),[pickExisting,setPickExisting]=useState('');
 const [templates,setTemplates]=useState([]),[existing,setExisting]=useState([]),[existingOptions,setExistingOptions]=useState([]);
 const [selected,setSelected]=useState(null),[draft,setDraft]=useState(fresh),[files,setFiles]=useState({}),[fileUrls,setFileUrls]=useState({});
 const [loading,setLoading]=useState(true),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
 const [editingProduct,setEditingProduct]=useState(null),[showExisting,setShowExisting]=useState(false);
 const loadToken=useRef(0);
 const productName=new Map(products.map(p=>[p.id,p.name]));
 const assignedIds=useMemo(()=>new Set(existing.filter(g=>g.library_template_id===draft.id&&g.enabled!==false).map(g=>g.product_id)),[existing,draft.id]);
 const totalAssigned=existing.filter(g=>g.library_template_id&&g.enabled!==false).length;
 async function readPages(table,fields,sort){
  // A API pagina os resultados em lotes de 1000. Uma loja pode ter milhares de complementos.
  const all=[];
  for(let page=0;page<30;page++){
   const {data,error:requestError}=await client.from(table).select(fields).eq('store_id',storeId)
    .order(sort).order('id').range(page*1000,page*1000+999);
   if(requestError)throw requestError;
   all.push(...(data||[]));
   if((data||[]).length<1000)return all;
  }
  throw Error('A lista de complementos excede o limite de consulta. Consulte o suporte.');
 }
 async function load(){
  const token=++loadToken.current;
  setLoading(true);setError('');
  try{
   const [t,g,o]=await Promise.all([
    readPages('pitacco_complement_templates','*','sort_order'),
    readPages('product_option_groups','id,product_id,name,min_select,max_select,enabled,library_template_id,sort_order','sort_order'),
    readPages('product_options','id,group_id,name,additional_price,available,image_url,library_option_id','sort_order')
   ]);
   if(token!==loadToken.current)return;
   setTemplates([...t].sort((a,b)=>(a.sort_order||0)-(b.sort_order||0)||a.name.localeCompare(b.name,'pt-BR')));setExisting(g);setExistingOptions(o);
  }catch(e){if(token===loadToken.current)setError('Falha ao carregar grupos: '+(e.message||String(e)));}
  finally{if(token===loadToken.current)setLoading(false);}
 }
 useEffect(()=>{setTemplates([]);setExisting([]);setExistingOptions([]);setSelected(null);setDraft(fresh());setEditingProduct(null);setLibraryView('individual');load();return()=>{loadToken.current++}},[client,storeId]);
 useEffect(()=>()=>Object.values(fileUrls).forEach(url=>URL.revokeObjectURL(url)),[fileUrls]);
 function openTemplate(t){
  setSelected(t?.id||null);setDetailTab(t?'items':'settings');setOptionSearch('');setProductSearch('');setExpandedOption(null);setPickExisting('');setFiles({});setFileUrls({});setError('');setNotice('');
  if(!t){setDraft(fresh());return;}
  const attached=existing.filter(g=>g.library_template_id===t.id&&g.enabled!==false).map(g=>g.product_id);
  setDraft({id:t.id,name:t.name,min:t.min_select,max:t.max_select,options:(t.options||[]).map(o=>({...o})),assigned:attached});
 }
 function sourceGroup(g){
  const opts=existingOptions.filter(o=>o.group_id===g.id).map(o=>({
   id:crypto.randomUUID(),name:o.name,price:Number(o.additional_price),available:o.available,image_url:o.image_url||''
  }));
  setSelected(null);setDetailTab('settings');setFiles({});setFileUrls({});setDraft({id:null,name:g.name,min:g.min_select,max:g.max_select,options:opts,assigned:[]});
  setError('');setNotice('Modelo criado com os dados de '+(productName.get(g.product_id)||'produto')+'. Selecione os produtos que receberão uma cópia compartilhada antes de salvar.');
  setShowExisting(false);
 }
 const edit=(key,value)=>setDraft(d=>({...d,[key]:value}));
 const editOption=(id,key,value)=>setDraft(d=>({...d,options:d.options.map(o=>o.id===id?{...o,[key]:value}:o)}));
 const toggleProduct=id=>setDraft(d=>({...d,assigned:d.assigned.includes(id)?d.assigned.filter(x=>x!==id):[...d.assigned,id]}));
 function fileOption(id,file){
  if(!file)return;
  if(!['image/jpeg','image/png','image/webp'].includes(file.type)||file.size>5*1024*1024){
   setError('Selecione JPG, PNG ou WebP de até 5 MB.');return;
  }
  setFiles(p=>({...p,[id]:file}));setFileUrls(p=>({...p,[id]:URL.createObjectURL(file)}));
 }
 async function moveTemplate(index,direction){
  if(busy)return;
  const target=index+direction;
  if(target<0||target>=templates.length)return;
  const next=[...templates];
  [next[index],next[target]]=[next[target],next[index]];
  setBusy(true);setError('');setNotice('');
  try{
   const {data,error}=await client.rpc('pitacco_catalog_reorder',{
    p_store:storeId,p_kind:'templates',p_ids:next.map(t=>t.id),
    p_parent:null,p_category:null,p_categories:null
   });
   if(error)throw error;
   if(!data?.saved)throw Error('Ordem não confirmada');
   setTemplates(next.map((t,i)=>({...t,sort_order:(i+1)*10})));
   setNotice('Ordem dos grupos da biblioteca salva.');
  }catch(e){setError('Não foi possível ordenar os grupos: '+(e.message||String(e)));}
  finally{setBusy(false)}
 }
 function moveDraftOption(index,direction){
  const target=index+direction;
  if(target<0||target>=draft.options.length)return;
  const next=[...draft.options];[next[index],next[target]]=[next[target],next[index]];
  edit('options',next);
 }
 async function save(){
  if(busy)return;setBusy(true);setError('');setNotice('');
  try{
   if(draft.name.trim().length<2||draft.max<1||draft.min<0||draft.min>draft.max)throw Error('Confira o nome e os limites do grupo.');
   const options=[];
   for(const item of draft.options){
    if(!item.name.trim()||!Number.isFinite(Number(item.price))||Number(item.price)<0)throw Error('Confira nome e preço dos complementos.');
    let image=item.image_url||'';
    if(files[item.id]) image=mediaUrl(client,await uploadStoreImage(client,storeId,files[item.id],'products'));
    options.push({id:item.id,name:item.name.trim(),price:Number(item.price),available:item.available!==false,image_url:image});
   }
   if(draft.assigned.length&&options.filter(o=>o.available).length<draft.min)throw Error('Quantidade de complementos disponíveis abaixo do mínimo.');
   const {data,error:saveError}=await client.rpc('pitacco_complement_template_save',{
    p_store:storeId,p_template:draft.id,p_name:draft.name.trim(),p_min:Number(draft.min),
    p_max:Number(draft.max),p_options:options,p_product_ids:draft.assigned
   });
   if(saveError)throw saveError;
   if(!data?.saved)throw Error('O servidor não confirmou o salvamento.');
   setFiles({});setFileUrls({});setSelected(data.id);
   setNotice('Grupo salvo e aplicado a '+data.assigned_products+' produto(s). As alterações já estão disponíveis no cardápio.');
   await load();onChanged?.();
   setDraft({...draft,id:data.id,options:data.options,assigned:draft.assigned});setExpandedOption(null);
  }catch(e){setError('Não foi possível salvar: '+(e.message||String(e)))}
  finally{setBusy(false)}
 }
 const uniqueExisting=existing.filter(g=>!g.library_template_id&&g.enabled!==false);
 const productForEditing=products.find(p=>p.id===editingProduct);
 const normalized=v=>String(v??'').trim().toLocaleLowerCase('pt-BR').replace(/\s+/g,' ');
 const namedOptions=Array.from(new Map([...templates.flatMap(t=>t.options||[]),...existingOptions.map(o=>({name:o.name,price:o.additional_price,available:o.available,image_url:o.image_url}))].map(o=>[normalized(o.name),o])).values()).sort((a,b)=>a.name.localeCompare(b.name,'pt-BR'));
 function addExisting(){const o=namedOptions.find(x=>normalized(x.name)===pickExisting);if(!o||draft.options.length>=100)return;const id=crypto.randomUUID();edit('options',[...draft.options,{...o,id,price:0,available:o.available!==false}]);setExpandedOption(id);setPickExisting('');setOptionSearch('');}
 function addNew(){const o=optionNew();edit('options',[...draft.options,o]);setExpandedOption(o.id);setOptionSearch('');}
 const viewTabs=<div className="catalog-actions complement-view-tabs" role="group" aria-label="Visualização da biblioteca"><button type="button" className={libraryView==='groups'?'':'secondary'} aria-pressed={libraryView==='groups'} onClick={()=>{setLibraryView('groups');setDraft(fresh());setSelected(null);setDetailTab('settings');load()}}><Layers size={17}/> Grupos de complementos</button><button type="button" className={libraryView==='individual'?'':'secondary'} aria-pressed={libraryView==='individual'} onClick={()=>{if(draft.id||draft.name||draft.options.length){if(!window.confirm('Voltar à biblioteca? Alterações ainda não salvas neste grupo serão descartadas.'))return;}setDraft(fresh());setSelected(null);setLibraryView('individual')}}><Package size={17}/> Biblioteca de complementos</button></div>;
 if(libraryView==='individual')return <section className="complement-workspace">{viewTabs}<IndividualComplementLibrary key={storeId} client={client} storeId={storeId} onChanged={()=>{load();onChanged?.()}} products={products} groups={existing} options={existingOptions} templates={templates}/></section>;
 return <section className="catalog-hub complement-workspace" aria-label="Biblioteca de complementos">
  {viewTabs}
  <header className="catalog-hub-header"><div><span className="eyebrow">GESTÃO CENTRALIZADA</span><h3>Grupos de complementos</h3>
   <p>Crie grupos independentes, adicione fotos aos itens e vincule um mesmo grupo a diferentes produtos.</p></div>
   <button type="button" disabled={busy} onClick={()=>openTemplate(null)}><Plus size={17}/> Novo grupo</button></header>
  {error&&<p className="catalog-error" role="alert">{error}</p>}
  {notice&&<p className="catalog-notice" role="status">{notice}</p>}
  <div className="catalog-stat-row complement-metrics"><span><Layers size={20}/><strong>{templates.length}</strong> grupos compartilhados</span><span><Package size={20}/><strong>{namedOptions.length}</strong> complementos individuais</span><span><Link2 size={20}/><strong>{totalAssigned}</strong> vínculos de grupos</span><span><Package size={20}/><strong>{new Set(existing.filter(g=>g.enabled!==false).map(g=>g.product_id)).size}</strong> produtos vinculados</span></div>
  {loading&&<p role="status">Carregando complementos…</p>}
  {(uniqueExisting.length>0||editingProduct)&&<div className="catalog-existing"><div className="catalog-line-title">
   <div><h4>Complementos já cadastrados nos produtos</h4><p>Inclui os grupos importados anteriormente. Você pode editá-los aqui, sem precisar voltar à aba Produtos.</p></div>
   <button type="button" className="secondary" onClick={()=>setShowExisting(p=>!p)}>{showExisting?'Ocultar grupos':'Ver grupos existentes ('+uniqueExisting.length+')'}</button>
  </div>
  {showExisting&&<div className="catalog-existing-list">
   {uniqueExisting.map(g=><div key={g.id} className="catalog-existing-row">
    <div><b>{g.name}</b><small>{productName.get(g.product_id)||'Produto indisponível'} · {existingOptions.filter(o=>o.group_id===g.id).length} opções</small></div>
    <div className="catalog-actions"><button type="button" className="secondary" onClick={()=>{setEditingProduct(g.product_id);setShowExisting(false)}}>Editar aqui</button>
     <button type="button" className="secondary" onClick={()=>sourceGroup(g)}>Usar como modelo</button></div>
   </div>)}
   {!uniqueExisting.length&&<p>Todos os grupos estão na biblioteca compartilhada.</p>}
  </div>}
  {editingProduct&&productForEditing&&<div className="catalog-embedded-editor">
   <div className="catalog-line-title"><h4>Editando complementos de {productForEditing.name}</h4>
    <button type="button" className="secondary" onClick={()=>{setEditingProduct(null);load()}}>Fechar edição</button></div>
   <ProductComplements key={editingProduct} client={client} storeId={storeId} product={productForEditing}
    onGroupsChange={()=>{}}/>
  </div>}
  </div>}
  <div className="catalog-library-grid complement-group-grid">
   <aside className="catalog-library-list" aria-label="Grupos compartilhados">
    <h4>Grupos ({templates.length})</h4><label className="complement-search"><Search size={17}/><input aria-label="Buscar grupo" value={groupSearch} onChange={e=>setGroupSearch(e.target.value)} placeholder="Buscar grupo..."/></label>
    {templates.map((t,index)=>{
     if(!normalized(t.name).includes(normalized(groupSearch)))return null;
     const variants=templates.filter(group=>group.name===t.name);
     const variantNumber=variants.findIndex(group=>group.id===t.id)+1;
     const linkedProducts=existing.filter(group=>group.library_template_id===t.id&&group.enabled!==false).length;
     return <div className="catalog-template-sort-row" key={t.id}>
     <button onClick={()=>openTemplate(t)} type="button" className={draft.id===t.id?'catalog-group-active':''}>
      <b className="complement-group-title"><Layers size={18}/>{t.name}{variants.length>1?' · Variação '+variantNumber:''}</b>
      <small>{(t.options||[]).length} complemento(s) · {t.min_select} a {t.max_select} escolhas · {linkedProducts} produto(s)</small>
      <small>{(t.options||[]).slice(0,3).map(option=>option.name+(Number(option.price)>0?' ('+currency(option.price)+')':'')).join(' · ')}</small>
     </button>
     <button type="button" className="secondary catalog-sort-arrow" disabled={busy||index===0}
      aria-label={'Subir grupo compartilhado '+t.name} onClick={()=>moveTemplate(index,-1)}>↑</button>
     <button type="button" className="secondary catalog-sort-arrow" disabled={busy||index===templates.length-1}
      aria-label={'Descer grupo compartilhado '+t.name} onClick={()=>moveTemplate(index,1)}>↓</button>
    </div>})}
    {!templates.length&&!loading&&<p>Crie seu primeiro grupo para vinculá-lo a produtos.</p>}
   </aside>
   <div className="catalog-library-editor complement-group-editor" key={draft.id||'new'}>
    <div className="complement-detail-heading"><div className="complement-group-icon"><Layers size={27}/></div><div><h3>{draft.name||'Novo grupo de complementos'}</h3><p>{draft.options.length} complementos · {draft.assigned.length} produtos vinculados · {draft.min} a {draft.max} escolhas</p></div><button className="secondary" type="button" onClick={()=>setDetailTab('settings')}><Pencil size={15}/> Editar</button></div>
    <div className="complement-detail-tabs" role="tablist" aria-label="Detalhes do grupo">{[['items','Complementos'],['products','Produtos vinculados'],['settings','Configurações']].map(([id,label])=><button role="tab" type="button" key={id} aria-selected={detailTab===id} className={detailTab===id?'':'secondary'} onClick={()=>setDetailTab(id)}>{label}</button>)}</div>
    {draft.id&&templates.filter(t=>t.name===draft.name).length>1&&
      <p className="catalog-hint">Esta configuração é uma variação do grupo “{draft.name}”. As alterações serão aplicadas somente aos produtos marcados abaixo, sem modificar outras variações.</p>}
    <div hidden={detailTab!=='settings'} className="complement-settings"><label>Nome do grupo<input value={draft.name} maxLength={100} onChange={e=>edit('name',e.target.value)} placeholder="Ex.: Frutas, Cremes, Coberturas"/></label>
    <div className="catalog-inline-fields">
     <label>Mínimo de escolhas<input type="number" min="0" max="100" value={draft.min} onChange={e=>edit('min',Number(e.target.value))}/></label>
     <label>Máximo de escolhas<input type="number" min="1" max="100" value={draft.max} onChange={e=>edit('max',Number(e.target.value))}/></label>
    </div></div>
    <div hidden={detailTab!=='items'} className="complement-item-panel"><div className="catalog-line-title"><h4>Itens do grupo</h4>
     <button type="button" className="secondary" disabled={busy||draft.options.length>=100} onClick={addNew}>+ Novo complemento</button></div>
    <div className="complement-tools"><label className="complement-search"><Search size={17}/><input aria-label="Buscar complemento no grupo" placeholder="Buscar complemento..." value={optionSearch} onChange={e=>setOptionSearch(e.target.value)}/></label><select aria-label="Escolher complemento da biblioteca" value={pickExisting} onChange={e=>setPickExisting(e.target.value)}><option value="">Selecionar da biblioteca</option>{namedOptions.filter(o=>!draft.options.some(x=>normalized(x.name)===normalized(o.name))).map(o=><option key={normalized(o.name)} value={normalized(o.name)}>{o.name}</option>)}</select><button type="button" className="secondary" disabled={busy||!pickExisting||draft.options.length>=100} onClick={addExisting}>Adicionar</button></div>
    {draft.options.map((o,index)=>normalized(o.name).includes(normalized(optionSearch))||expandedOption===o.id?<div className="complement-option-wrap" key={o.id}><div className="complement-option-row"><div className="complement-thumb">{fileUrls[o.id]||o.image_url?<img src={fileUrls[o.id]||o.image_url} alt=""/>:<Image size={20}/>}</div><b>{o.name||'Novo complemento'}</b><span>{currency(o.price)}</span><label className="complement-switch"><input type="checkbox" aria-label={'Disponibilidade de '+o.name+' neste grupo'} checked={o.available!==false} onChange={e=>editOption(o.id,'available',e.target.checked)}/><span>{o.available!==false?'Disponível':'Indisponível'}</span></label><div className="catalog-actions"><button className="secondary" type="button" aria-label={'Editar '+o.name} onClick={()=>setExpandedOption(expandedOption===o.id?null:o.id)}><Pencil size={15}/></button><button className="secondary catalog-sort-arrow" type="button" disabled={busy||index===0} aria-label={'Subir complemento '+o.name} onClick={()=>moveDraftOption(index,-1)}>↑</button><button className="secondary catalog-sort-arrow" type="button" disabled={busy||index===draft.options.length-1} aria-label={'Descer complemento '+o.name} onClick={()=>moveDraftOption(index,1)}>↓</button></div></div><div hidden={expandedOption!==o.id} className="catalog-option-edit">
     <div className="catalog-sort-tools catalog-draft-sort">
      <button type="button" className="secondary catalog-sort-arrow" disabled={busy||index===0}
       aria-label={'Subir complemento '+(o.name||'sem nome')} onClick={()=>moveDraftOption(index,-1)}>↑</button>
      <button type="button" className="secondary catalog-sort-arrow" disabled={busy||index===draft.options.length-1}
       aria-label={'Descer complemento '+(o.name||'sem nome')} onClick={()=>moveDraftOption(index,1)}>↓</button>
      <span>{index+1}º</span>
     </div>
     <div className="catalog-option-photo">{fileUrls[o.id]?<img src={fileUrls[o.id]} alt="Nova foto selecionada"/>:o.image_url?<img src={o.image_url} alt={o.name}/>:<span>📷</span>}</div>
     <label>Nome<input value={o.name} maxLength={100} onChange={e=>editOption(o.id,'name',e.target.value)}/></label>
     <label>Valor adicional (R$)<input type="number" min="0" max="100000" step=".01" value={o.price} onChange={e=>editOption(o.id,'price',Number(e.target.value))}/></label>
     <label>Foto<input type="file" accept="image/png,image/jpeg,image/webp" onChange={e=>fileOption(o.id,e.target.files?.[0])}/></label>
     <label className="catalog-checkbox"><input type="checkbox" checked={o.available!==false} onChange={e=>editOption(o.id,'available',e.target.checked)}/>Disponível</label>
     <button type="button" className="secondary" onClick={()=>edit('options',draft.options.filter(x=>x.id!==o.id))}>Retirar do grupo</button>
    </div></div>:null)}
    {!draft.options.length&&<p className="catalog-hint">Você pode criar o grupo agora e adicionar os complementos depois.</p>}
    </div><div hidden={detailTab!=='products'} className="complement-settings"><h4>Produtos que usam este grupo</h4>
    <p className="catalog-hint">Marque os produtos desejados. Alterações neste grupo serão sincronizadas a todos os produtos vinculados, preservando os históricos dos pedidos.</p>
    <label className="complement-search"><Search size={17}/><input value={productSearch} onChange={e=>setProductSearch(e.target.value)} placeholder="Buscar produto..." aria-label="Buscar produto para vincular"/></label><div className="catalog-product-selector complement-products">{products.filter(p=>normalized(p.name).includes(normalized(productSearch))).map(p=><label key={p.id}>
     <input type="checkbox" checked={draft.assigned.includes(p.id)} onChange={()=>toggleProduct(p.id)}/>
     {p.image_url&&<img src={p.image_url} alt=""/>}<span>{p.name}</span>
    </label>)}</div></div>
    <div className="catalog-actions complement-save-bar"><button type="button" onClick={save} disabled={busy}>{busy?'Salvando…':'Salvar grupo e vínculos'}</button>
     <button type="button" className="secondary" onClick={()=>openTemplate(null)} disabled={busy}>Limpar edição</button></div>
   </div>
  </div>

 </section>;
}
