import React,{useEffect,useMemo,useState} from 'react';
import {CategoryIcon,CATEGORY_ICON_GROUPS,CATEGORY_ICON_KEYS,inferCategoryIcon} from './CategoryIcons.jsx';
import ProductComplements from './ProductComplements.jsx';

const empty={name:'',category:'',description:'',price:'',cost:'',menu_active:false,sealed_industrial_beverage:false};

export default function OwnerCatalog({client,storeId}){
 const [products,setProducts]=useState(null),[draft,setDraft]=useState(null),[filter,setFilter]=useState('');
 const [selected,setSelected]=useState(null),[busy,setBusy]=useState(false);
 const [notice,setNotice]=useState(''),[error,setError]=useState('');
 const [categoryIcons,setCategoryIcons]=useState({}),[iconBusy,setIconBusy]=useState(false);
 const categories=useMemo(()=>[...new Set((products||[]).map(p=>p.category?.trim()).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'pt-BR')),[products]);
 const iconFor=c=>CATEGORY_ICON_KEYS.includes(categoryIcons[c])?categoryIcons[c]:inferCategoryIcon(c);
 async function rpc(name,args){
  const {data,error}=await client.rpc(name,{p_store_id:storeId,...args});
  if(error)throw error;
  return data;
 }
 useEffect(()=>{
  let active=true;
  rpc('pitacco_list_products_with_beverage').then(data=>{if(active)setProducts(data);}).catch(failure=>{if(active)setError(failure.message);});
  return()=>{active=false;};
 },[client,storeId]);

 useEffect(()=>{
  let active=true;
  client.rpc('pitacco_menu_category_icons_state',{p_store:storeId}).then(({data,error})=>{
   if(!active)return;
   if(error){setError('Não foi possível carregar os ícones: '+error.message);return;}
   setCategoryIcons(data&&typeof data==='object'&&!Array.isArray(data)?data:{});
  }).catch(err=>{if(active)setError('Não foi possível carregar os ícones: '+(err?.message||'falha de conexão'))});
  return()=>{active=false};
 },[client,storeId]);
 async function saveCategoryIcon(category,icon){
  if(iconBusy||!CATEGORY_ICON_KEYS.includes(icon))return;
  setIconBusy(true);setError('');setNotice('');
  try{
   const {data,error}=await client.rpc('pitacco_menu_category_set_icon',{p_store:storeId,p_category:category,p_icon:icon});
   if(error)throw error;
   if(!data?.saved)throw Error('O servidor não confirmou a alteração.');
   setCategoryIcons(old=>({...old,[category]:icon}));
   setNotice('Ícone da categoria '+category+' atualizado no cardápio.');
  }catch(err){setError('Não foi possível salvar o ícone: '+(err?.message||'falha de conexão'))}
  finally{setIconBusy(false)}
 }
 async function commit(operation,success){
  setBusy(true);setNotice('');setError('');
  try{await operation();setNotice(success);}
  catch(failure){setError(failure.message||'Não foi possível concluir a alteração.');}
  finally{setBusy(false);}
 }
 function saveProduct(event){
  event.preventDefault();
  commit(async()=>{
   await rpc('pitacco_save_product_with_beverage',{
    p_product_id:draft.id||null,p_name:draft.name.trim(),p_category:(draft.category||'').trim(),
    p_description:(draft.description||'').trim(),p_price:Number(draft.price),p_cost:Number(draft.cost||0),
    p_menu_active:draft.menu_active,p_sealed_beverage:!!draft.sealed_industrial_beverage
   });
   setDraft(null);
   setProducts(await rpc('pitacco_list_products_with_beverage'));
  },'Produto salvo.');
 }

 return <section className="panel" aria-label="Catálogo do estabelecimento" aria-busy={busy}>
  <h3>Produtos da loja</h3>
  {error&&<p role="alert">{error}</p>}
  {notice&&<p role="status">{notice}</p>}
  {!products&&!error&&<p role="status">Carregando catálogo…</p>}
  {products&&<>
   <div className="panel" aria-label="Ícones das categorias">
    <h3>Ícones de categorias do cardápio</h3>
    <p>Toque na categoria para escolher seu ícone. Destaques usa o foguinho animado. A escolha vale somente para esta loja.</p>
    {categories.map(category=><details key={category} className="pitacco-category-settings">
     <summary><CategoryIcon icon={iconFor(category)} size={26}/>{category} — configurar ícone</summary>
     {CATEGORY_ICON_GROUPS.map(group=><section key={group.name} aria-label={group.name}>
      <h4>{group.name}</h4>
      <div className="pitacco-icon-picker">
       {group.icons.map(([key,label])=><button type="button" key={key} className="pitacco-icon-choice"
        disabled={iconBusy} aria-pressed={iconFor(category)===key} aria-label={label}
        onClick={()=>saveCategoryIcon(category,key)}>
        <CategoryIcon icon={key} size={39}/><small>{label}</small>
       </button>)}
      </div>
     </section>)}
    </details>)}
    {!categories.length&&<p>Cadastre um produto com categoria para escolher o ícone.</p>}
   </div>
   <label>Buscar produto <input type="search" value={filter} onChange={event=>setFilter(event.target.value)}/></label>
   <button type="button" disabled={busy} onClick={()=>setDraft({...empty})}>Novo produto</button>
   <ul>{products.filter(product=>[product.name,product.category].some(value=>value?.toLowerCase().includes(filter.trim().toLowerCase()))).map(product=>
    <li className="line" key={product.id}>
     <div><strong>{product.name}</strong><small> · {product.category||'Sem categoria'} · {product.menu_active?'Publicado':'Oculto'}{product.sealed_industrial_beverage?' · Bebida lacrada retornável':''}</small></div>
     <button type="button" className="secondary" disabled={busy} onClick={()=>setDraft({...product})}>Editar {product.name}</button>
     <button type="button" className="secondary" disabled={busy} onClick={()=>{setSelected({...product});}}>Complementos de {product.name}</button>
    </li>)}</ul>
  </>}
  {draft&&<form onSubmit={saveProduct} aria-label="Editar produto">
   <label>Nome do produto <input required minLength={2} maxLength={120} value={draft.name} onChange={event=>setDraft({...draft,name:event.target.value})}/></label>
   <label>Categoria <input maxLength={80} value={draft.category||''} onChange={event=>setDraft({...draft,category:event.target.value})}/></label>
   <label>Descrição <textarea maxLength={1000} value={draft.description||''} onChange={event=>setDraft({...draft,description:event.target.value})}/></label>
   <label>Preço <input type="number" required min={0} max={100000} step=".01" value={draft.price} onChange={event=>setDraft({...draft,price:event.target.value})}/></label>
   <label>Custo interno <input type="number" min={0} max={100000} step=".01" value={draft.cost} onChange={event=>setDraft({...draft,cost:event.target.value})}/></label>
   <label><input type="checkbox" checked={!!draft.sealed_industrial_beverage}
     onChange={event=>setDraft({...draft,sealed_industrial_beverage:event.target.checked})}/>
     Bebida industrializada e lacrada (pode voltar ao estoque quando recuperada)</label>
   <p>Marque apenas para bebidas prontas, fechadas de fábrica e aptas à revenda.
     Bebidas abertas, sucos preparados na hora e alimentos não devem receber essa marcação.
     O retorno nunca é automático: exige cancelamento e conferência física pela loja.
     Cadastre a bebida e sua quantidade na ficha técnica do Estoque.</p>
   <label><input type="checkbox" checked={draft.menu_active}
     onChange={event=>setDraft({...draft,menu_active:event.target.checked})}/> Publicar no cardápio</label>
   <button disabled={busy}>Salvar produto</button>
   <button type="button" className="secondary" disabled={busy} onClick={()=>setDraft(null)}>Cancelar edição</button>
  </form>}
  {selected&&<ProductComplements key={selected.id} client={client} storeId={storeId} product={selected} onClose={()=>setSelected(null)}/>}
 </section>;
}
