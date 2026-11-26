import React,{useEffect,useRef,useState} from 'react';
import {postalDigits,formatPostal,lookupPostalAddress,mergePostalAddress} from './storePostalLookup.mjs';
import {Store,UserRound,Building2,MapPin,ShieldCheck,MessageCircle} from 'lucide-react';
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

export default function StoreProfile({client,store,manager,onSaved,onAppearance,storeLogoUrl=''}){
 const draftDirty=useRef(false);
 const [draft,setDraft]=useState({}),[busy,setBusy]=useState(false),[message,setMessage]=useState(''),[loaded,setLoaded]=useState(false),[loadError,setLoadError]=useState(''),[revision,refresh]=useState(0);
 const [cepState,setCepState]=useState('idle'),[cepNotice,setCepNotice]=useState('');
 const cepRequest=useRef({generation:0,timer:null,controller:null});
 function cancelCep(){const r=cepRequest.current;r.generation++;clearTimeout(r.timer);r.controller?.abort();r.controller=null;}
 function scheduleCep(value,original,immediate=false){
  cancelCep();const cep=postalDigits(value),r=cepRequest.current;
  if(cep.length!==8){setCepState('idle');setCepNotice(cep?'Informe os oito dígitos do CEP.':'');return;}
  const generation=r.generation,controller=new AbortController();r.controller=controller;
  setCepState('loading');setCepNotice('Buscando endereço pelo CEP…');
  r.timer=setTimeout(async()=>{
   try{
    const result=await lookupPostalAddress(cep,{signal:controller.signal});
    if(generation!==r.generation||controller.signal.aborted)return;
    setDraft(current=>mergePostalAddress(current,original,result,cep));
    setCepState('success');setCepNotice(result.address&&result.neighborhood?'Endereço localizado. Confira os dados e informe o número.':'CEP localizado. Complete os campos que não foram retornados.');
   }catch(error){if(generation!==r.generation||controller.signal.aborted)return;setCepState('error');setCepNotice((error?.message==='CEP não encontrado.'?'CEP não encontrado.':'Não foi possível consultar o CEP.')+' Preencha o endereço manualmente ou tente novamente.');}
  },immediate?0:350);
 }
 useEffect(()=>{setCepState('idle');setCepNotice('');return cancelCep},[client,store.id,revision]);
 const [logoUpdate,setLogoUpdate]=useState(null),[logoBusy,setLogoBusy]=useState(false),[logoMessage,setLogoMessage]=useState('');
 const logoUrl=logoUpdate?.storeId===store.id?mediaUrl(client,logoUpdate.path):(storeLogoUrl||mediaUrl(client,store.logo_path));
 async function changeLogo(file){
  if(!file||!manager||logoBusy)return;
  setLogoBusy(true);setLogoMessage('');
  try{
   const path=await uploadStoreImage(client,store.id,file,'stores');
   const {data,error}=await client.rpc('pitacco_save_store_logo',{p_store:store.id,p_path:path});
   if(error||!data?.saved)throw error||Error('A alteração do logotipo não foi confirmada.');
   setLogoUpdate({storeId:store.id,path:data.logo_path});
   setLogoMessage('Logotipo atualizado em toda a loja.');
   window.dispatchEvent(new Event('pitacco:store-identity'));
   onSaved?.();
  }catch(err){setLogoMessage(err.message||String(err))}finally{setLogoBusy(false)}
 }
 useEffect(()=>{
  let active=true,running=false,initialized=false;
  draftDirty.current=false;setLoaded(false);setLoadError('');setMessage('');setDraft({});
  async function refreshRegistration(){
   if(running||draftDirty.current)return;running=true;
   try{
    const {data,error}=await client.rpc('pitacco_store_registration',{p_store:store.id});
    if(!active||draftDirty.current)return;
    if(error||!data)throw Error('Não foi possível consultar os dados da loja.');
    setDraft(data);setLoaded(true);setLoadError('');initialized=true;
   }catch{if(active&&!initialized)setLoadError('Não foi possível consultar os dados da loja.')}
   finally{running=false}
  }
  const refreshVisible=()=>{if(document.visibilityState==='visible')void refreshRegistration()};
  void refreshRegistration();const timer=setInterval(refreshVisible,15000);
  window.addEventListener('focus',refreshVisible);
  window.addEventListener('pitacco:store-identity',refreshVisible);
  return()=>{active=false;clearInterval(timer);window.removeEventListener('focus',refreshVisible);window.removeEventListener('pitacco:store-identity',refreshVisible)};
 },[client,store.id,revision]);
 async function save(e){
  e.preventDefault();if(!manager||cepState==='loading')return;cancelCep();setBusy(true);setMessage('');
  try{
   if(!draft.name?.trim())throw Error('Informe o nome da loja.');
   const {document,person_type,legal_name,responsible_name,administrative_phone,administrative_email,whatsapp,name,description,address,address_number,address_complement,neighborhood,city,state,postal_code,instagram_url,facebook_url}=draft;
   const {data,error}=await client.rpc('pitacco_save_store_registration',{p_store:store.id,p_data:{document,person_type,legal_name,responsible_name,administrative_phone,administrative_email,whatsapp,name,description,address,address_number,address_complement,neighborhood,city,state,postal_code,instagram_url,facebook_url}});
   if(error||!data?.saved)throw error||Error('A gravação não foi confirmada.');
   draftDirty.current=false;setMessage('Dados da sua loja atualizados.');window.dispatchEvent(new Event('pitacco:store-identity'));onSaved?.();
  }catch(err){setMessage(err.message||String(err))}finally{setBusy(false)}
 }
 const addressDirty=storeAddressFields.some(key=>String(draft[key]||'').trim()!==String(store?.[key]||'').trim());
 const change=(key,value)=>{draftDirty.current=true;if(key==='postal_code'){const formatted=formatPostal(value);setDraft(p=>({...p,postal_code:formatted}));scheduleCep(formatted,draft);}else setDraft(p=>({...p,[key]:value}))};
 const input=(key,label,required=true,type='text')=><label key={key} className="identity-field"><span>{label}{required&&<span className="identity-required"> *</span>}</span>
  {key==='description'?<textarea maxLength={1500} rows={3} value={draft[key]||''} disabled={!manager||busy}
    onChange={e=>change(key,e.target.value)} placeholder="Conte aos clientes sobre seu estabelecimento"/>
   :<input type={type} value={draft[key]||''} required={required} maxLength={key==='postal_code'?9:key==='name'?100:key==='document'?18:180} inputMode={key==='postal_code'?'numeric':undefined}
     disabled={!manager||busy} autoComplete={key==='postal_code'?'postal-code':key==='document'?'off':undefined} readOnly={key==='document'&&Boolean(draft.payer_registered&&draft.document)} onChange={e=>change(key,e.target.value)}/>}
 </label>;
 if(!loaded)return <section className="identity-modern" aria-label="Dados e identidade da loja"><h3>Dados da loja</h3>{loadError?<><p role="alert">{loadError}</p><button type="button" onClick={()=>refresh(n=>n+1)}>Tentar novamente</button></>:<p role="status">Consultando cadastro…</p>}</section>;
 return <><section className="identity-modern" aria-label="Dados e identidade da loja">
  <div className="identity-head">
   <div><span className="eyebrow">ADMINISTRAR LOJA</span><h3>Dados da loja</h3>
    <p>Cadastro único do estabelecimento, utilizado nas entregas, pagamentos, cardápio e demais serviços do Pitacco.</p></div>
   {onAppearance&&<button type="button" className="secondary" onClick={onAppearance}>Abrir Estúdio de Cardápio</button>}
  </div>
  <form onSubmit={save} className="identity-form">
   <section className="identity-section">
    <h4>Marca do estabelecimento</h4>
    <div className="identity-brand">
     <div className="identity-avatar">{logoUrl?
      <img src={logoUrl} alt="Logotipo da loja"/>
      :<strong>{(store.name||'L').slice(0,1).toUpperCase()}</strong>}</div>
     <div><strong>{store.name}</strong><small>Logotipo utilizado na identificação da loja</small>
      <label className="identity-file">{logoBusy?'Enviando logotipo…':logoUrl?'Alterar logotipo':'Enviar logotipo'}<input aria-label="Enviar ou alterar logotipo da loja" type="file" accept="image/jpeg,image/png,image/webp" disabled={!manager||logoBusy} onChange={e=>{const file=e.target.files?.[0];e.target.value='';changeLogo(file)}}/></label>
      <small>JPG, PNG ou WebP, até 5 MB. A marca é compartilhada pelo ecossistema Pitacco.</small>
      {logoMessage&&<p role="status">{logoMessage}</p>}
     </div>
    </div>
    <div className="identity-grid">{input('name','Nome da loja')}<div className="identity-wide">{input('description','Descrição do estabelecimento',false)}</div></div>
   </section>
   <section className="identity-section"><h4><UserRound size={21}/> Tipo de cadastro</h4>
    <div className="identity-types">{[['cpf','Pessoa Física (CPF)',UserRound],['cnpj','Pessoa Jurídica (CNPJ)',Building2]].map(([kind,label,Icon])=><label key={kind} className={draft.person_type===kind?'selected':''}><input type="radio" name="person_type" required checked={draft.person_type===kind} disabled={!manager||busy||Boolean(draft.document&&draft.payer_registered)} onChange={()=>{change('person_type',kind);change('document','')}}/><Icon size={20}/>{label}</label>)}</div>
   </section>
   <section className="identity-section"><h4><Building2 size={21}/> {draft.person_type==='cnpj'?'Dados da empresa':'Dados do titular'}</h4>
    <div className="identity-grid">{draft.person_type==='cnpj'&&input('legal_name','Razão social')}{input('document',draft.person_type==='cnpj'?'CNPJ':'CPF')}{input('responsible_name',draft.person_type==='cnpj'?'Nome do responsável da loja':'Nome completo')}{input('administrative_phone','Telefone administrativo',true,'tel')}{input('administrative_email','E-mail administrativo',true,'email')}{input('whatsapp','WhatsApp para clientes',true,'tel')}</div>
    <p><MessageCircle size={16}/> O WhatsApp para clientes é público. O telefone e e-mail administrativos são utilizados no cadastro e nas cobranças.</p>
   </section>
   <section className="identity-section"><h4><MessageCircle size={21}/> Redes sociais da loja</h4><p>Os botões aparecem na página inicial do cardápio quando os links são preenchidos.</p><div className="identity-grid">{input('instagram_url','Instagram (link do perfil)',false,'url')}{input('facebook_url','Facebook (link da página)',false,'url')}</div></section>
   <section className="identity-section identity-address">
    <h4><MapPin size={21}/> Endereço da Loja</h4>
    <p>Este é o endereço único usado no mapa do entregador, cálculo de frete, pagamentos e demais serviços.</p>
    <div className="identity-grid"><div>{input('postal_code','CEP')}<button type="button" className="secondary" disabled={!manager||busy||cepState==='loading'||postalDigits(draft.postal_code).length!==8} onClick={()=>{draftDirty.current=true;scheduleCep(draft.postal_code,draft,true)}}>{cepState==='loading'?'Consultando CEP…':'Buscar endereço'}</button>{cepNotice&&<small role={cepState==='error'?'alert':'status'}>{cepNotice}</small>}</div>{input('address','Rua / avenida')}{input('address_number','Número')}{input('address_complement','Complemento',false)}
      {input('neighborhood','Bairro')}{input('city','Cidade')}{input('state','Estado')}</div>
    <StorePointPicker client={client} store={store} manager={manager} addressDirty={addressDirty} onSaved={onSaved}/>
   </section>
   <div className="identity-save">{message&&<p role="status" className="notice">{message}</p>}
    <small><ShieldCheck size={18}/> Os dados privados não aparecem no cardápio público.</small><button type="submit" disabled={busy||!manager||cepState==='loading'}>{busy?'Salvando…':'Salvar dados da loja'}</button></div>
  </form>
 </section><StoreReadiness client={client} storeId={store.id}/></>;
}
