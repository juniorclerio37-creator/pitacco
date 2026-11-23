import React,{useEffect,useMemo,useState} from 'react';
import ProductComplements from './ProductComplements.jsx';
import {uploadStoreImage,mediaUrl} from './StoreProfile.jsx';
import './catalog-studio-modern.css';

const fresh=()=>({id:null,name:'',min:0,max:1,options:[],assigned:[]});
const currency=v=>Number(v||0).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
const optionNew=()=>({id:crypto.randomUUID(),name:'',price:0,available:true,image_url:''});
export default function CentralComplementLibrary({client,storeId,products,onChanged}){
 const [templates,setTemplates]=useState([]),[existing,setExisting]=useState([]),[existingOptions,setExistingOptions]=useState([]);
 const [selected,setSelected]=useState(null),[draft,setDraft]=useState(fresh),[files,setFiles]=useState({}),[fileUrls,setFileUrls]=useState({});
 const [loading,setLoading]=useState(true),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
 const [editingProduct,setEditingProduct]=useState(null),[showExisting,setShowExisting]=useState(false);
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
  setLoading(true);setError('');
  try{
   const [t,g,o]=await Promise.all([
    readPages('pitacco_complement_templates','*','name'),
    readPages('product_option_groups','id,product_id,name,min_select,max_select,enabled,library_template_id','name'),
    readPages('product_options','id,group_id,name,additional_price,available,image_url','sort_order')
   ]);
   setTemplates(t);setExisting(g);setExistingOptions(o);
  }catch(e){setError('Falha ao carregar grupos: '+(e.message||String(e)));}
  finally{setLoading(false);}
 }
 useEffect(()=>{setSelected(null);setDraft(fresh());setEditingProduct(null);load()},[client,storeId]);
 useEffect(()=>()=>Object.values(fileUrls).forEach(url=>URL.revokeObjectURL(url)),[fileUrls]);
 function openTemplate(t){
  setSelected(t?.id||null);setFiles({});setFileUrls({});setError('');setNotice('');
  if(!t){setDraft(fresh());return;}
  const attached=existing.filter(g=>g.library_template_id===t.id&&g.enabled!==false).map(g=>g.product_id);
  setDraft({id:t.id,name:t.name,min:t.min_select,max:t.max_select,options:(t.options||[]).map(o=>({...o})),assigned:attached});
 }
 function sourceGroup(g){
  const opts=existingOptions.filter(o=>o.group_id===g.id).map(o=>({
   id:crypto.randomUUID(),name:o.name,price:Number(o.additional_price),available:o.available,image_url:o.image_url||''
  }));
  setSelected(null);setFiles({});setFileUrls({});setDraft({id:null,name:g.name,min:g.min_select,max:g.max_select,options:opts,assigned:[]});
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
   setDraft({...draft,id:data.id,options:data.options,assigned:draft.assigned});
  }catch(e){setError('Não foi possível salvar: '+(e.message||String(e)))}
  finally{setBusy(false)}
 }
 const uniqueExisting=existing.filter(g=>!g.library_template_id&&g.enabled!==false);
 const productForEditing=products.find(p=>p.id===editingProduct);
 return <section className="catalog-hub" aria-label="Biblioteca de complementos">
  <header className="catalog-hub-header"><div><span className="eyebrow">GESTÃO CENTRALIZADA</span><h3>Grupos e complementos</h3>
   <p>Crie grupos independentes, adicione fotos aos itens e vincule um mesmo grupo a diferentes produtos.</p></div>
   <button type="button" onClick={()=>openTemplate(null)}>+ Novo grupo</button></header>
  {error&&<p className="catalog-error" role="alert">{error}</p>}
  {notice&&<p className="catalog-notice" role="status">{notice}</p>}
  <div className="catalog-stat-row"><span><strong>{templates.length}</strong> grupos compartilhados</span>
   <span><strong>{totalAssigned}</strong> vínculos a produtos</span>
   <span><strong>{uniqueExisting.length}</strong> grupos já cadastrados em produtos</span></div>
  {loading&&<p role="status">Carregando complementos…</p>}
  <div className="catalog-library-grid">
   <aside className="catalog-library-list" aria-label="Grupos compartilhados">
    <h4>Biblioteca da loja</h4>
    <button className={!draft.id?'catalog-group-active':''} onClick={()=>openTemplate(null)} type="button">＋ Criar um grupo independente</button>
    {templates.map(t=><button key={t.id} onClick={()=>openTemplate(t)} type="button"
       className={draft.id===t.id?'catalog-group-active':''}>
      <b>{t.name}</b><small>{(t.options||[]).length} complemento(s) · {t.min_select} a {t.max_select} escolhas</small>
     </button>)}
    {!templates.length&&!loading&&<p>Crie seu primeiro grupo para vinculá-lo a produtos.</p>}
   </aside>
   <div className="catalog-library-editor" key={draft.id||'new'}>
    <h4>{draft.id?'Editar grupo compartilhado':'Novo grupo de complementos'}</h4>
    <label>Nome do grupo<input value={draft.name} maxLength={100} onChange={e=>edit('name',e.target.value)} placeholder="Ex.: Frutas, Cremes, Coberturas"/></label>
    <div className="catalog-inline-fields">
     <label>Mínimo de escolhas<input type="number" min="0" max="100" value={draft.min} onChange={e=>edit('min',Number(e.target.value))}/></label>
     <label>Máximo de escolhas<input type="number" min="1" max="100" value={draft.max} onChange={e=>edit('max',Number(e.target.value))}/></label>
    </div>
    <div className="catalog-line-title"><h4>Itens do grupo</h4>
     <button type="button" className="secondary" disabled={busy||draft.options.length>=100} onClick={()=>edit('options',[...draft.options,optionNew()])}>+ Adicionar complemento</button></div>
    {draft.options.map(o=><div className="catalog-option-edit" key={o.id}>
     <div className="catalog-option-photo">{fileUrls[o.id]?<img src={fileUrls[o.id]} alt="Nova foto selecionada"/>:o.image_url?<img src={o.image_url} alt={o.name}/>:<span>📷</span>}</div>
     <label>Nome<input value={o.name} maxLength={100} onChange={e=>editOption(o.id,'name',e.target.value)}/></label>
     <label>Valor adicional (R$)<input type="number" min="0" max="100000" step=".01" value={o.price} onChange={e=>editOption(o.id,'price',Number(e.target.value))}/></label>
     <label>Foto<input type="file" accept="image/png,image/jpeg,image/webp" onChange={e=>fileOption(o.id,e.target.files?.[0])}/></label>
     <label className="catalog-checkbox"><input type="checkbox" checked={o.available!==false} onChange={e=>editOption(o.id,'available',e.target.checked)}/>Disponível</label>
     <button type="button" className="secondary" onClick={()=>edit('options',draft.options.filter(x=>x.id!==o.id))}>Retirar do grupo</button>
    </div>)}
    {!draft.options.length&&<p className="catalog-hint">Você pode criar o grupo agora e adicionar os complementos depois.</p>}
    <h4>Produtos que usam este grupo</h4>
    <p className="catalog-hint">Marque os produtos desejados. Alterações neste grupo serão sincronizadas a todos os produtos vinculados, preservando os históricos dos pedidos.</p>
    <div className="catalog-product-selector">{products.map(p=><label key={p.id}>
     <input type="checkbox" checked={draft.assigned.includes(p.id)} onChange={()=>toggleProduct(p.id)}/>
     {p.image_url&&<img src={p.image_url} alt=""/>}<span>{p.name}</span>
    </label>)}</div>
    <div className="catalog-actions"><button type="button" onClick={save} disabled={busy}>{busy?'Salvando…':'Salvar grupo e vínculos'}</button>
     <button type="button" className="secondary" onClick={()=>openTemplate(null)} disabled={busy}>Limpar edição</button></div>
   </div>
  </div>
  <div className="catalog-existing"><div className="catalog-line-title">
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
  </div>
 </section>;
}
