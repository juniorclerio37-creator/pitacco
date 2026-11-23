import React,{useEffect,useMemo,useState} from 'react';
import {uploadStoreImage,mediaUrl} from './StoreProfile.jsx';
import './store-design-studio.css';

const themes={
 moderno:{primary:'#e86b23',secondary:'#7b4e37',background:'#f9f5f1',paper:'#ffffff',foreground:'#30251f',hero:'#40221f',highlight:'#fff0e0'},
 premium:{primary:'#cba052',secondary:'#806c48',background:'#12141a',paper:'#22252e',foreground:'#faf4e9',hero:'#11141b',highlight:'#343026'},
 minimalista:{primary:'#247a5a',secondary:'#53756c',background:'#f1f5f1',paper:'#ffffff',foreground:'#22342c',hero:'#284c3c',highlight:'#e2f3e8'},
 colorido:{primary:'#bb368b',secondary:'#7742cf',background:'#fff4fb',paper:'#ffffff',foreground:'#37203a',hero:'#6b2f92',highlight:'#ffe0f4'}
};
const templates=[
 {id:'pitacco-v2',name:'Principal',description:'Roxo e laranja, fotos em grade e destaque para benefícios.',theme:'colorido',primary:'#ff7a08',secondary:'#6f4b80',background:'#faf7fd',paper:'#ffffff',foreground:'#261033',hero:'#4b075e',highlight:'#f4e5fb',layout:'grade',font:'sistema',radius:20},
 {id:'essencial',name:'Essencial',description:'Verde, espaços leves e produtos em uma lista compacta.',theme:'minimalista',primary:'#217c5a',secondary:'#53756c',background:'#f5f8f6',paper:'#ffffff',foreground:'#173a2d',hero:'#174c39',highlight:'#e5f2e9',layout:'lista',font:'sistema',radius:16},
 {id:'editorial',name:'Editorial',description:'Tons quentes, fotos amplas e tipografia elegante.',theme:'moderno',primary:'#bc5435',secondary:'#806551',background:'#fbf7f0',paper:'#ffffff',foreground:'#38271f',hero:'#41271f',highlight:'#f8ebdd',layout:'destaques',font:'serifada',radius:8},
 {id:'urbano',name:'Urbano',description:'Cabeçalho escuro, contraste marcante e catálogo em grade.',theme:'premium',primary:'#24364a',secondary:'#66778a',background:'#f4f6f8',paper:'#ffffff',foreground:'#172330',hero:'#172330',highlight:'#f3e7d3',layout:'grade',font:'sistema',radius:12}
];
const colors=[['primary','Principal'],['secondary','Secundária'],['background','Fundo'],['paper','Cartões'],['foreground','Textos'],['hero','Cabeçalho'],['highlight','Destaques']];
const layouts=[['lista','Lista organizada'],['grade','Grade de produtos'],['destaques','Cartões grandes']];
const fonts=[['sistema','Moderna'],['arredondada','Arredondada'],['serifada','Elegante']];
const photoSizes=[['pequeno','Pequena'],['medio','Média'],['grande','Grande']];
const field=(label,value,change,props={})=><label className="design-field">{label}<input value={value||''} onChange={event=>change(event.target.value)} {...props}/></label>;
const cash=value=>Number(value||0).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
const defaultDesign={template:'pitacco-v2',theme:'moderno',...themes.moderno,layout:'lista',radius:20,font:'sistema',photo_size:'medio',
 show_descriptions:true,slogan:'Cardápio digital',instagram:'',logo_path:'',cover_path:'',banners:[]};
