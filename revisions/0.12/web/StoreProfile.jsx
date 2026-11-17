import React,{useEffect,useState} from 'react';
import {StoreReadiness} from './StoreReadiness.jsx';
import './store-profile-modern.css';
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
export default function StoreProfile({client,store,manager,onSaved,onAppearance}){
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
 const change=(key,value)=>setDraft(p=>({...p,[key]:value}));
 const input=(key,label)=><label key={key} className="identity-field">{label}
  {key==='description'?<textarea maxLength={1500} rows={3} value={draft[key]||''} disabled={!manager}
    onChange={e=>change(key,e.target.value)} placeholder="Conte aos clientes sobre seu estabelecimento"/>
   :<input value={draft[key]||''} required={key==='name'} maxLength={key==='name'?100:180}
     disabled={!manager} onChange={e=>change(key,e.target.value)}/>}
 </label>;
 return <><section className="identity-modern" aria-label="Dados e identidade da loja">
  <div className="identity-head">
   <div><span className="eyebrow">ADMINISTRAR LOJA</span><h3>Dados e identidade</h3>
    <p>Informações oficiais do estabelecimento. A aparência do cardápio fica no Estúdio de Cardápio.</p></div>
   <button type="button" className="secondary" onClick={onAppearance}>Abrir Estúdio de Cardápio</button>
  </div>
  <form onSubmit={save} className="identity-form">
   <section className="identity-section">
    <h4>Marca do estabelecimento</h4>
    <div className="identity-brand">
     <div className="identity-avatar">{(preview||store.logo_path)?
      <img src={preview||mediaUrl(client,store.logo_path)} alt="Logotipo da loja"/>
      :<strong>{(store.name||'L').slice(0,1).toUpperCase()}</strong>}</div>
     <div><strong>{store.name}</strong><small>Logotipo utilizado na identificação da loja</small>
      <label className="identity-file">Atualizar logotipo (JPG, PNG, WebP, até 5 MB)
       <input type="file" accept="image/png,image/jpeg,image/webp" disabled={!manager}
        onChange={e=>setLogo(e.target.files?.[0]||null)}/></label>
     </div>
    </div>
    <div className="identity-grid">{input('name','Nome da loja')}{input('phone','Telefone / WhatsApp')}
     <div className="identity-wide">{input('description','Descrição do estabelecimento')}</div></div>
   </section>
   <section className="identity-section">
    <h4>Endereço e ponto de partida</h4>
    <p>O endereço aqui cadastrado é a referência de saída para as entregas e para a área de atendimento. Não é necessário digitar coordenadas.</p>
    <div className="identity-grid">{input('address','Rua / avenida')}{input('address_number','Número')}
      {input('neighborhood','Bairro')}{input('city','Cidade')}{input('state','Estado')}{input('postal_code','CEP')}</div>
   </section>
   <div className="identity-save">{message&&<p role="status" className="notice">{message}</p>}
    <button type="submit" disabled={busy||!manager}>{busy?'Salvando…':'Salvar dados da loja'}</button></div>
  </form>
 </section><StoreReadiness client={client} storeId={store.id}/></>;
}
