import React,{useEffect,useState} from 'react';
import ProductComplements from './ProductComplements.jsx';

const empty={name:'',category:'',description:'',price:'',cost:'',menu_active:false};

export default function OwnerCatalog({client,storeId}){
 const [products,setProducts]=useState(null),[draft,setDraft]=useState(null),[filter,setFilter]=useState('');
 const [selected,setSelected]=useState(null),[busy,setBusy]=useState(false);
 const [notice,setNotice]=useState(''),[error,setError]=useState('');
 async function rpc(name,args){
  const {data,error}=await client.rpc(name,{p_store_id:storeId,...args});
  if(error)throw error;
  return data;
 }
 useEffect(()=>{
  let active=true;
  rpc('pitacco_list_products').then(data=>{if(active)setProducts(data);}).catch(failure=>{if(active)setError(failure.message);});
  return()=>{active=false;};
 },[client,storeId]);

 async function commit(operation,success){
  setBusy(true);setNotice('');setError('');
  try{await operation();setNotice(success);}
  catch(failure){setError(failure.message||'Não foi possível concluir a alteração.');}
  finally{setBusy(false);}
 }
 function saveProduct(event){
  event.preventDefault();
  commit(async()=>{
   await rpc('pitacco_save_product',{
    p_product_id:draft.id||null,p_name:draft.name.trim(),p_category:(draft.category||'').trim(),
    p_description:(draft.description||'').trim(),p_price:Number(draft.price),p_cost:Number(draft.cost||0),
    p_menu_active:draft.menu_active
   });
   setDraft(null);
   setProducts(await rpc('pitacco_list_products'));
  },'Produto salvo.');
 }

 return <section className="panel" aria-label="Catálogo do estabelecimento" aria-busy={busy}>
  <h3>Produtos da loja</h3>
  {error&&<p role="alert">{error}</p>}
  {notice&&<p role="status">{notice}</p>}
  {!products&&!error&&<p role="status">Carregando catálogo…</p>}
  {products&&<>
   <label>Buscar produto <input type="search" value={filter} onChange={event=>setFilter(event.target.value)}/></label>
   <button type="button" disabled={busy} onClick={()=>setDraft({...empty})}>Novo produto</button>
   <ul>{products.filter(product=>[product.name,product.category].some(value=>value?.toLowerCase().includes(filter.trim().toLowerCase()))).map(product=>
    <li className="line" key={product.id}>
     <div><strong>{product.name}</strong><small> · {product.category||'Sem categoria'} · {product.menu_active?'Publicado':'Oculto'}</small></div>
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
   <label><input type="checkbox" checked={draft.menu_active} onChange={event=>setDraft({...draft,menu_active:event.target.checked})}/> Publicar no cardápio</label>
   <button disabled={busy}>Salvar produto</button>
   <button type="button" className="secondary" disabled={busy} onClick={()=>setDraft(null)}>Cancelar edição</button>
  </form>}
  {selected&&<ProductComplements key={selected.id} client={client} storeId={storeId} product={selected} onClose={()=>setSelected(null)}/>}
 </section>;
}
