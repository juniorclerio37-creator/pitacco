// Only the registered logo from this store's existing Pitacco media folder.
export function validReceiptLogoPath(storeId,path){
 return typeof storeId==='string'&&/^[a-f0-9-]{36}$/i.test(storeId)&&typeof path==='string'&&path.startsWith('stores/'+storeId+'/')&&/^[a-z0-9_-]+\.(png|jpe?g|webp)$/i.test(path.slice(('stores/'+storeId+'/').length));
}
export const receiptLogoSize=value=>['small','medium','large'].includes(value)?value:'medium';
export function receiptLogoDimensions(width,height,paperWidth,size){
 if(!Number.isFinite(width)||!Number.isFinite(height)||width<=0||height<=0)return null;
 const w=Number(paperWidth)===58?384:576;
 const bound={small:[.38,84],medium:[.53,128],large:[.70,176]}[receiptLogoSize(size)];
 const scale=Math.min(w*bound[0]/width,bound[1]/height);
 return {width:Math.max(1,Math.round(width*scale)),height:Math.max(1,Math.round(height*scale))};
}
export function monochromeLogo(image,dimensions,makeCanvas=()=>document.createElement('canvas')){
 if(!image||!dimensions)return null;
 const c=makeCanvas();c.width=dimensions.width;c.height=dimensions.height;
 const ctx=c.getContext('2d',{willReadFrequently:true});if(!ctx)return null;
 ctx.fillStyle='#fff';ctx.fillRect(0,0,c.width,c.height);ctx.drawImage(image,0,0,c.width,c.height);
 const pixels=ctx.getImageData(0,0,c.width,c.height),data=pixels.data;
 // Ordered dithering at the printer's native dot resolution, retaining light-colored detail.
 const bayer=[[0,8,2,10],[12,4,14,6],[3,11,1,9],[15,7,13,5]];
 let dark=0;
 for(let y=0;y<c.height;y++)for(let x=0;x<c.width;x++){
  const i=(y*c.width+x)*4,lum=.2126*data[i]+.7152*data[i+1]+.0722*data[i+2];
  const threshold=24+(bayer[y%4][x%4]+.5)*13;
  const v=lum<threshold?0:255;if(v===0)dark++;
  data[i]=data[i+1]=data[i+2]=v;data[i+3]=255;
 }
 if(!dark)return null;ctx.putImageData(pixels,0,0);return c;
}
const cache=new Map();
export async function loadReceiptLogo(client,storeId,path){
 if(!client||!validReceiptLogoPath(storeId,path)||typeof document==='undefined')return null;
 const key=storeId+'|'+path;if(cache.has(key))return cache.get(key);
 let timer;
 const load=(async()=>{
  const {data}=client.storage.from('pitacco-media').getPublicUrl(path);
  if(!data?.publicUrl)return null;
  const image=new Image();image.crossOrigin='anonymous';image.decoding='async';
  return await new Promise(resolve=>{image.onload=()=>resolve(image.naturalWidth>0&&image.naturalHeight>0&&image.naturalWidth<=8192&&image.naturalHeight<=8192?image:null);image.onerror=()=>resolve(null);image.src=data.publicUrl;});
 })().catch(()=>null);
 const promise=Promise.race([load,new Promise(resolve=>{timer=setTimeout(()=>resolve(null),2500)})]).then(result=>{clearTimeout(timer);if(!result)cache.delete(key);return result;});
 if(cache.size>=16)cache.delete(cache.keys().next().value);cache.set(key,promise);return promise;
}
export function receiptPlatformMark(platform){
 return {'iFood':'ifood','99Food':'99food','Keeta':'keeta','Loja':'store'}[platform]||'other';
}
// Offline monochrome identification marks; names stay visible even when icons are disabled.
export function drawReceiptPlatformMark(ctx,platform,x,y,size){
 const kind=receiptPlatformMark(platform);
 ctx.save();ctx.translate(x,y);ctx.scale(size/48,size/48);ctx.fillStyle='#fff';ctx.strokeStyle='#fff';ctx.lineWidth=2.5;ctx.lineCap='round';ctx.lineJoin='round';
 if(kind==='ifood'||kind==='99food'||kind==='keeta'){
  ctx.textAlign='center';ctx.textBaseline='middle';
  ctx.font=kind==='ifood'?'italic 700 17px Arial, sans-serif':'700 30px Arial, sans-serif';
  ctx.fillText(kind==='ifood'?'iFood':kind==='99food'?'99':'K',24,kind==='ifood'?19:24);
  if(kind==='ifood'){ctx.beginPath();ctx.moveTo(13,31);ctx.quadraticCurveTo(24,40,35,29);ctx.stroke();}
  if(kind==='99food'){ctx.beginPath();ctx.roundRect(3,3,42,42,10);ctx.stroke();}
 }else{
  ctx.beginPath();ctx.moveTo(5,19);ctx.lineTo(10,7);ctx.lineTo(38,7);ctx.lineTo(43,19);ctx.lineTo(5,19);ctx.stroke();
  ctx.beginPath();ctx.moveTo(7,20);ctx.lineTo(7,42);ctx.lineTo(41,42);ctx.lineTo(41,20);ctx.moveTo(19,42);ctx.lineTo(19,28);ctx.lineTo(29,28);ctx.lineTo(29,42);ctx.moveTo(17,8);ctx.lineTo(15,19);ctx.moveTo(31,8);ctx.lineTo(33,19);ctx.stroke();
 }
 ctx.restore();
}
