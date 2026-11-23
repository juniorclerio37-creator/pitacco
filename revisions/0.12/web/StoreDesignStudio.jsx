import React,{useEffect,useMemo,useState} from 'react';
import {uploadStoreImage,mediaUrl} from './StoreProfile.jsx';
import './store-design-studio.css';
import StorefrontLivePreview from './StorefrontLivePreview.jsx';

const templates=[
 {id:'pitacco-v2',name:'Principal',description:'Roxo e laranja, fotos em grade e destaque para benefícios.',theme:'colorido',primary:'#ff7a08',secondary:'#6f4b80',background:'#faf7fd',paper:'#ffffff',foreground:'#261033',hero:'#4b075e',highlight:'#f4e5fb',layout:'grade',font:'sistema',radius:20},
 {id:'essencial',name:'Essencial',description:'Cabeçalho claro, categorias em pílulas e fotos à esquerda.',theme:'minimalista',primary:'#217c5a',secondary:'#53756c',background:'#f5f8f6',paper:'#ffffff',foreground:'#173a2d',hero:'#174c39',highlight:'#e5f2e9',layout:'lista',font:'sistema',radius:16},
 {id:'editorial',name:'Editorial',description:'Capa fotográfica, navegação em abas e cartões editoriais.',theme:'moderno',primary:'#bc5435',secondary:'#806551',background:'#fbf7f0',paper:'#ffffff',foreground:'#38271f',hero:'#41271f',highlight:'#f8ebdd',layout:'destaques',font:'serifada',radius:8},
 {id:'urbano',name:'Urbano',description:'Blocos em azul escuro, detalhes amarelos e cartões contrastantes.',theme:'premium',primary:'#24364a',secondary:'#66778a',background:'#f4f6f8',paper:'#ffffff',foreground:'#172330',hero:'#172330',highlight:'#f3e7d3',layout:'grade',font:'sistema',radius:12}
];
const colors=[['primary','Principal'],['secondary','Secundária'],['background','Fundo'],['paper','Cartões'],['foreground','Textos'],['hero','Cabeçalho'],['highlight','Destaques']];
const layouts=[['lista','Lista organizada'],['grade','Grade de produtos'],['destaques','Cartões grandes']];
const fonts=[['sistema','Moderna'],['arredondada','Arredondada'],['serifada','Elegante']];
const photoSizes=[['pequeno','Pequena'],['medio','Média'],['grande','Grande']];
const field=(label,value,change,props={})=><label className="design-field">{label}<input value={value||''} onChange={event=>change(event.target.value)} {...props}/></label>;
const cash=value=>Number(value||0).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
const defaultDesign=(()=>{const {id,name,description,...style}=templates[0];return {template:id,...style,photo_size:'medio',
 show_descriptions:true,slogan:'Cardápio digital',instagram:'',logo_path:'',cover_path:'',banners:[]};})();
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
const isNetworkError=e=>/failed to fetch|fetch failed|networkerror|load failed|network request failed/i.test(String(e?.message||e||''));
function studioError(e,action){
 if(isNetworkError(e)||navigator.onLine===false)
  return 'Falha de conexão ao '+action+'. Suas alterações continuam nesta tela; não foi possível confirmar o resultado no servidor. Confira a conexão antes de tentar novamente.';
 const detail=String(e?.message||e||'');
 if(/jwt|token|sess[aã]o|401|403|unauthorized/i.test(detail))
  return 'Sua sessão não está autorizada a '+action+'. Entre novamente no painel para continuar.';
 if(/outro dispositivo|alterado|vers[aã]o/i.test(detail))
  return 'O estúdio foi alterado em outra aba ou dispositivo. Recarregue os dados antes de salvar novamente.';
 return detail||'Não foi possível '+action+'.';
}
async function loadStudioState(client,storeId){
 for(let attempt=0;attempt<2;attempt++){
  try{
   const {data,error}=await client.rpc('pitacco_storefront_studio_state',{p_store:storeId});
   if(error)throw error;
   return data;
  }catch(e){if(attempt||!isNetworkError(e))throw e;await new Promise(resolve=>setTimeout(resolve,600));}
 }
}
function equalDesign(a,b){
 const normalize=value=>Array.isArray(value)?value.map(normalize)
  :value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(k=>[k,normalize(value[k])])):value;
 return JSON.stringify(normalize(a))===JSON.stringify(normalize(b));
}

function BannerImage({url,...props}){
 const [broken,setBroken]=useState(false);
 useEffect(()=>setBroken(false),[url]);
 if(!url||broken)return <span className="design-media-empty">{broken?'Imagem indisponível. Selecione uma nova para substituir.':'Nenhuma imagem selecionada'}</span>;
 return <img src={url} alt="" onError={()=>setBroken(true)} {...props}/>;
}

