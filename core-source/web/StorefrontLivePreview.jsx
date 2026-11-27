import React,{useEffect,useMemo,useRef,useState} from 'react';

const publicOrigin=import.meta.env.VITE_PITACCO_HOMOLOGACAO==='1'
 ? import.meta.env.VITE_PITACCO_HOMOLOG_SITE_ORIGIN||window.location.origin
 : 'https://pitacco.com.br';
const validSlug=value=>/^[a-z0-9][a-z0-9-]{2,59}$/.test(value||'');
const dataImage=value=>/^data:image\/(?:jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(value||'');
function toDataUrl(file){
 return new Promise((resolve,reject)=>{
  const reader=new FileReader();
  reader.onload=()=>resolve(typeof reader.result==='string'&&dataImage(reader.result)?reader.result:'');
  reader.onerror=()=>reject(new Error('Não foi possível preparar a imagem para a prévia.'));
  reader.readAsDataURL(file);
 });
}

/**
 * Uses the exact public cardápio renderer inside an isolated iframe.
 * Draft changes only live in the iframe's memory, never in database/API.
 * All write actions (orders/checkout) are forbidden by the public preview runtime.
 */
export default function StorefrontLivePreview({client,store,design,step,viewport,files={}}){
 const iframe=useRef(null),nonce=useRef(crypto.randomUUID());
 const [slug,setSlug]=useState(''),[ready,setReady]=useState(false),[error,setError]=useState('');
 const [pendingImages,setPendingImages]=useState({});
 const origin=useMemo(()=>new URL(publicOrigin,window.location.origin).origin,[]);
 const src=validSlug(slug)?origin+'/cardapio/?loja='+encodeURIComponent(slug)+'&pitacco_studio_preview='+encodeURIComponent(nonce.current):'';
 useEffect(()=>{
  let live=true;
  setReady(false);setSlug('');setError('');
  (async()=>{
   const result=await client.from('public_menu_settings').select('slug').eq('store_id',store.id).maybeSingle();
   const fallback=result.error||!result.data?.slug
     ? await client.rpc('pitacco_storefront_link',{p_store:store.id})
     : null;
   if(!live)return;
   const next=result.data?.slug||fallback?.data?.slug;
   if(validSlug(next))setSlug(next);
   else setError('Esta loja ainda não possui um link de cardápio válido. Configure o endereço do cardápio antes de visualizar.');
  })().catch(()=>{if(live)setError('Não foi possível localizar o endereço público do cardápio. Verifique a conexão e tente novamente.');});
  return()=>{live=false};
 },[client,store.id]);
 useEffect(()=>{
  let active=true;
  Promise.all(Object.entries(files).map(async([key,file])=>{
   try{return [key,await toDataUrl(file)]}
   catch{return [key,'']}
  })).then(rows=>{if(active)setPendingImages(Object.fromEntries(rows.filter(([,url])=>dataImage(url))))});
  return()=>{active=false};
 },[files]);
 useEffect(()=>{
  function message(event){
   if(event.origin!==origin||event.source!==iframe.current?.contentWindow)return;
   if(event.data?.nonce!==nonce.current)return;
   if(event.data?.type==='pitacco-studio-preview-ready'){setReady(true);setError('')}
   if(event.data?.type==='pitacco-studio-preview-error')setError('A prévia não conseguiu carregar o cardápio. A configuração não foi alterada.');
  }
  window.addEventListener('message',message);
  return()=>window.removeEventListener('message',message);
 },[origin]);
 useEffect(()=>{
  if(!ready||!iframe.current?.contentWindow||!design)return;
  const timer=setTimeout(()=>{
   iframe.current?.contentWindow?.postMessage({
    type:'pitacco-studio-preview-update',nonce:nonce.current,design,
    step,images:pendingImages
   },origin);
  },180);
  return()=>clearTimeout(timer);
 },[ready,origin,design,step,pendingImages]);
 useEffect(()=>{
  if(!src||ready)return;
  const timer=setTimeout(()=>setError(previous=>previous||'A prévia está indisponível neste momento. Abra o cardápio para conferir a versão publicada.'),12000);
  return()=>clearTimeout(timer);
 },[src,ready]);
 if(error&&!slug)return <p className="design-preview-message" role="status">{error}</p>;
 if(!src)return <p className="design-preview-message" role="status">Obtendo o cardápio da loja...</p>;
 return <>
  {!ready&&!error&&<p className="design-preview-message" role="status">Carregando o cardápio real...</p>}
  {error&&<p className="design-preview-message" role="alert">{error}</p>}
  <iframe ref={iframe} title="Prévia fiel do cardápio digital" src={src} sandbox="allow-scripts allow-same-origin"
    loading="eager" referrerPolicy="strict-origin-when-cross-origin"
    className="design-preview-iframe" />
  <a className="design-preview-open" target="_blank" rel="noreferrer" href={origin+'/'+encodeURIComponent(slug)}>Abrir o cardápio publicado</a>
  <small className="design-preview-note">Prévia isolada do mesmo cardápio que o cliente verá. Os rascunhos não são publicados e pedidos não podem ser enviados.</small>
 </>;
}
