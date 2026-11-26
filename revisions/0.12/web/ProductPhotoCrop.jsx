import React,{useEffect,useRef,useState} from 'react';
import {Crop} from 'lucide-react';
/** Non-destructive opt-in crop: preview a selected region and emit a new file only on confirmation. */
export default function ProductPhotoCrop({source,disabled,onApply}){
 const [open,setOpen]=useState(false),[rect,setRect]=useState({left:0,top:0,right:0,bottom:0}),[ready,setReady]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const image=useRef(null),canvas=useRef(null),generation=useRef(0);
 useEffect(()=>{setOpen(false);setReady(false);setError('');generation.current++},[source]);
 useEffect(()=>{
  if(!open||!source)return;
  let live=true;const img=new window.Image();img.crossOrigin='anonymous';setReady(false);setError('');
  img.onload=()=>{if(live){image.current=img;setReady(true)}};
  img.onerror=()=>{if(live)setError('Não foi possível preparar esta imagem para recorte. Envie a foto original para editar.');};
  img.src=source;return()=>{live=false;image.current=null};
 },[source,open]);
 function bounds(){const img=image.current;if(!img)return null;const x=Math.floor(img.naturalWidth*rect.left/100),y=Math.floor(img.naturalHeight*rect.top/100);return {x,y,w:Math.max(1,Math.floor(img.naturalWidth*(100-rect.right)/100)-x),h:Math.max(1,Math.floor(img.naturalHeight*(100-rect.bottom)/100)-y)}}
 function draw(target,limit){const img=image.current,b=bounds();if(!img||!b||!target)return;const scale=Math.min(1,limit/Math.max(b.w,b.h));target.width=Math.max(1,Math.round(b.w*scale));target.height=Math.max(1,Math.round(b.h*scale));const ctx=target.getContext('2d');ctx.clearRect(0,0,target.width,target.height);ctx.drawImage(img,b.x,b.y,b.w,b.h,0,0,target.width,target.height)}
 useEffect(()=>{if(open&&ready)draw(canvas.current,640)},[open,ready,rect]);
 function adjust(key,value){const opposite={left:'right',right:'left',top:'bottom',bottom:'top'}[key];setRect(r=>({...r,[key]:Math.min(Number(value),90-r[opposite])}))}
 async function apply(){
  if(!ready||busy)return;
  setBusy(true);setError('');const token=++generation.current;
  try{
   const out=document.createElement('canvas');draw(out,2000);
   const blob=await new Promise((resolve,reject)=>{try{out.toBlob(b=>b?resolve(b):reject(Error('Não foi possível gerar o recorte.')),'image/webp',.94)}catch(e){reject(e)}});
   if(blob.size>5*1024*1024)throw Error('Recorte acima de 5 MB. Reduza a área ou envie uma imagem menor.');
   if(token!==generation.current)return;
   onApply(new File([blob],'foto-recortada.'+(blob.type==='image/webp'?'webp':'png'),{type:blob.type}));setOpen(false);
  }catch(e){if(token===generation.current)setError(e.message||'Não foi possível recortar a imagem.');}finally{setBusy(false)}
 }
 if(!source)return null;
 return <div className="product-photo-crop"><p className="catalog-hint">A foto é exibida inteira por padrão. Recorte somente se desejar.</p>
 {!open?<button type="button" className="secondary" disabled={disabled} onClick={()=>{setRect({left:0,top:0,right:0,bottom:0});setOpen(true)}}><Crop size={17}/> Ajustar recorte</button>:<>
 <div className="product-crop-previews"><div><b>Original</b><img src={source} alt="Foto original completa"/></div><div><b>Prévia do recorte</b><canvas ref={canvas} aria-label="Prévia do recorte"/></div></div>
 <div className="catalog-inline-fields">{[['left','Esquerda'],['right','Direita'],['top','Superior'],['bottom','Inferior']].map(([key,label])=><label key={key}>{label}: {rect[key]}%<input type="range" min="0" max="80" step="1" disabled={!ready||busy} value={rect[key]} onChange={e=>adjust(key,e.target.value)}/></label>)}</div>
 {error&&<p role="alert" className="catalog-error">{error}</p>}
 <div className="catalog-actions"><button type="button" disabled={!ready||busy||!Object.values(rect).some(Boolean)} onClick={apply}>Aplicar recorte à foto</button><button type="button" className="secondary" disabled={busy} onClick={()=>setRect({left:0,top:0,right:0,bottom:0})}>Restaurar enquadramento</button><button type="button" className="secondary" disabled={busy} onClick={()=>setOpen(false)}>Cancelar recorte</button></div>
 <small>A imagem original não será apagada. Salve o produto para publicar a nova foto.</small></>}
 </div>
}
