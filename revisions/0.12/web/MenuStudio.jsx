import React,{useEffect,useMemo,useState} from 'react';
import ProductComplements from './ProductComplements.jsx';
import CentralComplementLibrary from './CentralComplementLibrary.jsx';
import CatalogFinishedStock from './CatalogFinishedStock.jsx';
import Inventory from './Inventory.jsx';
import StoreDesignStudio from './StoreDesignStudio.jsx';
import './catalog-studio-modern.css';
import {uploadStoreImage,mediaUrl} from './StoreProfile.jsx';
import {CategoryIcon,CATEGORY_ICON_GROUPS,CATEGORY_ICON_KEYS,inferCategoryIcon} from './CategoryIcons.jsx';
const brl=n=>Number(n||0).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
const empty=()=>({name:'',description:'',category:'',price:'',cost:'',menu_active:true,image_url:''});
const field={display:'grid',gap:5,marginBottom:13};
export default function MenuStudio({client,storeId,products=[],store=null,manager=true,onRefresh,onImport,initialSection='Produtos',navigationKey}){
 const [draft,setDraft]=useState(empty),[editing,setEditing]=useState(null),[groups,setGroups]=useState([]),[photo,setPhoto]=useState(null),[previewUrl,setPreviewUrl]=useState(''),[filter,setFilter]=useState(''),[selectedCategory,setSelectedCategory]=useState('Todas'),[busy,setBusy]=useState(false),[notice,setNotice]=useState(''),[section,setSection]=useState(initialSection==='Categorias'?'Produtos':initialSection),[showEditor,setShowEditor]=useState(false);
 useEffect(()=>{setSection(initialSection==='Categorias'?'Produtos':initialSection);setShowEditor(false);if(initialSection==='Categorias')requestAnimationFrame(()=>document.getElementById('catalog-category-navigation')?.scrollIntoView({block:'nearest'}))},[initialSection,navigationKey]);
 const [categoryIcons,setCategoryIcons]=useState({}),[configuringCategory,setConfiguringCategory]=useState(null),[iconBusy,setIconBusy]=useState(false);
 const [categoryRanks,setCategoryRanks]=useState({});
 const categoryName=value=>String(value||'').trim()||'Outros';
 const allCategories=useMemo(()=>[...new Set(products.map(p=>categoryName(p.category)))].sort((a,b)=>a.localeCompare(b,'pt-BR')),[products]);
 const orderedCategories=useMemo(()=>[...allCategories].sort((a,b)=>{
  const ra=categoryRanks[a],rb=categoryRanks[b];
  return (ra==null?2147480000:ra)-(rb==null?2147480000:rb)||a.localeCompare(b,'pt-BR');
 }),[allCategories,categoryRanks]);
 const categories=['Todas',...orderedCategories];
 const orderedProducts=useMemo(()=>[...products].sort((a,b)=>
  ((categoryRanks[categoryName(a.category)]??2147480000)-(categoryRanks[categoryName(b.category)]??2147480000))
  ||categoryName(a.category).localeCompare(categoryName(b.category),'pt-BR')
  ||(Number(a.sort_order)||0)-(Number(b.sort_order)||0)
  ||String(a.name||'').localeCompare(String(b.name||''),'pt-BR')
  ||a.id.localeCompare(b.id)
 ),[products,categoryRanks]);
 const filtered=orderedProducts.filter(p=>(selectedCategory==='Todas'||categoryName(p.category)===selectedCategory)&&String(p.name||'').toLowerCase().includes(filter.toLowerCase()));
 useEffect(()=>{
  let active=true;
  setConfiguringCategory(null);
  client.rpc('pitacco_menu_category_icons_state',{p_store:storeId}).then(({data,error})=>{
   if(!active)return;
   if(error){setNotice('Não foi possível carregar os ícones. '+error.message);return;}
   setCategoryIcons(data&&typeof data==='object'&&!Array.isArray(data)?data:{});
  }).catch(err=>{if(active)setNotice('Não foi possível carregar os ícones: '+(err?.message||'falha de conexão'));});
  return()=>{active=false};
 },[client,storeId]);
 useEffect(()=>{
  let live=true;
  client.from('pitacco_menu_category_order').select('category,sort_order').eq('store_id',storeId)
   .then(({data,error})=>{
    if(!live)return;
    if(error){setNotice('Não foi possível consultar a ordem das categorias: '+error.message);return;}
    setCategoryRanks(Object.fromEntries((data||[]).map(x=>[x.category,x.sort_order])));
   }).catch(error=>{if(live)setNotice('Erro ao carregar ordem das categorias: '+error.message)});
  return()=>{live=false};
 },[client,storeId]);
 async function persistOrder(kind,ids,{parent=null,category=null,categories=null}={}){
  if(busy)return;
  setBusy(true);setNotice('');
  try{
   const {data,error}=await client.rpc('pitacco_catalog_reorder',{
    p_store:storeId,p_kind:kind,p_ids:kind==='categories'?null:ids,
    p_parent:parent,p_category:category,p_categories:categories
   });
   if(error)throw error;
   if(!data?.saved)throw Error('Servidor não confirmou a sequência.');
   if(kind==='categories')setCategoryRanks(Object.fromEntries(categories.map((name,i)=>[name,(i+1)*10])));
   setNotice('Ordem salva e aplicada ao cardápio público.');
   if(kind!=='categories')await onRefresh?.();
  }catch(error){setNotice('Não foi possível ordenar: '+(error.message||String(error)));}
  finally{setBusy(false)}
 }
 function moveCategory(name,direction){
  const ordered=[...orderedCategories],from=ordered.indexOf(name),to=from+direction;
  if(to<0||to>=ordered.length)return;
  [ordered[from],ordered[to]]=[ordered[to],ordered[from]];
  persistOrder('categories',null,{categories:ordered});
 }
 function moveProduct(product,direction){
  const key=categoryName(product.category);
  const siblings=orderedProducts.filter(p=>categoryName(p.category)===key);
  const from=siblings.findIndex(p=>p.id===product.id),to=from+direction;
  if(from<0||to<0||to>=siblings.length)return;
  [siblings[from],siblings[to]]=[siblings[to],siblings[from]];
  persistOrder('products',siblings.map(p=>p.id),{category:key});
 }
 const iconFor=name=>categoryIcons[name]&&CATEGORY_ICON_KEYS.includes(categoryIcons[name])?categoryIcons[name]:inferCategoryIcon(name);
 async function chooseCategoryIcon(category,key){
  if(iconBusy||!CATEGORY_ICON_KEYS.includes(key))return;
  setIconBusy(true);setNotice('');
  try{
   const {data,error}=await client.rpc('pitacco_menu_category_set_icon',{p_store:storeId,p_category:category,p_icon:key});
   if(error)throw error;
   if(!data?.saved)throw Error('O servidor não confirmou o ícone.');
   setCategoryIcons(previous=>({...previous,[category]:key}));
   setNotice('Ícone de '+category+' atualizado no cardápio.');
  }catch(err){setNotice('Não foi possível salvar o ícone: '+(err?.message||'falha de conexão'))}
  finally{setIconBusy(false)}
 }
 useEffect(()=>{if(!photo){setPreviewUrl('');return}const url=URL.createObjectURL(photo);setPreviewUrl(url);return()=>URL.revokeObjectURL(url)},[photo]);
 const change=(k,v)=>setDraft(p=>({...p,[k]:v}));
 const begin=product=>{
  setEditing(product?.id||null);setDraft(product?{...empty(),...product}:empty());
  setGroups([]);setPhoto(null);setShowEditor(true);setNotice('');
 };
 async function save(e){
  e.preventDefault();setBusy(true);setNotice('');
  try{
   const price=Number(draft.price),cost=Number(draft.cost||0);
   if(!draft.name.trim()||!Number.isFinite(price)||price<0||!Number.isFinite(cost)||cost<0)throw Error('Confira nome, preço e custo.');
   const row={store_id:storeId,name:draft.name.trim(),price,cost,description:draft.description,category:draft.category,menu_active:draft.menu_active};
   if(photo)row.image_url=mediaUrl(client,await uploadStoreImage(client,storeId,photo,'products'));
   const query=editing?client.from('products').update(row).eq('id',editing).eq('store_id',storeId):client.from('products').insert(row);
   const {data,error}=await query.select('id').single();
   if(error)throw error;
   setEditing(data.id);
   if(row.image_url)setDraft(previous=>({...previous,image_url:row.image_url}));
   setPhoto(null);setNotice('Produto salvo.');onRefresh?.();
  }catch(err){setNotice(err.message||String(err))}finally{setBusy(false)}
 }
 async function toggle(p){setBusy(true);const {error}=await client.from('products').update({menu_active:!p.menu_active}).eq('id',p.id).eq('store_id',storeId);setBusy(false);setNotice(error?.message||'Disponibilidade atualizada.');if(!error)onRefresh?.()}

 return <section className="menu-studio">
 <div className="page-intro"><div><span className="eyebrow">MEU CARDÁPIO</span><h3>Editor de cardápio</h3><p>Gerencie produtos e veja as alterações no cardápio do cliente enquanto edita.</p></div><button type="button" className="secondary" onClick={onImport}>Importar cardápio</button></div>
 <div className="catalog-studio-tabs" role="tablist" aria-label="Gestão do cardápio">
 {['Produtos','Complementos','Banners','Estoque','Insumos'].map(t=><button role="tab" aria-selected={section===t}
  type="button" key={t} className={section===t?'active':'secondary'} onClick={()=>{setSection(t);setShowEditor(false);setNotice('')}}>{t}</button>)}
 </div>
 {notice&&!showEditor&&<p className="notice" role="status">{notice}</p>}
 {section==='Complementos'&&<CentralComplementLibrary client={client} storeId={storeId} products={products} onChanged={onRefresh}/>}
 {section==='Banners'&&(store?<StoreDesignStudio key={storeId+'-banners'} client={client} store={store} manager={manager}
  products={products} focus="banners"/>:<p role="alert">Não foi possível identificar a loja para abrir os banners.</p>)}
 {section==='Estoque'&&<>
   <CatalogFinishedStock client={client} storeId={storeId} products={products} manager={manager}/>
   <div className="catalog-inventory-wrap"><h3>Movimentações e insumos vinculados</h3>
    <Inventory client={client} storeId={storeId} manager={manager} products={products} initialView="Movimentações"/>
   </div>
 </>}
 {section==='Insumos'&&<div className="catalog-inventory-wrap">
  <Inventory client={client} storeId={storeId} manager={manager} products={products} initialView="Insumos"/>
 </div>}
 {section==='Produtos'&&<><div className="menu-studio-list">
 <div className="panel" id="catalog-category-navigation"><h3>Categorias</h3><p className="hint">Organize as categorias pelas setas: a mesma ordem será usada no cardápio dos clientes. Para mudar o ícone, toque na engrenagem.</p>
 {categories.map(c=><div key={c} style={{display:'flex',gap:6,alignItems:'center',marginBottom:7}}>
  <button type="button" className={selectedCategory===c?'active':'secondary'} style={{flex:1,minWidth:0,display:'flex',alignItems:'center',gap:7,textAlign:'left'}} onClick={()=>setSelectedCategory(c)}>
   <CategoryIcon icon={c==='Todas'?'more':iconFor(c)} size={22}/>{c}
  </button>
  {c!=='Todas'&&<>
   <button type="button" className="secondary catalog-sort-arrow" disabled={busy||orderedCategories.indexOf(c)===0}
    aria-label={'Mover categoria '+c+' para cima'} title="Subir categoria" onClick={()=>moveCategory(c,-1)}>↑</button>
   <button type="button" className="secondary catalog-sort-arrow" disabled={busy||orderedCategories.indexOf(c)===orderedCategories.length-1}
    aria-label={'Mover categoria '+c+' para baixo'} title="Descer categoria" onClick={()=>moveCategory(c,1)}>↓</button>
   <button type="button" className="secondary catalog-sort-arrow" aria-label={'Configurar ícone da categoria '+c}
    title={'Configurar ícone de '+c} onClick={()=>setConfiguringCategory(prev=>prev===c?null:c)}>⚙</button>
  </>}
 </div>)}
 {configuringCategory&&categories.includes(configuringCategory)&&<div className="pitacco-category-settings">
  <h4>Ícone da categoria: {configuringCategory}</h4>
  <p>Escolha a imagem que aparecerá no cardápio dos clientes. A mudança é exclusiva desta loja.</p>
  {CATEGORY_ICON_GROUPS.map(group=><section key={group.name} aria-label={group.name}>
   <h4>{group.name}</h4><div className="pitacco-icon-picker">
    {group.icons.map(([key,label])=><button key={key} type="button" className="pitacco-icon-choice"
      aria-label={label} aria-pressed={iconFor(configuringCategory)===key} disabled={iconBusy}
      onClick={()=>chooseCategoryIcon(configuringCategory,key)}>
     <CategoryIcon icon={key} size={39}/><small>{label}</small>
    </button>)}
   </div>
  </section>)}
 </div>}
 </div>
 <div className="panel catalog-product-panel"><div className="line"><h3>Produtos</h3><button type="button" onClick={()=>begin(null)}>+ Novo produto</button></div>
 <p className="hint">Use ↑ e ↓ para colocar os produtos na ordem desejada dentro de cada categoria. Ex.: Açaí 400 ml pode ficar primeiro, independente do nome.</p>
 <input aria-label="Buscar produto" placeholder="Buscar produtos..." value={filter} onChange={e=>setFilter(e.target.value)}/>
 <div className="catalog-card-grid">
 {filtered.map(p=><article className="catalog-product-card" key={p.id}>
  <div className="catalog-product-cover">
   {p.image_url?<img src={p.image_url} alt={'Foto de '+p.name} loading="lazy"/>:<div className="catalog-product-photo-empty">📷 <small>Adicionar foto</small></div>}
   <span className={'catalog-availability '+(p.menu_active===false?'inactive':'')}>{p.menu_active===false?'Inativo':'Ativo'}</span>
  </div>
  <div className="catalog-product-caption"><b>{p.name}</b><small>{p.category||'Sem categoria'}</small><strong>{brl(p.price)}</strong></div>
  <div className="catalog-card-actions">
   <button type="button" className="secondary catalog-sort-arrow" disabled={busy||orderedProducts.filter(x=>categoryName(x.category)===categoryName(p.category))[0]?.id===p.id}
    title="Subir produto" aria-label={'Mover produto '+p.name+' para cima'} onClick={()=>moveProduct(p,-1)}>↑</button>
   <button type="button" className="secondary catalog-sort-arrow" disabled={busy||orderedProducts.filter(x=>categoryName(x.category)===categoryName(p.category)).at(-1)?.id===p.id}
    title="Descer produto" aria-label={'Mover produto '+p.name+' para baixo'} onClick={()=>moveProduct(p,1)}>↓</button>
   <button type="button" className="secondary" aria-label="Editar" onClick={()=>begin(p)}>✎ Editar</button>
   <button type="button" className="secondary" disabled={busy} onClick={()=>toggle(p)}>{p.menu_active===false?'Ativar':'Desativar'}</button>
  </div>
 </article>)}
 </div>{!filtered.length&&<p>Nenhum produto nesta categoria.</p>}</div>
 </div>
 {showEditor&&<div style={{position:'fixed',inset:0,zIndex:90,background:'rgba(0,0,0,.5)',display:'flex',justifyContent:'flex-end'}}>
 <div style={{background:'var(--background,#fff)',color:'var(--foreground,#222)',height:'100%',width:'min(1100px,100%)',overflowY:'auto',padding:22,boxSizing:'border-box'}}>
 <div className="line"><h3>{editing?'Editar produto':'Novo produto'}</h3><button type="button" className="secondary" onClick={()=>setShowEditor(false)}>Fechar</button></div>
 {notice&&<p className="notice" role="status">{notice}</p>}
 <div className="menu-studio-editor">
 <div><form onSubmit={save} aria-label="Dados do produto">
 <label style={field}>Foto do produto (JPG, PNG, WebP)<input type="file" accept="image/png,image/jpeg,image/webp" onChange={e=>{const f=e.target.files?.[0];if(f&&f.size>5*1024*1024){setNotice('Imagem maior que 5 MB.');return}setPhoto(f||null)}}/></label>
 <label style={field}>Nome<input required maxLength={180} value={draft.name} onChange={e=>change('name',e.target.value)}/></label>
 <label style={field}>Descrição<textarea maxLength={1200} rows={3} value={draft.description} onChange={e=>change('description',e.target.value)}/></label>
 <label style={field}>Categoria<input value={draft.category} onChange={e=>change('category',e.target.value)} list="catalog-categories"/><datalist id="catalog-categories">{categories.filter(x=>x!=='Todas').map(x=><option key={x} value={x}/>)}</datalist></label>
 <label style={field}>Status no delivery<select value={String(draft.menu_active)} onChange={e=>change('menu_active',e.target.value==='true')}><option value="true">Ativo</option><option value="false">Inativo</option></select></label>
 <label style={field}>Preço (R$)<input type="number" min="0" step="0.01" required value={draft.price} onChange={e=>change('price',e.target.value)}/></label>
 <label style={field}>Custo interno (R$)<input type="number" min="0" step="0.01" value={draft.cost} onChange={e=>change('cost',e.target.value)}/></label>
 <div className="quick-actions"><button type="button" className="secondary" onClick={()=>setShowEditor(false)}>Cancelar</button><button disabled={busy} type="submit">Salvar produto</button></div>
 </form>
 {editing?<ProductComplements key={editing} client={client} storeId={storeId} product={{id:editing,name:draft.name}}
  onGroupsChange={setGroups}/>:<p className="hint">Salve o produto para cadastrar os complementos.</p>}
 </div>
 <aside className="panel" style={{position:'sticky',top:0}}><span className="eyebrow">PRÉVIA AUTOMÁTICA · CLIENTE FINAL</span><div style={{border:'1px solid #ddd',borderRadius:18,overflow:'hidden',background:'white',color:'#222',marginTop:12}}>{(previewUrl||draft.image_url)?<img src={previewUrl||draft.image_url} alt="Foto selecionada" style={{width:'100%',height:230,objectFit:'contain',background:'#faf4fa'}}/>:<div style={{height:150,background:'#f0f1f3',display:'grid',placeItems:'center'}}>Foto do produto</div>}<div style={{padding:14}}><small>{draft.category||'Categoria'}</small><h3>{draft.name||'Nome do produto'}</h3><p>{draft.description||'Descrição do produto'}</p><h3>{brl(draft.price)}</h3>{groups.map((g,i)=><div key={i} style={{borderTop:'1px solid #eee',paddingTop:10,marginTop:10}}><b>{g.name}</b><small style={{display:'block'}}>Escolha {g.min} a {g.max} · {g.min>0?'Obrigatório':'Opcional'}</small>{g.options.filter(o=>o.available).map((o,j)=><p key={j} style={{margin:'7px 0'}}>◯ {o.name} · {brl(o.price)}</p>)}</div>)}<button type="button" disabled style={{width:'100%',marginTop:12}}>Adicionar ao pedido</button></div></div><p className="hint">Prévia ilustrativa em tempo real, sem publicação automática.</p></aside>
 </div></div></div>}
 </>}
 </section>;
}
