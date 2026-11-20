import React,{useEffect,useRef,useState} from 'react';
import {mountStorePointPicker,currentDeviceLocation} from './deliveryMap.mjs';
import {locateStoreByAddress} from './mapOrigin.mjs';
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

const storeAddressFields=['address','address_number','neighborhood','city','state','postal_code'];
const pointFromStore=store=>{
 if(store?.latitude==null||store?.longitude==null)return null;
 const lat=Number(store.latitude),lng=Number(store.longitude);
 return Number.isFinite(lat)&&Number.isFinite(lng)&&Math.abs(lat)<=90&&Math.abs(lng)<=180
  ? [lat,lng] : null;
};
function StorePointPicker({client,store,manager,addressDirty,onSaved}){
 const initial=pointFromStore(store);
 const [point,setPoint]=useState(initial),[picked,setPicked]=useState(initial);
 const [suggestedPoint,setSuggestedPoint]=useState(null);
 const [needsDeviceAdjustment,setNeedsDeviceAdjustment]=useState(false);
 const [viewCenter,setViewCenter]=useState(null);
 const [busy,setBusy]=useState(false),[message,setMessage]=useState(''),[error,setError]=useState('');
 const [retryAttempt,setRetryAttempt]=useState(0);
 const mapEl=useRef(null),map=useRef(null),automaticLookup=useRef(null);
 const retryTimer=useRef(null),selectionVersion=useRef(0);
 const addressSignature=[store?.id,store?.address,store?.address_number,store?.neighborhood,
   store?.city,store?.state,store?.postal_code].map(x=>String(x||'').trim()).join('|');
 const currentAddressRef=useRef(addressSignature);
 currentAddressRef.current=addressSignature;
 const savedAddress=Boolean(store?.address?.trim()&&store?.city?.trim()&&store?.state?.trim());
 useEffect(()=>{
  const p=pointFromStore(store);
  setPoint(p);setSuggestedPoint(null);setNeedsDeviceAdjustment(false);
  // A background lookup must not override an unsaved manual correction.
  if(selectionVersion.current===0)setPicked(p);
  setMessage('');setError('');
 },[store?.id,store?.latitude,store?.longitude]);
 useEffect(()=>{
  // A new address begins a new automatic attempt; any previous retry belongs
  // to the old address and must not move the marker to an outdated location.
  if(retryTimer.current)clearTimeout(retryTimer.current);
  retryTimer.current=null;
  automaticLookup.current=null;
  selectionVersion.current=0;
  setNeedsDeviceAdjustment(false);
  setRetryAttempt(0);
 },[addressSignature]);
 useEffect(()=>()=>{if(retryTimer.current)clearTimeout(retryTimer.current)},[]);
 useEffect(()=>{
  if(!mapEl.current)return;
  let alive=true;
  mountStorePointPicker(mapEl.current,{
   center:point||suggestedPoint,viewCenter,
   onSelect:p=>{if(alive){selectionVersion.current++;setPicked(p);setNeedsDeviceAdjustment(false);setMessage('');setError('');}}
  }).then(instance=>{
   if(alive){map.current=instance;if(!point&&!suggestedPoint&&viewCenter)instance.focus(viewCenter,14);}
   else instance.remove();
  }).catch(err=>{if(alive)setError('O mapa não pôde ser aberto: '+err.message)});
  return()=>{alive=false;map.current?.remove();map.current=null};
 },[store?.id,Boolean(point),Boolean(suggestedPoint),Boolean(viewCenter)]);
 // Start near an authorized on-shift driver if address lookup is unavailable.
 // Never save the driver's coordinates as the shop by default.
 useEffect(()=>{
  if(point||!manager||!store?.id)return;
  let active=true;
  Promise.resolve(client.rpc('pitacco_store_courier_positions',{p_store:store.id}))
   .then(({data,error})=>{
    if(!active||error)return;
    const p=(data||[]).find(row=>row.latitude!=null&&row.longitude!=null&&
      Number.isFinite(Number(row.latitude))&&Number.isFinite(Number(row.longitude))&&
      Date.now()-Date.parse(row.observed_at)<5*60_000);
    if(p){
     const location=[Number(p.latitude),Number(p.longitude)];
     setViewCenter(location);
     map.current?.focus(location,14);
    }
   }).catch(()=>{});
  return()=>{active=false};
 },[client,store?.id,Boolean(point),manager]);
 async function locate({automatic=false}={}){
  const requestedAddress=addressSignature;
  const pickedBefore=selectionVersion.current;
  setBusy(true);setMessage('');setError('');
  try{
   if(addressDirty)throw Error('Salve primeiro o endereço atualizado da loja.');
   if(!savedAddress)throw Error('Cadastre rua, cidade e estado antes de localizar a loja.');
   const {point:p,approximate}=await locateStoreByAddress(client,store.id);
   // Ignore slow responses for a store/address no longer shown.
   if(requestedAddress!==currentAddressRef.current)return;
   if(approximate){
    // Never let an asynchronous lookup replace a GPS or manually selected
    // point, particularly on browsers with slower device geolocation.
    if(selectionVersion.current===pickedBefore){
     setSuggestedPoint(p);
     setPicked(p);map.current?.setPoint(p);
     setMessage('O mapa encontrou apenas uma posição estimada. Confira a entrada da loja e clique em "Salvar ponto da loja" para confirmar.');
    }
   }else{
    setPoint(p);setSuggestedPoint(null);
    if(selectionVersion.current===pickedBefore){
     setPicked(p);map.current?.setPoint(p);
    }
    setMessage('A loja foi localizada automaticamente pelo endereço cadastrado.');
    onSaved?.();
   }
  }catch(err){
   const detail=err.message||String(err);
   const retry=automatic&&err.retryable===true&&retryAttempt<1;
   setError(retry
    ?'Não foi possível localizar o endereço agora. O Pitacco tentará novamente automaticamente.'
    :'Não conseguimos localizar sua loja com segurança: '+detail+
      ' Confira rua, número, cidade e CEP. Se necessário, ajuste o marcador no mapa.');
   if(retry&&!retryTimer.current){
    // A single delayed retry respects the public geocoding fallback and
    // avoids repeatedly querying the service on every React re-render.
    retryTimer.current=setTimeout(()=>{
     retryTimer.current=null;
     setRetryAttempt(n=>n+1);
    },Number(err.retryAfterMs)||75_000);
   }
  }finally{setBusy(false)}
 }
 // Map origin is computed as soon as a complete address is loaded or saved.
 // Merchants do not need to click a location button.
 useEffect(()=>{
  if(point||!manager||!savedAddress||addressDirty||!store?.id)return;
  const key=addressSignature+'|'+retryAttempt;
  if(automaticLookup.current===key)return;
  automaticLookup.current=key;
  void locate({automatic:true});
 },[store?.id,addressSignature,point,manager,savedAddress,addressDirty,retryAttempt]);
 async function locateByDevice(){
  setBusy(true);setMessage('');setError('');
  try{
   if(addressDirty)throw Error('Salve primeiro o endereço atualizado da loja.');
   if(!savedAddress)throw Error('Cadastre o endereço da loja antes de usar o GPS.');
   // The manager explicitly grants location permission in the browser.
   // GPS is a proposal, never an implicit update to the store database.
   const {point:p,accuracyMeters}=await currentDeviceLocation();
   selectionVersion.current++;
   const lowPrecision=accuracyMeters==null||accuracyMeters>250;
   setNeedsDeviceAdjustment(lowPrecision);
   setSuggestedPoint(p);setPicked(p);
   map.current?.setPoint(p);
   map.current?.focus(p,accuracyMeters!=null&&accuracyMeters<=100?17:accuracyMeters!=null&&accuracyMeters<=500?15:13);
   if(lowPrecision){
    setMessage('Localização aproximada deste dispositivo'+
      (accuracyMeters!=null?' (margem informada de '+accuracyMeters+' m)':'')+
      '. Confira no mapa e arraste a lojinha até a entrada real antes de salvar.');
   }else{
    setMessage('Localização do dispositivo encontrada'+
      (accuracyMeters!=null?' (precisão estimada de '+accuracyMeters+' m)':'')+
      '. Confirme o marcador na entrada da loja antes de salvar.');
   }
  }catch(err){
   setError('Não foi possível obter o GPS: '+(err.message||String(err))+
    ' Habilite a localização no celular ou computador e permita o acesso no navegador.');
  }finally{setBusy(false)}
 }
 async function savePoint(){
  setBusy(true);setMessage('');setError('');
  try{
   if(addressDirty)throw Error('Salve primeiro o endereço atualizado da loja.');
   if(!picked||picked.some(x=>!Number.isFinite(x)))throw Error('Selecione o ponto da loja no mapa.');
   if(needsDeviceAdjustment)throw Error('A localização fornecida pelo dispositivo é imprecisa. Arraste a lojinha até a entrada real e tente salvar novamente.');
   const {data,error}=await client.functions.invoke('delivery-quote',{
    body:{action:'store-point',store_id:store.id,latitude:picked[0],longitude:picked[1]}
   });
   if(error)throw error;
   if(!data?.saved)throw Error(data?.error||'A gravação do ponto não foi confirmada.');
   setPoint([...picked]);setSuggestedPoint(null);setNeedsDeviceAdjustment(false);
   setMessage('Ponto exato da loja salvo. O mapa da Roteirização utilizará este marcador.');
   onSaved?.();
  }catch(err){setError('Não foi possível salvar o ponto: '+(err.message||String(err)));}
  finally{setBusy(false)}
 }
 const changed=Boolean(picked&&(!point||Math.abs(point[0]-picked[0])>0.0000001||
  Math.abs(point[1]-picked[1])>0.0000001));
 return <div className="store-point-editor">
  <div className="store-point-editor-title"><strong>Posição exata da loja no mapa</strong>
   <small>Confirme a entrada do estabelecimento para centralizar entregas e motoboys.</small></div>
  {addressDirty&&<p role="status" className="store-point-warning">Salve as alterações do endereço acima antes de ajustar o marcador.</p>}
  <div ref={mapEl} className="store-point-map" aria-label="Mapa para marcar a entrada da loja"/>
  {!point&&<p className="store-point-warning">
    {busy?'Localizando a loja automaticamente pelo endereço cadastrado…':
      'O Pitacco posiciona sua loja automaticamente pelo endereço salvo. Se a busca falhar, verifique o endereço ou ajuste o ponto no mapa.'}
   </p>}
  <div className="store-point-actions">
   <button type="button" className="secondary"
    disabled={!manager||busy||addressDirty||!savedAddress}
    onClick={locateByDevice}>Usar localização do celular ou computador</button>
   {error&&<button type="button" className="secondary"
    disabled={!manager||busy||addressDirty||!savedAddress}
    onClick={()=>{if(retryTimer.current){clearTimeout(retryTimer.current);retryTimer.current=null}
     automaticLookup.current=null;void locate();}}>
    Tentar localizar novamente
   </button>}
   {picked&&<button type="button" disabled={!manager||busy||addressDirty||!changed} onClick={savePoint}>
     Salvar ponto da loja
   </button>}
  </div>
  <small>O endereço é pesquisado automaticamente. Se o resultado não for exato, use a localização do celular ou computador e confirme a entrada da loja no mapa. A localização do computador pode ser aproximada.</small>
  <small>Geocodificação quando habilitada: Powered by <a href="https://www.geoapify.com/" target="_blank" rel="noreferrer">Geoapify</a>.</small>
  {error&&<p role="alert" className="store-point-error">{error}</p>}
  {message&&<p role="status" className="store-point-success">{message}</p>}
 </div>;
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
   // Authorized for both store managers and platform administrators; direct
   // stores UPDATE is restricted by RLS for normal merchant accounts.
   const {error}=await client.rpc('pitacco_update_store_identity',{
    p_store_id:store.id,p_data:row,
   });
   if(error)throw error;
   setLogo(null);setMessage('Dados da sua loja atualizados.');onSaved?.();
  }catch(err){setMessage(err.message||String(err))}finally{setBusy(false)}
 }
 const addressDirty=storeAddressFields.some(key=>String(draft[key]||'').trim()!==String(store?.[key]||'').trim());
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
    <StorePointPicker client={client} store={store} manager={manager} addressDirty={addressDirty} onSaved={onSaved}/>
   </section>
   <div className="identity-save">{message&&<p role="status" className="notice">{message}</p>}
    <button type="submit" disabled={busy||!manager}>{busy?'Salvando…':'Salvar dados da loja'}</button></div>
  </form>
 </section><StoreReadiness client={client} storeId={store.id}/></>;
}