const stamp=value=>value?new Date(value).toLocaleString('pt-BR',{dateStyle:'short',timeStyle:'short'}):'—';
const fontFace=font=>font==='serifada'?'Georgia,serif':font==='arredondada'?'Trebuchet MS,system-ui,sans-serif':'Inter,system-ui,sans-serif';
const ownDate=v=>v?new Date(v).toLocaleString('sv-SE',{year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'}).replace(' ','T'):'';
const dateValue=v=>v?new Date(v).toISOString():null;
function contrast(hex){
 const channels=[1,3,5].map(i=>parseInt(hex.slice(i,i+2),16)/255)
  .map(c=>c<=.04045?c/12.92:((c+.055)/1.055)**2.4);
 return channels.reduce((s,v,i)=>s+v*[.2126,.7152,.0722][i],0);
}
const isHex=value=>/^#[0-9a-fA-F]{6}$/.test(value||'');
function BannerImage({url,...props}){return url?<img src={url} alt="" {...props}/>:null;}

export default function StoreDesignStudio({client,store,manager,products=[]}){
 const [saved,setSaved]=useState(null),[design,setDesign]=useState(null),[version,setVersion]=useState(0);
 const [publishedVersion,setPublishedVersion]=useState(0),[history,setHistory]=useState([]),[publishedAt,setPublishedAt]=useState(null);
 const [mode,setMode]=useState('editar'),[viewport,setViewport]=useState('celular'),[previewStep,setPreviewStep]=useState('inicial');
 const [files,setFiles]=useState({}),[fileUrls,setFileUrls]=useState({});
 const [working,setWorking]=useState(false),[loading,setLoading]=useState(true),[notice,setNotice]=useState(''),[error,setError]=useState('');
 const [catalog,setCatalog]=useState(products.slice(0,8));
 const dirty=design&&saved?JSON.stringify(design)!==JSON.stringify(saved)||Object.keys(files).length>0:false;
 const photo=path=>path?mediaUrl(client,path):'';
 const imageFor=(key,path)=>fileUrls[key]||photo(path);
 const moneyColors={background:design?.background||'#fff',color:design?.foreground||'#222',fontFamily:fontFace(design?.font)};
 const onBrand=design?.primary&&isHex(design.primary)&&contrast(design.primary)>.179?'#221d1b':'#ffffff';

 useEffect(()=>{
  let alive=true;
  setLoading(true);setError('');setNotice('');
  client.rpc('pitacco_storefront_studio_state',{p_store:store.id}).then(({data,error})=>{
   if(error)throw error;
   if(!alive)return;
   const next={...defaultDesign,...data.draft,banners:data.draft?.banners||[]};
   setSaved(next);setDesign(structuredClone(next));setVersion(data.draft_version);
   setPublishedVersion(data.published_version);setHistory(data.history||[]);
   setPublishedAt(data.published_at);
  }).catch(e=>{if(alive)setError(e.message||'Não foi possível carregar o estúdio.')})
   .finally(()=>{if(alive)setLoading(false)});
  client.from('products').select('id,name,price,category,description,image_url').eq('store_id',store.id)
   .eq('menu_active',true).limit(8).then(({data})=>{if(alive&&data)setCatalog(data)}).catch(()=>{});
  return()=>{alive=false};
 },[client,store.id]);
 useEffect(()=>()=>Object.values(fileUrls).forEach(url=>URL.revokeObjectURL(url)),[fileUrls]);
 const update=(key,value)=>setDesign(d=>({...d,[key]:value}));
 const setBanner=(index,key,value)=>setDesign(d=>({...d,banners:d.banners.map((b,i)=>i===index?{...b,[key]:value}:b)}));
 function pickFile(key,file){
  if(!file)return;
  if(!['image/png','image/jpeg','image/webp'].includes(file.type)||file.size>5*1024*1024){
   setError('Use imagens JPG, PNG ou WebP de até 5 MB.');return;
  }
  setError('');
  setFiles(prev=>({...prev,[key]:file}));
  setFileUrls(prev=>({...prev,[key]:URL.createObjectURL(file)}));
 }
 function removeBanner(index){
  setDesign(d=>({...d,banners:d.banners.filter((_,i)=>i!==index)}));
  setFiles(prev=>{const next={};for(const [key,file] of Object.entries(prev)){
   if(!key.startsWith('banner-')){next[key]=file;continue}
   const i=Number(key.slice(7));if(i<index)next[key]=file;else if(i>index)next['banner-'+(i-1)]=file;
  }return next});
  setFileUrls(prev=>{const next={};for(const [key,url] of Object.entries(prev)){
   if(!key.startsWith('banner-')){next[key]=url;continue}
   const i=Number(key.slice(7));if(i<index)next[key]=url;else if(i>index)next['banner-'+(i-1)]=url;
  }return next});
 }
 function validate(d){
  if(!templates.some(t=>t.id===d.template))throw Error('Escolha um template disponível.');
  if(!isHex(d.primary)||!isHex(d.foreground)||!isHex(d.paper))throw Error('Confira as cores selecionadas.');
  if(!Number.isInteger(Number(d.radius))||Number(d.radius)<0||Number(d.radius)>32)throw Error('Arredondamento inválido.');
  if(d.instagram&&!/^@[A-Za-z0-9._]{1,30}$/.test(d.instagram))throw Error('Informe o Instagram com @ e o nome de usuário.');
  if(d.banners.some(b=>!b.title?.trim()||b.title.trim().length<2))throw Error('Todo banner precisa de um título.');
  return true;
 }
 async function saveDraft(){
  if(!manager||!design) return false;
  setWorking(true);setError('');setNotice('');
  try{
   const next=structuredClone(design);
   validate(next);
   for(const [key,file] of Object.entries(files)){
    const path=await uploadStoreImage(client,store.id,file,'stores');
    if(key==='logo')next.logo_path=path;
    else if(key==='cover')next.cover_path=path;
    else if(key.startsWith('banner-')){
     const index=Number(key.slice(7));
     if(next.banners[index])next.banners[index].image_path=path;
    }
   }
   const {data,error}=await client.rpc('pitacco_storefront_save_draft',{p_store:store.id,p_design:next,p_expected_version:version});
   if(error)throw error;
   if(!data?.saved)throw Error('O servidor não confirmou o rascunho.');
   setSaved(next);setDesign(structuredClone(next));setVersion(data.draft_version);
   setFiles({});setFileUrls({});
   setNotice('Rascunho salvo. O cardápio público ainda não foi alterado.');
   return true;
  }catch(e){setError(e.message||'Não foi possível salvar o rascunho.');return false}
  finally{setWorking(false)}
 }
 async function publish(){
  if(!manager||!design)return;
  if(dirty){setError('Salve o rascunho antes de publicar.');setMode('editar');return}
  if(!window.confirm('Publicar a nova aparência para todos os clientes desta loja?'))return;
  setWorking(true);setError('');setNotice('');
  try{
   const {data,error}=await client.rpc('pitacco_storefront_publish',{
    p_store:store.id,p_expected_draft:version,p_expected_published:publishedVersion});
   if(error)throw error;
   if(!data?.published)throw Error('O servidor não confirmou a publicação.');
   setPublishedVersion(data.published_version);setPublishedAt(new Date().toISOString());
   setHistory(items=>[{id:null,version:data.published_version,created_at:new Date().toISOString()},...items].slice(0,20));
   setNotice('Aparência publicada! O cardápio poderá levar alguns instantes para atualizar no navegador do cliente.');
  }catch(e){setError(e.message||'Não foi possível publicar.');}
  finally{setWorking(false)}
 }
 async function restore(revision){
  if(dirty){setError('Há alterações não salvas. Salve ou descarte antes de restaurar.');return}
  if(!window.confirm('Restaurar a versão '+revision+' como rascunho? A página pública não mudará até você publicar.'))return;
  setWorking(true);setError('');setNotice('');
  try{
   const {data,error}=await client.rpc('pitacco_storefront_restore_draft',{
    p_store:store.id,p_revision:revision,p_expected_draft:version});
   if(error)throw error;
   if(!data?.restored_to_draft)throw Error('A restauração não foi confirmada.');
   const state=await client.rpc('pitacco_storefront_studio_state',{p_store:store.id});
   if(state.error)throw state.error;
   const next={...defaultDesign,...state.data.draft};
   setDesign(structuredClone(next));setSaved(next);setVersion(state.data.draft_version);
   setMode('editar');setNotice('Versão '+revision+' restaurada como rascunho. Revise e publique quando desejar.');
  }catch(e){setError(e.message||'Não foi possível restaurar esta versão.')}
  finally{setWorking(false)}
 }
 const activeBanners=useMemo(()=>design?.banners?.filter(b=>{
  const now=Date.now();return (!b.starts_at||new Date(b.starts_at).getTime()<=now)
   &&(!b.ends_at||new Date(b.ends_at).getTime()>=now);
 })||[],[design?.banners]);
 const display=design&&<div className={'design-live-menu design-layout-'+design.layout+' design-template-'+design.template}
   style={{...moneyColors,'--studio-primary':design.primary,'--studio-secondary':design.secondary,
    '--studio-paper':design.paper,'--studio-highlight':design.highlight,
    '--studio-radius':design.radius+'px','--studio-on-brand':onBrand}}>
   <div className="design-live-hero" style={{background:design.hero,color:'#fff'}}>
    {imageFor('cover',design.cover_path)&&<BannerImage url={imageFor('cover',design.cover_path)} className="design-live-cover"/>}
    <div className="design-live-brand">{imageFor('logo',design.logo_path||store.logo_path)
      ?<BannerImage url={imageFor('logo',design.logo_path||store.logo_path)} className="design-live-logo"/>
      :<span className="design-live-initial">{store.name?.slice(0,1)}</span>}
     <div><strong>{store.name}</strong><small>{design.slogan||'Cardápio digital'}</small></div>
    </div>
   </div>
   {activeBanners.length>0&&<div className="design-live-banners">
    {activeBanners.slice(0,2).map((b,i)=><div key={i} className="design-live-promo" style={{background:design.highlight}}>
     {imageFor('banner-'+design.banners.indexOf(b),b.image_path)&&
      <BannerImage url={imageFor('banner-'+design.banners.indexOf(b),b.image_path)} />}
     <div><strong>{b.title}</strong><small>{b.subtitle}</small></div>
    </div>)}
   </div>}
   <div className="design-live-body">
    {previewStep==='inicial'&&<>
     <div className="design-live-toolbar"><strong>Nosso cardápio</strong><span>Buscar produtos</span></div>
     <div className="design-live-products">
      {catalog.slice(0,4).map(item=><div className="design-live-product" key={item.id}>
       <div className="design-live-copy"><strong>{item.name}</strong>
        {design.show_descriptions&&<small>{item.description||item.category||'Produto especial'}</small>}
        <b>{cash(item.price)}</b></div>
       <div className={'design-live-photo photo-'+design.photo_size}>{item.image_url
        ?<img src={item.image_url} alt=""/>:<span>🍽️</span>}</div>
      </div>)}
      {!catalog.length&&<div className="design-live-product"><div><strong>Seu primeiro produto</strong><small>Cadastre itens no Meu Cardápio para visualizar aqui.</small></div><b>—</b></div>}
     </div>
    </>}
    {previewStep==='produto'&&<div className="design-live-detail">
      <h3>{catalog[0]?.name||'Seu produto'}</h3>
      <p>{catalog[0]?.description||'Descrição e complementos do produto aparecerão aqui.'}</p>
      <strong>{catalog[0]?cash(catalog[0].price):'R$ 0,00'}</strong>
      <label>Complementos e opções</label><div className="design-live-skeleton">Escolha os complementos disponíveis</div>
      <button type="button" disabled>Adicionar ao pedido</button>
    </div>}
    {previewStep==='checkout'&&<div className="design-live-detail">
      <h3>Finalizar pedido</h3>
      <label>Seu nome</label><div className="design-live-skeleton">Nome do cliente</div>
      <label>Entrega ou retirada</label><div className="design-live-skeleton">Endereço e taxa de entrega</div>
      <label>Pagamento</label><div className="design-live-skeleton">Selecione a forma de pagamento</div>
      <button type="button" disabled>Confirmar pedido</button>
      <small>Prévia visual; nenhuma compra será realizada.</small>
    </div>}
   </div>
   {design.instagram&&<div className="design-live-footer">Instagram: {design.instagram}</div>}
   <div className="design-live-credit">Impulsionado por Pitacco</div>
  </div>;
 if(loading)return <div className="panel" role="status">Carregando Estúdio de Cardápio…</div>;
 if(!design)return <section className="panel"><h3>Estúdio de Cardápio</h3><p role="alert">{error||'Não foi possível carregar.'}</p><button onClick={()=>window.location.reload()}>Tentar novamente</button></section>;
 return <section className="design-studio" aria-label="Estúdio de Cardápio Pitacco">
  <div className="design-studio-heading"><div><span className="eyebrow">ADMINISTRAR LOJA · APARÊNCIA</span>
   <h3>Estúdio de Cardápio</h3><p>Personalize a identidade da sua loja. As alterações só chegam aos clientes depois de publicadas.</p></div>
   <div className="design-studio-status"><span>{dirty?'● Alterações não salvas':'✓ Rascunho atualizado'}</span>
    <small>{publishedVersion?'Versão '+publishedVersion+' publicada em '+stamp(publishedAt):'Nenhuma versão visual personalizada publicada'}</small></div>
  </div>
  <nav className="design-studio-nav" aria-label="Etapas do Estúdio de Cardápio">
   <button type="button" className={mode==='editar'?'active':'secondary'} onClick={()=>setMode('editar')}>1 · Aparência do cardápio</button>
   <button type="button" className={mode==='publicar'?'active':'secondary'} onClick={()=>setMode('publicar')}>2 · Prévia e publicação</button>
  </nav>
  {error&&<p role="alert" className="notice error">{error}</p>}
  {notice&&<p role="status" className="notice">{notice}</p>}
  <div className="design-studio-grid">
   <div className="design-studio-controls">
    {mode==='editar'?<>
     <section className="design-control-card"><h4>Templates do cardápio</h4><p>Quatro visuais, as mesmas funcionalidades atuais. Escolha, salve o rascunho e publique quando estiver pronto.</p>
      <div className="design-template-options" role="group" aria-label="Template do cardápio">{templates.map(model=><button type="button" key={model.id}
       aria-pressed={design.template===model.id} className={'design-template-option'+(design.template===model.id?' active':'')}
       onClick={()=>setDesign(d=>{const {id,name,description,...preset}=model;return {...d,...preset,template:id};})} disabled={!manager||working}>
       <span className={'design-template-mini mini-'+model.id} style={{'--mini-hero':model.hero,'--mini-bg':model.background,'--mini-accent':model.primary}} aria-hidden="true"><i/><span/><div><b/><b/><b/><b/></div></span>
       <strong>{model.name}</strong><small>{model.description}</small><span className="design-template-selected">{design.template===model.id?'Selecionado':'Escolher template'}</span></button>)}</div>
      <p className="design-tip">Produtos, complementos, preços, pagamentos, Fiado, Fideliza+, favoritos e pedidos permanecem os mesmos em todos os templates. A troca altera apenas a apresentação.</p>
     </section>
     <section className="design-control-card"><h4>Paleta de cores</h4>
      <div className="design-color-grid">{colors.map(([key,label])=><label className="design-color" key={key}>{label}
       <span><input aria-label={'Cor '+label} type="color" value={design[key]} disabled={!manager||working}
        onChange={e=>update(key,e.target.value)}/><small>{design[key]}</small></span>
      </label>)}</div>
      <p className="design-tip">O sistema escolhe automaticamente a cor do texto dos botões para melhorar a leitura.</p>
     </section>
     <section className="design-control-card"><h4>Imagens e informações</h4>
      <label className="design-field">Logotipo (até 5 MB)<input disabled={!manager||working} type="file" accept="image/jpeg,image/png,image/webp"
       onChange={e=>pickFile('logo',e.target.files?.[0])}/></label>
      <label className="design-field">Imagem de capa (até 5 MB)<input disabled={!manager||working} type="file" accept="image/jpeg,image/png,image/webp"
       onChange={e=>pickFile('cover',e.target.files?.[0])}/></label>
      {field('Slogan',design.slogan,value=>update('slogan',value),{maxLength:100,disabled:!manager||working})}
      {field('Instagram (@usuario)',design.instagram,value=>update('instagram',value),{maxLength:31,disabled:!manager||working})}
     </section>
     <section className="design-control-card"><h4>Produtos, tipografia e botões</h4>
      <label className="design-field">Layout dos produtos<select value={design.layout} disabled={!manager||working} onChange={e=>update('layout',e.target.value)}>
       {layouts.map(([key,label])=><option key={key} value={key}>{label}</option>)}</select></label>
      <label className="design-field">Fonte<select value={design.font} disabled={!manager||working} onChange={e=>update('font',e.target.value)}>
       {fonts.map(([key,label])=><option key={key} value={key}>{label}</option>)}</select></label>
      <label className="design-field">Tamanho da foto<select value={design.photo_size} disabled={!manager||working} onChange={e=>update('photo_size',e.target.value)}>
       {photoSizes.map(([key,label])=><option key={key} value={key}>{label}</option>)}</select></label>
      <label className="design-field">Arredondamento de cartões e botões: {design.radius}px
       <input type="range" min={0} max={32} value={design.radius} disabled={!manager||working} onChange={e=>update('radius',Number(e.target.value))}/></label>
      <label className="design-check"><input type="checkbox" checked={design.show_descriptions} disabled={!manager||working}
       onChange={e=>update('show_descriptions',e.target.checked)}/> Exibir descrições dos produtos</label>
     </section>
     <section className="design-control-card"><div className="design-section-head"><h4>Banners promocionais</h4>
       <button type="button" className="secondary" disabled={!manager||working||design.banners.length>=6}
        onClick={()=>update('banners',[...design.banners,{title:'',subtitle:'',image_path:'',starts_at:null,ends_at:null,product_id:null}])}>+ Adicionar banner</button></div>
      <p>Até seis banners, com datas opcionais de início e término.</p>
      {design.banners.map((b,index)=><div className="design-banner-form" key={index}>
       <div className="design-section-head"><strong>Banner {index+1}</strong><button type="button" disabled={!manager||working}
        className="secondary" onClick={()=>removeBanner(index)}>Excluir</button></div>
       {field('Título',b.title,value=>setBanner(index,'title',value),{maxLength:90,required:true,disabled:!manager||working})}
       {field('Texto de apoio',b.subtitle,value=>setBanner(index,'subtitle',value),{maxLength:160,disabled:!manager||working})}
       <label className="design-field">Imagem do banner<input type="file" accept="image/jpeg,image/png,image/webp"
        disabled={!manager||working} onChange={e=>pickFile('banner-'+index,e.target.files?.[0])}/></label>
       <label className="design-field">Produto em destaque<select value={b.product_id||''} disabled={!manager||working} onChange={e=>setBanner(index,'product_id',e.target.value||null)}>
        <option value="">Sem produto vinculado</option>{catalog.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
       <div className="design-dates">
        <label className="design-field">Início<input aria-label={'Início do banner '+(index+1)} type="datetime-local" value={ownDate(b.starts_at)}
         disabled={!manager||working} onChange={e=>setBanner(index,'starts_at',dateValue(e.target.value))}/></label>
        <label className="design-field">Término<input aria-label={'Término do banner '+(index+1)} type="datetime-local" value={ownDate(b.ends_at)}
         disabled={!manager||working} onChange={e=>setBanner(index,'ends_at',dateValue(e.target.value))}/></label>
       </div>
      </div>)}
     </section>
    </>:<>
     <section className="design-control-card"><h4>Conferir e publicar</h4>
      <p>Veja a página inicial, o produto e uma simulação visual do checkout antes de publicar. Nenhum pagamento ou pedido é criado nesta prévia.</p>
      <p>{dirty?'Existem alterações não salvas. Volte à aparência e salve o rascunho.':'Rascunho salvo e pronto para publicação.'}</p>
      <button type="button" disabled={!manager||working||dirty} onClick={publish}>Publicar alterações para os clientes</button>
      <p className="design-tip">O cardápio e o checkout continuam usando as regras de preço, complementos, entrega e pagamento já existentes.</p>
     </section>
     <section className="design-control-card"><h4>Histórico e restauração</h4><p>Restaurar uma versão cria um rascunho, sem alterar o cardápio público até você publicar.</p>
      {history.map(item=><div key={item.version} className="design-history-row">
       <span>Versão {item.version} <small>· {stamp(item.created_at)}</small></span>
       <button type="button" className="secondary" disabled={!manager||working||dirty} onClick={()=>restore(item.version)}>Restaurar</button>
      </div>)}
      {!history.length&&<p>Nenhuma versão publicada anteriormente.</p>}
     </section>
    </>}
    <div className="design-studio-actions">
     <button type="button" disabled={!manager||working||!dirty} onClick={saveDraft}>{working?'Aguarde…':'Salvar rascunho'}</button>
     <button type="button" className="secondary" onClick={()=>setMode(mode==='editar'?'publicar':'editar')}>
      {mode==='editar'?'Ver prévia e publicar':'Voltar à aparência'}</button>
    </div>
   </div>
   <aside className="design-studio-preview" aria-label="Prévia do cardápio em tempo real">
    <div className="design-preview-header"><strong>Prévia em tempo real</strong>
     <div className="design-preview-switch"><button type="button" className={viewport==='celular'?'active':''} onClick={()=>setViewport('celular')}>Celular</button>
      <button type="button" className={viewport==='desktop'?'active':''} onClick={()=>setViewport('desktop')}>Computador</button></div>
    </div>
    <div className="design-preview-steps">{[['inicial','Início'],['produto','Produto'],['checkout','Checkout']].map(([key,label])=>
     <button type="button" key={key} className={previewStep===key?'active':''} onClick={()=>setPreviewStep(key)}>{label}</button>)}</div>
    <div className={'design-preview-device '+(viewport==='celular'?'mobile':'desktop')}>{display}</div>
    <small>Prévia ilustrativa com produtos cadastrados. Para conferir todos os detalhes, use o link público após a publicação.</small>
   </aside>
  </div>
 </section>;
}