export default function StoreDesignStudio({client,store,manager,products=[],focus='all'}){
 const [saved,setSaved]=useState(null),[design,setDesign]=useState(null),[version,setVersion]=useState(0);
 const [publishedDesign,setPublishedDesign]=useState(null);
 const [publishedVersion,setPublishedVersion]=useState(0),[history,setHistory]=useState([]),[publishedAt,setPublishedAt]=useState(null);
 const [mode,setMode]=useState('editar'),[viewport,setViewport]=useState('celular'),[previewStep,setPreviewStep]=useState('inicial');
 const [files,setFiles]=useState({}),[fileUrls,setFileUrls]=useState({});
 const [working,setWorking]=useState(false),[loading,setLoading]=useState(true),[notice,setNotice]=useState(''),[error,setError]=useState('');
 const [loadAttempt,setLoadAttempt]=useState(0);
 const [catalog,setCatalog]=useState(products.slice(0,8));
 const [legacyMedia,setLegacyMedia]=useState({logo:'',cover:''});
 const dirty=design&&saved?JSON.stringify(design)!==JSON.stringify(saved)||Object.keys(files).length>0:false;
 const needsPublishing=Boolean(design&&(!publishedDesign||dirty||!equalDesign(publishedDesign,design)));
 const photo=path=>path?mediaUrl(client,path):'';
 const imageFor=(key,path)=>fileUrls[key]||photo(path)||legacyMedia[key]||'';
 const moneyColors={background:design?.background||'#fff',color:design?.foreground||'#222',fontFamily:fontFace(design?.font)};
 const onBrand=design?.primary&&isHex(design.primary)&&contrast(design.primary)>.179?'#221d1b':'#ffffff';

 useEffect(()=>{
  let alive=true;
  setLoading(true);setError('');setNotice('');
  loadStudioState(client,store.id).then(data=>{
   if(!alive)return;
   const next={...defaultDesign,...data.draft,banners:data.draft?.banners||[]};
   setSaved(next);setDesign(structuredClone(next));setVersion(data.draft_version);
   setPublishedVersion(data.published_version);setPublishedDesign(data.published||null);setHistory(data.history||[]);
   setPublishedAt(data.published_at);
    setLegacyMedia({logo:data.legacy_logo_url||'',cover:data.legacy_banner_url||''});
  }).catch(e=>{if(alive)setError(studioError(e,'carregar o estúdio'))})
   .finally(()=>{if(alive)setLoading(false)});
  client.from('products').select('id,name,price,category,description,image_url').eq('store_id',store.id)
   .eq('menu_active',true).limit(8).then(({data})=>{if(alive&&data)setCatalog(data)}).catch(()=>{});
  return()=>{alive=false};
 },[client,store.id,loadAttempt]);
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
  if(d.banners.some((b,i)=>{
    const title=String(b.title||'').trim();
    return title.length===1||(!title&&!b.image_path&&!files['banner-'+i]);
   }))throw Error('Todo banner precisa de uma imagem ou um título com pelo menos 2 caracteres.');
  return true;
 }
 async function saveAndPublish(){
  if(!manager||!design||working)return;
  if(!needsPublishing){
   setError('');setNotice('A aparência já está publicada. Nenhuma alteração nova para publicar.');
   return;
  }
  // Publicação direta no clique, sem confirmação redundante.
  setWorking(true);setError('');setNotice('');
  let next=null,phase='validar a aparência';
  try{
   next=structuredClone(design);
   validate(next);
   for(const [key,file] of Object.entries(files)){
    phase='enviar imagem da loja';
    const path=await uploadStoreImage(client,store.id,file,'stores');
    if(key==='logo')next.logo_path=path;
    else if(key==='cover')next.cover_path=path;
    else if(key.startsWith('banner-')){
     const index=Number(key.slice(7));
     if(next.banners[index])next.banners[index].image_path=path;
    }
   }
   phase='salvar e publicar';
   // O RPC valida, registra a revisão e publica o visual NA MESMA transação.
   const {data,error}=await client.rpc('pitacco_storefront_save_publish',{
    p_store:store.id,p_design:next,
    p_expected_draft:version,p_expected_published:publishedVersion
   });
   if(error)throw error;
   if(!data?.saved||!data?.published)throw Error('O servidor não confirmou que as alterações foram publicadas.');
   const now=data.published_at||new Date().toISOString();
   setSaved(next);setDesign(structuredClone(next));setPublishedDesign(structuredClone(next));
   setVersion(data.draft_version);setPublishedVersion(data.published_version);
   setPublishedAt(now);
   setHistory(items=>[{id:null,version:data.published_version,created_at:now},...items].slice(0,20));
   setFiles({});setFileUrls({});
   setNotice('Alterações salvas e publicadas! O cardápio está atualizado para os clientes.');
  }catch(e){
   // Conexão interrompida após o commit? Confere o resultado antes de
   // afirmar que a operação falhou ou repeti-la.
   if(next&&phase==='salvar e publicar'&&isNetworkError(e)){
    try{
     const current=await loadStudioState(client,store.id);
     if(current.published_version>publishedVersion&&
      current.draft_version>version&&equalDesign(current.published,next)){
      const date=current.published_at||new Date().toISOString();
      setSaved(next);setDesign(structuredClone(next));setPublishedDesign(structuredClone(next));
      setVersion(current.draft_version);setPublishedVersion(current.published_version);
      setPublishedAt(date);setHistory(current.history||[]);
      setFiles({});setFileUrls({});
      setNotice('Alterações salvas e publicadas! Publicação confirmada após reconectar.');
      return;
     }
    }catch{}
   }
   setError(studioError(e,phase)+
     (phase==='salvar e publicar'?' Nenhum sucesso será indicado até o servidor confirmar.':''));
  }finally{setWorking(false)}
 }
 async function restore(revision){
  if(dirty){setError('Há alterações ainda não publicadas. Publique ou descarte antes de restaurar.');return}
  if(!window.confirm('Restaurar a versão '+revision+' para edição? A página pública só mudará ao tocar em Salvar e publicar.'))return;
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
   setMode('editar');setNotice('Versão '+revision+' recuperada para edição. Toque em Salvar e publicar quando estiver pronto.');
  }catch(e){setError(studioError(e,'restaurar a versão'))}
  finally{setWorking(false)}
 }
 if(loading)return <div className="panel" role="status">Carregando Estúdio de Cardápio…</div>;
 if(!design)return <section className="panel"><h3>Estúdio de Cardápio</h3><p role="alert">{error||'Não foi possível carregar.'}</p><button type="button" onClick={()=>setLoadAttempt(n=>n+1)}>Tentar novamente</button></section>;
 return <section className="design-studio" aria-label="Estúdio de Cardápio Pitacco">
  <div className="design-studio-heading"><div><span className="eyebrow">ADMINISTRAR LOJA · APARÊNCIA</span>
   <h3>{focus==='banners'?'Banners do cardápio':'Estúdio de Cardápio'}</h3><p>{focus==='banners'?'Crie, agende e publique banners com imagens. Confira a prévia real antes de publicar.':'Personalize a identidade da sua loja. As alterações só chegam aos clientes depois de publicadas.'}</p></div>
   <div className="design-studio-status"><span>{needsPublishing?'● Alterações pendentes de publicação':'✓ Aparência publicada'}</span>
    <small>{publishedVersion?'Versão '+publishedVersion+' publicada em '+stamp(publishedAt):'Nenhuma versão visual personalizada publicada'}</small></div>
  </div>
{focus!=='banners'&&<nav className="design-studio-nav" aria-label="Etapas do Estúdio de Cardápio">
   <button type="button" className={mode==='editar'?'active':'secondary'} onClick={()=>setMode('editar')}>1 · Aparência do cardápio</button>
   <button type="button" className={mode==='publicar'?'active':'secondary'} onClick={()=>setMode('publicar')}>2 · Prévia e publicação</button>
  </nav>}
  {error&&<p role="alert" className="notice error">{error}</p>}
  {notice&&<p role="status" className="notice">{notice}</p>}
  <div className="design-studio-grid">
   <div className="design-studio-controls">
    {mode==='editar'?<>
     {focus!=='banners'&&<>
     <section className="design-control-card"><h4>Templates do cardápio</h4><p>Quatro visuais, as mesmas funcionalidades atuais. Escolha, visualize e toque em Salvar e publicar quando estiver pronto.</p>
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
      <div className="design-media-preview"><BannerImage url={imageFor('logo',design.logo_path)} style={{width:116,height:116,objectFit:'contain',borderRadius:12}}/><small>{files.logo?'Novo logotipo selecionado — publicar para aplicar.':'Logotipo atual da loja, preservado até ser substituído.'}</small></div>
      <label className="design-field">Imagem de capa (até 5 MB)<input disabled={!manager||working} type="file" accept="image/jpeg,image/png,image/webp"
       onChange={e=>pickFile('cover',e.target.files?.[0])}/></label>
      <div className="design-media-preview"><BannerImage url={imageFor('cover',design.cover_path)} style={{width:'100%',maxHeight:160,objectFit:'cover',borderRadius:12}}/><small>{files.cover?'Nova capa selecionada — publicar para aplicar.':'Capa atual da loja, preservada até ser substituída.'}</small></div>
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
     </>}
     <section className="design-control-card"><div className="design-section-head"><h4>Banners promocionais</h4>
       <button type="button" className="secondary" disabled={!manager||working||design.banners.length>=6}
        onClick={()=>update('banners',[...design.banners,{title:'',subtitle:'',image_path:'',starts_at:null,ends_at:null,product_id:null}])}>+ Adicionar banner</button></div>
      <p>Até seis banners, com datas opcionais. Se enviar uma imagem, o título é opcional.</p>
      {design.banners.map((b,index)=><div className="design-banner-form" key={index}>
       <div className="design-section-head"><strong>Banner {index+1}</strong><button type="button" disabled={!manager||working}
        className="secondary" onClick={()=>removeBanner(index)}>Excluir</button></div>
       {field('Título (opcional com imagem)',b.title,value=>setBanner(index,'title',value),{maxLength:90,disabled:!manager||working})}
       {field('Texto de apoio',b.subtitle,value=>setBanner(index,'subtitle',value),{maxLength:160,disabled:!manager||working})}
       <label className="design-field">Imagem do banner<input type="file" accept="image/jpeg,image/png,image/webp"
        disabled={!manager||working} onChange={e=>pickFile('banner-'+index,e.target.files?.[0])}/></label>
       <div className="design-media-preview"><BannerImage url={imageFor('banner-'+index,b.image_path)} style={{width:'100%',maxHeight:150,objectFit:'cover',borderRadius:12}}/><small>{files['banner-'+index]?'Imagem selecionada — publicar para aplicar.':'Prévia do banner.'}</small></div>
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
      <p>Confira a página inicial, o produto e o checkout exatamente com os componentes do cardápio público. As alterações aparecem somente nesta prévia até você publicar.</p>
      <p>{needsPublishing?'Há alterações prontas para salvar e publicar diretamente.':'A versão apresentada já está publicada para os clientes.'}</p>
      <p className="design-tip">Use o botão Salvar e publicar abaixo. A publicação é realizada em uma única etapa, mantendo o histórico de versões.</p>
      <p className="design-tip">O cardápio e o checkout continuam usando as regras de preço, complementos, entrega e pagamento já existentes.</p>
     </section>
     <section className="design-control-card"><h4>Histórico e restauração</h4><p>Restaurar uma versão recupera a aparência para edição. Os clientes só verão a mudança após Salvar e publicar.</p>
      {history.map(item=><div key={item.version} className="design-history-row">
       <span>Versão {item.version} <small>· {stamp(item.created_at)}</small></span>
       <button type="button" className="secondary" disabled={!manager||working||dirty} onClick={()=>restore(item.version)}>Restaurar</button>
      </div>)}
      {!history.length&&<p>Nenhuma versão publicada anteriormente.</p>}
     </section>
    </>}
    <div className="design-studio-actions">
     <button type="button" disabled={!manager||working||!design} onClick={saveAndPublish}>{working?'Salvando e publicando…':'Salvar e publicar'}</button>
{focus!=='banners'&&<button type="button" className="secondary" onClick={()=>setMode(mode==='editar'?'publicar':'editar')}>
      {mode==='editar'?'Ver prévia':'Voltar à aparência'}</button>}
    </div>
   </div>
   <aside className="design-studio-preview" aria-label="Prévia do cardápio em tempo real">
    <div className="design-preview-header"><strong>Prévia em tempo real</strong>
     <div className="design-preview-switch"><button type="button" className={viewport==='celular'?'active':''} onClick={()=>setViewport('celular')}>Celular</button>
      <button type="button" className={viewport==='desktop'?'active':''} onClick={()=>setViewport('desktop')}>Computador</button></div>
    </div>
    <div className="design-preview-steps">{[['inicial','Início'],['produto','Produto'],['checkout','Checkout']].map(([key,label])=>
     <button type="button" key={key} className={previewStep===key?'active':''} onClick={()=>setPreviewStep(key)}>{label}</button>)}</div>
    <div className={'design-preview-device '+(viewport==='celular'?'mobile':'desktop')}>
     <StorefrontLivePreview client={client} store={store} design={design} step={previewStep} viewport={viewport} files={files}/>
    </div>
    <small>Visualização real do cardápio, com o rascunho aplicado temporariamente. Nenhum pedido pode ser enviado pela prévia.</small>
   </aside>
  </div>
 </section>;
}
