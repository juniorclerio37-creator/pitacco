import React,{useEffect,useMemo,useState} from 'react';
import Papa from 'papaparse';
import JSZip from 'jszip';
import './UniversalMenuImporter.css';

const MAX_PRODUCTS=300;
const money=value=>Number(value||0).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
const valueOf=(o,keys)=>keys.map(key=>o?.[key]).find(v=>v!==undefined&&v!==null&&v!=='');
function amount(raw){
 if(typeof raw==='number')return Number.isFinite(raw)?Math.round(raw*100)/100:NaN;
 const text=String(raw??'').replace(/R\$|\s|BRL/gi,'');
 const normalized=text.includes(',')?text.replace(/\./g,'').replace(',','.'):text;
 return normalized?Math.round(Number(normalized)*100)/100:NaN;
}
function productGroups(input){
 const raw=valueOf(input,['groups','option_groups','optionGroups','complements','complementos','adicionais','modifiers']);
 let groups=raw;
 if(typeof raw==='string'){try{groups=JSON.parse(raw)}catch{groups=[]}}
 if(!Array.isArray(groups))return [];
 return groups.map((g,i)=>{
  const choices=valueOf(g,['options','choices','items','itens'])||[];
  const opts=Array.isArray(choices)?choices:[];
  return {name:String(valueOf(g,['name','nome','title'])||'').trim().slice(0,100),
   min:Number(valueOf(g,['min','minimum','minChoices','min_select'])??(g.required?1:0)),
   max:Number(valueOf(g,['max','maximum','maxChoices','max_select'])??(g.type==='unique'?1:opts.length)),
   sort_order:i,options:opts.map((o,j)=>({
    name:String(valueOf(o,['name','nome','title','label'])||'').trim().slice(0,100),
    price:amount(valueOf(o,['price','preco','additional_price','additionalPrice','valor'])??0),
    available:o.available!==false&&o.active!==false,sort_order:j
   }))}
 }).filter(g=>g.name&&g.options.length);
}
function normalizeItem(r,index,category=''){
 const rawPrice=valueOf(r,['price','preco','valor','salePrice','currentPrice']);
 const image=valueOf(r,['image_url','imageUrl','image','imagem','foto','photo'])||'';
 return {name:String(valueOf(r,['name','nome','produto','title'])||'').trim().slice(0,120),
  category:String(valueOf(r,['category','categoria','group','grupo'])||category||'Outros').trim().slice(0,80),
  description:String(valueOf(r,['description','descricao','descrição','details'])||'').trim().slice(0,1000),
  price:amount(rawPrice),image_url:String(image).trim().slice(0,2048),
  active:r.active!==false&&r.menu_active!==false&&r.available!==false,
  groups:productGroups(r),_index:index};
}
function unpackCatalog(data){
 const container=Array.isArray(data)?data:valueOf(data,['products','items','produtos','menuItems']);
 if(Array.isArray(container))return container;
 if(Array.isArray(data?.categories))return data.categories.flatMap(cat=>{
  const items=valueOf(cat,['products','items','produtos'])||[];
  return Array.isArray(items)?items.map(r=>({...r,category:r.category||cat.name||cat.title})):[]});
 return [];
}
function review(items){
 if(!items.length||items.length>MAX_PRODUCTS)throw Error('Informe de 1 a '+MAX_PRODUCTS+' produtos.');
 const normalized=items.map((x,i)=>normalizeItem(x,i));
 const fail=normalized.find(x=>!x.name||!Number.isFinite(x.price)||x.price<=0||x.price>100000);
 if(fail)throw Error('Há produto sem nome ou preço válido. Revise os dados de origem.');
 return normalized;
}
async function readCatalogFile(file){
 if(file.size>20*1024*1024)throw Error('O arquivo excede 20 MB.');
 let text='',type=file.name.toLowerCase(),attachments=new Map();
 if(type.endsWith('.zip')){
  const zip=await JSZip.loadAsync(file);
  const list=Object.values(zip.files).filter(x=>!x.dir);
  if(list.length>450)throw Error('ZIP muito grande: máximo de 450 arquivos.');
  const catalog=list.find(x=>/(^|\/)(menu|cardapio|produtos|products)\.(json|csv)$/i.test(x.name));
  if(!catalog)throw Error('ZIP precisa conter menu.json, cardapio.json, produtos.csv ou products.csv.');
  text=await catalog.async('string');type=catalog.name.toLowerCase();
  for(const entry of list.filter(x=>/\.(png|jpe?g|webp)$/i.test(x.name))){
   attachments.set(entry.name.toLowerCase().replace(/^\.\//,''),entry);
  }
 }else text=await file.text();
 if(text.length>5_000_000)throw Error('Arquivo de dados excede 5 MB.');
 let parsed;
 if(type.endsWith('.json'))parsed=JSON.parse(text);
 else if(type.endsWith('.csv')){
  const result=Papa.parse(text,{header:true,skipEmptyLines:true,delimiter:'',transformHeader:h=>h.trim().toLowerCase()});
  if(result.errors.length>25)throw Error('A planilha contém erros de formatação.');
  parsed=result.data;
 }else throw Error('Use CSV, JSON ou ZIP com as fotos.');
 const rows=unpackCatalog(parsed);
 return {products:review(rows),attachments};
}
function stats(items){
 return {products:items.length,photos:items.filter(p=>p.image_url).length,
  groups:items.reduce((n,p)=>n+p.groups.length,0),
  options:items.reduce((n,p)=>n+p.groups.reduce((m,g)=>m+g.options.length,0),0)};
}
function check(items){
 for(const product of items){
  if(!product.name||!Number.isFinite(product.price)||product.price<=0||product.price>100000)throw Error('Revise nome e preço de cada produto.');
  if(product.groups.length>40)throw Error('Há excesso de grupos de complementos em '+product.name);
  for(const group of product.groups){
   if(!group.name||!Number.isInteger(group.min)||!Number.isInteger(group.max)||group.min<0||group.max<1||group.max>100||group.min>group.max)throw Error('Revise limites do grupo '+group.name);
   if(!group.options.length||group.options.length>100)throw Error('Revise as opções do grupo '+group.name);
   if(group.options.filter(o=>o.available).length<group.min)throw Error('Há menos opções disponíveis do que o mínimo no grupo '+group.name);
   for(const option of group.options)
    if(!option.name||!Number.isFinite(option.price)||option.price<0||option.price>100000)throw Error('Complemento com nome ou preço inválido em '+group.name);
  }
 }
}
async function responseError(error){
 try{const response=error?.context;if(response?.json){const data=await response.json();if(data?.error)return data.error;}}catch{}
 return error?.message||'Falha de conexão';
}
const imageKey=(src)=>String(src||'').trim().toLowerCase().replace(/^\.?\//,'');
function zipMatch(entries,source){
 const normalized=imageKey(source);
 return entries.get(normalized)||[...entries].find(([name])=>name.endsWith('/'+normalized)||name.split('/').pop()===normalized.split('/').pop())?.[1];
}
function safePhotoUrl(value){try{const u=new URL(value);return u.protocol==='https:'&&u.username===''&&u.password==='';}catch{return false}}
export default function UniversalMenuImporter({client,storeId,onCompleted}){
 const [link,setLink]=useState(''),[items,setItems]=useState([]),[origin,setOrigin]=useState(''),[warnings,setWarnings]=useState([]);
 const [zipImages,setZipImages]=useState(new Map()),[mode,setMode]=useState('add'),[replaceConfirm,setReplaceConfirm]=useState(false);
 const [allowMissing,setAllowMissing]=useState(false),[selected,setSelected]=useState(0),[limit,setLimit]=useState(24);
 const [phase,setPhase]=useState(''),[notice,setNotice]=useState(''),[error,setError]=useState(''),[history,setHistory]=useState([]);
 const [sourceInfo,setSourceInfo]=useState(null);
 const counts=useMemo(()=>stats(items),[items]);
 const canReplace=mode!=='replace'||replaceConfirm;
 const eligible=items.length>0&&canReplace&&!phase;
 async function loadHistory(){
  const {data,error:err}=await client.from('pitacco_menu_import_history')
   .select('id,mode,origin,created_at,summary').eq('store_id',storeId).order('created_at',{ascending:false}).limit(8);
  if(!err)setHistory(data||[]);
 }
 useEffect(()=>{setItems([]);setWarnings([]);setOrigin('');setSourceInfo(null);setSelected(0);setHistory([]);loadHistory();},[storeId]);
 async function runScan(event){
  event.preventDefault();setError('');setNotice('');setPhase('Analisando link público…');
  try{
   const {data,error:err}=await client.functions.invoke('menu-import',{body:{action:'scan',store_id:storeId,url:link.trim()}});
   if(err)throw Error(await responseError(err));
   if(!Array.isArray(data?.products))throw Error('A resposta do cardápio está incompleta. Tente novamente.');
   const hasProducts=data.products.length>0;
   setItems(hasProducts?review(data.products):[]);setZipImages(new Map());setOrigin(data.url||link.trim());
   setWarnings(data.warnings||[]);setSourceInfo({name:data.sourceTitle||'',categories:data.counts?.categories??null,status:data.sourceStatus||''});
   setSelected(0);setLimit(24);setAllowMissing(false);setReplaceConfirm(false);
   setNotice(hasProducts
    ?'Análise concluída. Revise os produtos antes de importar. Nenhum cadastro foi alterado.'
    :'O link foi analisado, mas nenhum produto foi disponibilizado para importação. Seu cardápio atual não foi alterado.');
  }catch(e){setError(e.message||'Não foi possível analisar este endereço.');}
  finally{setPhase('');}
 }
 async function runFile(event){
  const file=event.target.files?.[0];if(!file)return;
  setError('');setNotice('');setPhase('Lendo arquivo…');
  try{
   const result=await readCatalogFile(file);
   setItems(result.products);setZipImages(result.attachments);setOrigin(file.name);
   setWarnings([]);setSourceInfo(null);setSelected(0);setLimit(24);setAllowMissing(false);setReplaceConfirm(false);
   setNotice('Arquivo analisado. Revise produtos, fotos e complementos antes de importar.');
  }catch(e){setError(e.message||'Não foi possível ler o arquivo.');}
  finally{event.target.value='';setPhase('');}
 }
 function changeItem(index,patch){setItems(old=>old.map((x,i)=>i===index?{...x,...patch}:x));}
 function changeGroup(index,gIndex,patch){
  setItems(old=>old.map((x,i)=>i!==index?x:{...x,groups:x.groups.map((g,j)=>j!==gIndex?g:{...g,...patch})}));
 }
 function changeOption(index,gIndex,oIndex,patch){
  setItems(old=>old.map((x,i)=>i!==index?x:{...x,groups:x.groups.map((g,j)=>j!==gIndex?g:{...g,options:g.options.map((o,k)=>k!==oIndex?o:{...o,...patch})})}));
 }
 async function uploadLocalPhotos(itemsToImport){
  if(!zipImages.size){
   const failed=[];
   const products=itemsToImport.map(p=>{
    if(p.image_url&&!safePhotoUrl(p.image_url)){failed.push(p.name);return {...p,image_url:''};}
    return {...p};
   });
   return {products,failed};
  }
  const imported=itemsToImport.map(p=>({...p}));const failed=[];
  for(let i=0;i<imported.length;i++){
   const item=imported[i];if(!item.image_url)continue;
   const entry=zipMatch(zipImages,item.image_url);
   if(!entry){if(!safePhotoUrl(item.image_url)){failed.push(item.name);item.image_url='';}continue;}
   const type=entry.name.toLowerCase().split('.').pop(),ext=type==='jpeg'?'jpg':type;
   if(!['png','jpg','webp'].includes(ext)){failed.push(item.name);item.image_url='';continue;}
   const bytes=await entry.async('uint8array');
   if(bytes.length<100||bytes.length>5_000_000){failed.push(item.name);item.image_url='';continue;}
   const path='products/'+storeId+'/'+crypto.randomUUID()+'.'+ext;
   const mime=ext==='jpg'?'image/jpeg':'image/'+ext;
   const {error:err}=await client.storage.from('pitacco-media').upload(path,bytes,{contentType:mime,upsert:false});
   if(err){failed.push(item.name);item.image_url='';continue;}
   item.image_url=client.storage.from('pitacco-media').getPublicUrl(path).data.publicUrl;
   setPhase('Copiando fotos do arquivo: '+(i+1)+'/'+imported.length);
  }
  return {products:imported,failed};
 }
 async function copyRemotePhotos(all){
  const updated=all.map(p=>({...p})),failed=[];
  const map=new Map();
  const pending=[...new Set(updated.map(p=>p.image_url).filter(u=>safePhotoUrl(u)&&!u.includes('/storage/v1/object/public/pitacco-media/')))];
  for(let i=0;i<pending.length;i+=6){
   setPhase('Copiando fotos: '+Math.min(i+6,pending.length)+'/'+pending.length);
   const current=pending.slice(i,i+6);
   const {data,error:err}=await client.functions.invoke('menu-import',{
    body:{action:'photos',store_id:storeId,source_url:origin.startsWith('https://')?origin:undefined,
      photos:current.map((url,j)=>({id:String(i+j),url}))}});
   if(err){const message=await responseError(err);for(const url of current)map.set(url,{error:message});}
   else for(const result of data?.photos||[])map.set(current[Number(result.id)-i],result);
  }
  for(const item of updated){
   if(!safePhotoUrl(item.image_url))continue;
   const result=map.get(item.image_url);
   if(result?.url)item.image_url=result.url;
   else if(result?.error){failed.push(item.name);item.image_url='';}
  }
  return {products:updated,failed};
 }
 async function apply(){
  if(!eligible)return;
  setError('');setNotice('');
  try{
   check(items);
   if(mode==='replace'&&!replaceConfirm)throw Error('Confirme a substituição do cardápio atual.');
   setPhase('Preparando imagens…');
   const local=await uploadLocalPhotos(items);
   const remote=await copyRemotePhotos(local.products);
   const failed=[...new Set([...local.failed,...remote.failed])];
   if(failed.length&&!allowMissing){
    // Não descartar cópias que foram salvas com sucesso.
    setItems(remote.products);
    throw Error(failed.length+' foto(s) não puderam ser copiadas. Revise e, se desejar, marque a autorização para importar sem essas fotos.');
   }
   setPhase('Salvando produtos e complementos…');
   const data=remote.products.map(({_index,...p})=>p);
   const {data:out,error:rpcError}=await client.rpc('pitacco_menu_import_apply',{
    p_store:storeId,p_items:data,p_mode:mode,p_origin:origin.slice(0,300)});
   if(rpcError)throw rpcError;
   if(!out?.saved)throw Error('O servidor não confirmou a importação.');
   setNotice('Importação concluída: '+out.created+' produto(s) cadastrados, '+out.duplicates+
     ' repetido(s) ignorados. '+out.archived+' produto(s) anteriores arquivados.');
   setItems([]);setZipImages(new Map());setWarnings([]);setOrigin('');setReplaceConfirm(false);
   await loadHistory();onCompleted?.();
  }catch(e){setError(e.message||'Não foi possível salvar a importação.');}
  finally{setPhase('');}
 }
 const active=items[selected];
 return <section className="mi" aria-label="Importador Inteligente de Cardápio" aria-busy={!!phase}>
  <div className="mi-heading">
   <div><span className="mi-eyebrow">CARDÁPIO DIGITAL</span><h3>Importador Inteligente</h3>
    <p>Traga produtos, fotos, preços e complementos de outro cardápio. Funciona por leitura de páginas públicas e arquivos exportados, sem depender de uma plataforma específica.</p></div>
  </div>
  <div className="mi-panel">
   <form onSubmit={runScan} className="mi-url">
    <label htmlFor="mi-menu-link">Link do cardápio digital</label>
    <div className="mi-inline">
     <input id="mi-menu-link" type="url" required placeholder="https://cardapio.exemplo.com/minha-loja"
      value={link} onChange={e=>setLink(e.target.value)} disabled={!!phase}/>
     <button type="submit" disabled={!!phase||!link.trim()}>Analisar cardápio</button>
    </div>
    <small>O endereço deve ser HTTPS e público. Sites que bloqueiam leitura automática podem exigir um arquivo de exportação.</small>
   </form>
   <div className="mi-or">ou importe por arquivo</div>
   <label className="mi-file">CSV, JSON ou ZIP com fotos
    <input type="file" accept=".csv,.json,.zip" onChange={runFile} disabled={!!phase}/>
   </label>
  </div>
  {phase&&<p role="status" className="mi-status">{phase}</p>}
  {error&&<p role="alert" className="mi-error">{error}</p>}
  {notice&&<p role="status" className="mi-success">{notice}</p>}
  {items.length===0&&warnings.length>0&&<section className="mi-warning" role="status" aria-label="Diagnóstico do link do cardápio">
   <strong>Este endereço não disponibilizou produtos para importação.</strong>
   {sourceInfo?.categories!=null&&<p>{sourceInfo.name?sourceInfo.name+': ':''}{sourceInfo.categories} categoria(s) identificada(s), mas nenhum item com nome e preço acessível publicamente.</p>}
   {warnings.map((warning,i)=><p key={i}>{warning}</p>)}
   {origin.startsWith('https://')&&<a href={origin} target="_blank" rel="noopener noreferrer">Abrir o cardápio original como cliente</a>}
   <p>Para continuar, use o arquivo CSV, JSON ou ZIP acima. Não é necessário excluir os produtos já cadastrados.</p>
  </section>}
  {items.length>0&&<>
   <div className="mi-stats">
    <span><strong>{counts.products}</strong> produtos</span>
    <span><strong>{counts.photos}</strong> com imagem</span>
    <span><strong>{counts.groups}</strong> grupos</span>
    <span><strong>{counts.options}</strong> opções</span>
   </div>
   <h4>Prévia para conferência</h4>
   {warnings.length>0&&<div className="mi-warning">{warnings.map((w,i)=><p key={i}>{w}</p>)}</div>}
   <p className="mi-hint">Clique em um produto para conferir e editar preços, categorias, opções e limites. Nenhuma alteração será publicada antes da confirmação.</p>
   <div className="mi-browser">
    <div className="mi-products">
     {items.slice(0,limit).map((p,index)=><button type="button" key={index}
      className={'mi-product '+(selected===index?'mi-selected':'')}
      onClick={()=>setSelected(index)} aria-pressed={selected===index}>
      {safePhotoUrl(p.image_url)?<img src={p.image_url} alt="" loading="lazy"/>:<span className="mi-photo-placeholder">Sem foto</span>}
      <span><strong>{p.name}</strong><small>{p.category} · {money(p.price)}</small>
       <small>{p.groups.length} grupo(s) · {p.active?'Disponível':'Indisponível'}</small></span>
     </button>)}
     {limit<items.length&&<button type="button" className="secondary" onClick={()=>setLimit(n=>Math.min(n+24,items.length))}>Exibir mais produtos</button>}
    </div>
    {active&&<div className="mi-editor" key={selected}>
     <h4>Revisar produto {selected+1}</h4>
     <label>Nome<input maxLength={120} value={active.name} onChange={e=>changeItem(selected,{name:e.target.value})}/></label>
     <label>Categoria<input maxLength={80} value={active.category} onChange={e=>changeItem(selected,{category:e.target.value})}/></label>
     <label>Preço (R$)<input type="number" min=".01" max="100000" step=".01" value={active.price}
       onChange={e=>changeItem(selected,{price:Number(e.target.value)})}/></label>
     <label>Descrição<textarea maxLength={1000} value={active.description||''} onChange={e=>changeItem(selected,{description:e.target.value})}/></label>
     <label>URL da foto<input type="text" value={active.image_url||''} onChange={e=>changeItem(selected,{image_url:e.target.value})}/></label>
     <label className="mi-check"><input type="checkbox" checked={active.active!==false} onChange={e=>changeItem(selected,{active:e.target.checked})}/> Disponível no cardápio</label>
     <h4>Complementos ({active.groups.length})</h4>
     {active.groups.map((g,index)=><details key={index} className="mi-group">
      <summary>{g.name} · {g.min} a {g.max} escolhas · {g.options.length} opções</summary>
      <label>Grupo<input value={g.name} onChange={e=>changeGroup(selected,index,{name:e.target.value})}/></label>
      <div className="mi-inline">
       <label>Mínimo<input type="number" min="0" max="100" value={g.min} onChange={e=>changeGroup(selected,index,{min:Number(e.target.value)})}/></label>
       <label>Máximo<input type="number" min="1" max="100" value={g.max} onChange={e=>changeGroup(selected,index,{max:Number(e.target.value)})}/></label>
      </div>
      {g.options.map((o,k)=><div className="mi-option" key={k}>
       <input aria-label="Nome da opção" value={o.name} onChange={e=>changeOption(selected,index,k,{name:e.target.value})}/>
       <label>R$ <input aria-label="Preço adicional" type="number" min="0" step=".01" value={o.price}
        onChange={e=>changeOption(selected,index,k,{price:Number(e.target.value)})}/></label>
       <label className="mi-check"><input type="checkbox" checked={o.available!==false}
        onChange={e=>changeOption(selected,index,k,{available:e.target.checked})}/> Disponível</label>
      </div>)}
     </details>)}
    </div>}
   </div>
   <div className="mi-confirm">
    <h4>Como deseja importar?</h4>
    <label><input type="radio" name="mi-mode" checked={mode==='add'} onChange={()=>{setMode('add');setReplaceConfirm(false)}}/> Adicionar novos produtos e ignorar nomes já existentes</label>
    <label><input type="radio" name="mi-mode" checked={mode==='replace'} onChange={()=>setMode('replace')}/> Substituir o cardápio publicado da loja selecionada</label>
    {mode==='replace'&&<label className="mi-warning mi-check"><input type="checkbox" checked={replaceConfirm} onChange={e=>setReplaceConfirm(e.target.checked)}/>
     Confirmo que quero ocultar os produtos publicados atualmente. Os pedidos antigos e um registro de backup serão preservados.</label>}
    <label className="mi-check"><input type="checkbox" checked={allowMissing} onChange={e=>setAllowMissing(e.target.checked)}/>
     Se alguma foto não puder ser copiada, autorizo importar o produto sem aquela imagem.</label>
    <button type="button" disabled={!eligible} onClick={apply}>Importar e publicar {counts.products} produtos</button>
    <button type="button" className="secondary" disabled={!!phase} onClick={()=>{setItems([]);setZipImages(new Map());setWarnings([]);setError('');setNotice('Prévia descartada. Nada foi modificado.')}}>Descartar prévia</button>
   </div>
  </>}
  <div className="mi-panel">
   <h4>Importações recentes</h4>
   {history.length?history.map(h=><p className="mi-history" key={h.id}>
    <strong>{new Date(h.created_at).toLocaleString('pt-BR')}</strong> · {h.mode==='replace'?'Substituição':'Adição'} ·
    {h.summary?.created||0} novos produtos · {h.summary?.archived||0} arquivados</p>)
    :<p className="mi-hint">Nenhuma importação concluída ainda.</p>}
   <small>Links sem acesso público, cardápios com login e páginas sem dados de produtos podem não permitir importação por URL. Nesses casos, utilize a exportação CSV ou JSON do seu sistema anterior.</small>
  </div>
 </section>;
}
