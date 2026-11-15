import React,{useEffect,useState} from 'react';

const empty={name:'',category:'',description:'',price:'',cost:'',menu_active:false};

export default function OwnerCatalog({client,storeId}){
 const [products,setProducts]=useState(null),[draft,setDraft]=useState(null),[filter,setFilter]=useState('');
 const [selected,setSelected]=useState(null),[groups,setGroups]=useState(null),[busy,setBusy]=useState(false);
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
 useEffect(()=>{
  if(!selected)return;
  let active=true;
  rpc('pitacco_list_complements',{p_product_id:selected.id}).then(data=>{if(active)setGroups(data);}).catch(failure=>{if(active)setError(failure.message);});
  return()=>{active=false;};
 },[client,storeId,selected]);

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
 function saveGroup(event,id){
  event.preventDefault();
  const form=event.currentTarget, fields=new FormData(form);
  commit(async()=>{
   await rpc('pitacco_save_option_group',{
    p_product_id:selected.id,p_group_id:id,p_name:String(fields.get('name')).trim(),
    p_min:Number(fields.get('min')),p_max:Number(fields.get('max'))
   });
   setGroups(await rpc('pitacco_list_complements',{p_product_id:selected.id}));
   if(!id)form.reset();
  },'Grupo de complementos salvo.');
 }
 function saveOption(event,groupId,id){
  event.preventDefault();
  const form=event.currentTarget, fields=new FormData(form);
  commit(async()=>{
   await rpc('pitacco_save_option',{
    p_group_id:groupId,p_option_id:id,p_name:String(fields.get('name')).trim(),
    p_price:Number(fields.get('price')),p_available:fields.has('available')
   });
   setGroups(await rpc('pitacco_list_complements',{p_product_id:selected.id}));
   if(!id)form.reset();
  },'Complemento salvo.');
 }
 function groupForm(group){
  return <form onSubmit={event=>saveGroup(event,group?.id||null)}>
   <label>Nome do grupo <input name="name" required minLength={2} maxLength={100} defaultValue={group?.name}/></label>
   <label>Mínimo <input name="min" type="number" required min={0} max={100} defaultValue={group?.min??0}/></label>
   <label>Máximo <input name="max" type="number" required min={1} max={100} defaultValue={group?.max??1}/></label>
   <button disabled={busy}>{group?'Salvar grupo':'Adicionar grupo'}</button>
  </form>;
 }
 function optionForm(group,option){
  return <form key={option?.id||'new'} onSubmit={event=>saveOption(event,group.id,option?.id||null)}>
   <label>Nome do complemento <input name="name" required maxLength={100} defaultValue={option?.name}/></label>
   <label>Preço adicional <input name="price" type="number" required min={0} max={100000} step=".01" defaultValue={option?.price??0}/></label>
   <label><input name="available" type="checkbox" defaultChecked={option?.available??true}/> Disponível</label>
   <button disabled={busy}>{option?'Salvar complemento':'Adicionar complemento'}</button>
  </form>;
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
     <button type="button" className="secondary" disabled={busy} onClick={()=>{setGroups(null);setSelected({...product});}}>Complementos de {product.name}</button>
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
  {selected&&<section className="panel" aria-label="Grupos e complementos">
   <h3>Complementos de {selected.name}</h3>
   <button type="button" className="secondary" disabled={busy} onClick={()=>setSelected(null)}>Fechar complementos</button>
   {groups&&<>
    {groupForm(null)}
    {groups.map(group=><details key={group.id}><summary>{group.name} · {group.min} a {group.max} escolhas</summary>
     {groupForm(group)}
     {group.options.map(option=>optionForm(group,option))}
     {optionForm(group,null)}
    </details>)}
   </>}
   {!groups&&!error&&<p role="status">Carregando complementos…</p>}
  </section>}
 </section>;
}
