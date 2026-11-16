import React,{useEffect,useState} from 'react';

export default function ProductComplements({client,storeId,product,onClose,onGroupsChange}){
 const [groups,setGroups]=useState(null),[busy,setBusy]=useState(false);
 const [notice,setNotice]=useState(''),[error,setError]=useState('');
 async function rpc(name,args){
  const {data,error}=await client.rpc(name,{p_store_id:storeId,...args});
  if(error)throw error;
  return data;
 }
 useEffect(()=>{
  let active=true;
  rpc('pitacco_list_complements',{p_product_id:product.id}).then(data=>{if(active){setGroups(data);onGroupsChange?.(data);}}).catch(failure=>{if(active)setError(failure.message);});
  return()=>{active=false;};
 },[client,storeId,product.id]);
 async function commit(operation,success){
  setBusy(true);setNotice('');setError('');
  try{await operation();setNotice(success);}
  catch(failure){setError(failure.message||'Não foi possível concluir a alteração.');}
  finally{setBusy(false);}
 }
 function saveGroup(event,id){
  event.preventDefault();
  const form=event.currentTarget, fields=new FormData(form);
  commit(async()=>{
   await rpc('pitacco_save_option_group',{
    p_product_id:product.id,p_group_id:id,p_name:String(fields.get('name')).trim(),
    p_min:Number(fields.get('min')),p_max:Number(fields.get('max'))
   });
   const updated=await rpc('pitacco_list_complements',{p_product_id:product.id});
   setGroups(updated);
   onGroupsChange?.(updated);
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
   const updated=await rpc('pitacco_list_complements',{p_product_id:product.id});
   setGroups(updated);
   onGroupsChange?.(updated);
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
  return <form className="complement-item" key={option?.id||'new'}
   aria-label={option?'Editar item '+option.name:'Novo item de '+group.name}
   onSubmit={event=>saveOption(event,group.id,option?.id||null)}>
   <label>Nome do item <input name="name" required maxLength={100} defaultValue={option?.name}/></label>
   <label>Preço adicional (R$) <input name="price" type="number" required min={0} max={100000} step=".01" defaultValue={option?.price??0}/></label>
   <label><input name="available" type="checkbox" defaultChecked={option?.available??true}/> Disponível</label>
   <button disabled={busy}>{option?'Salvar item':'Adicionar item'}</button>
  </form>;
 }

 return <section className="panel product-complements" aria-label="Grupos e complementos" aria-busy={busy}>
   <h3>Complementos de {product.name}</h3>
   {error&&<p role="alert">{error}</p>}
   {notice&&<p role="status">{notice}</p>}
   {onClose&&<button type="button" className="secondary" disabled={busy} onClick={onClose}>Fechar complementos</button>}
   {groups&&<>
    {groupForm(null)}
    {groups.map(group=><details key={group.id} open><summary>{group.name} · {group.min} a {group.max} escolhas</summary>
     {groupForm(group)}
     {group.options.map(option=>optionForm(group,option))}
     {optionForm(group,null)}
    </details>)}
   </>}
   {!groups&&!error&&<p role="status">Carregando complementos…</p>}
 </section>;
}
