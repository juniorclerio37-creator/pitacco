import React,{useEffect,useState} from 'react';
const keys=[['name','Nome da loja'],['description','Descrição'],['phone','Telefone'],['address','Rua / avenida'],['address_number','Número'],['neighborhood','Bairro'],['city','Cidade'],['state','Estado'],['postal_code','CEP']];
export async function uploadStoreImage(client,storeId,file,kind){
 if(!storeId||!['stores','products'].includes(kind))throw Error('Loja ou tipo de imagem inválido.');
 if(!file||!['image/jpeg','image/png','image/webp'].includes(file.type)||file.size>5*1024*1024)throw Error('Escolha JPG, PNG ou WebP de até 5 MB.');
 const ext={'image/jpeg':'jpg','image/png':'png','image/webp':'webp'}[file.type];
 const path=kind+'/'+storeId+'/'+crypto.randomUUID()+'.'+ext;
 const {error}=await client.storage.from('pitacco-media').upload(path,file,{contentType:file.type,upsert:false});
 if(error)throw error;
 return path;
}
export function mediaUrl(client,path){
 if(!path)return '';
 return client.storage.from('pitacco-media').getPublicUrl(path).data.publicUrl;
}
export default function StoreProfile({client,store,manager,onSaved}){
 const [draft,setDraft]=useState({}),[logo,setLogo]=useState(null),[preview,setPreview]=useState(''),[busy,setBusy]=useState(false),[message,setMessage]=useState('');
 useEffect(()=>{setDraft(Object.fromEntries(keys.map(([k])=>[k,store?.[k]||''])));setLogo(null)},[store?.id]);
 useEffect(()=>{if(!logo){setPreview('');return}const url=URL.createObjectURL(logo);setPreview(url);return()=>URL.revokeObjectURL(url)},[logo]);
 async function save(e){
  e.preventDefault();if(!manager)return;setBusy(true);setMessage('');
  try{
   if(!draft.name?.trim())throw Error('Informe o nome da loja.');
   const row={...draft,name:draft.name.trim(),updated_at:new Date().toISOString()};
   if(logo)row.logo_path=await uploadStoreImage(client,store.id,logo,'stores');
   const {data,error}=await client.from('stores').update(row).eq('id',store.id).select('id').single();
   if(error)throw error;if(data.id!==store.id)throw Error('Loja incorreta.');
   setLogo(null);setMessage('Dados da sua loja atualizados.');onSaved?.();
  }catch(err){setMessage(err.message||String(err))}finally{setBusy(false)}
 }
 return <section className="panel"><h3>Administrar Loja · Dados e identidade</h3><p>Personalização exclusiva de {store?.name}. As alterações não afetam outros estabelecimentos.</p>
 <form onSubmit={save}><div style={{display:'flex',alignItems:'center',gap:16,marginBottom:16}}>{(preview||store.logo_path)&&<img src={preview||mediaUrl(client,store.logo_path)} alt="Logotipo da loja" style={{width:90,height:90,objectFit:'contain',borderRadius:12}}/>}<label>Logotipo da loja<input type="file" accept="image/png,image/jpeg,image/webp" disabled={!manager} onChange={e=>setLogo(e.target.files?.[0]||null)}/></label></div>
 <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(220px,1fr))',gap:12}}>{keys.map(([key,label])=><label key={key} className="field">{label}<input value={draft[key]||''} required={key==='name'} maxLength={key==='description'?1500:180} disabled={!manager} onChange={e=>setDraft(p=>({...p,[key]:e.target.value}))}/></label>)}</div>
 {message&&<p role="status" className="notice">{message}</p>}
 <button disabled={busy||!manager} type="submit">Salvar alterações da loja</button></form></section>;
}
