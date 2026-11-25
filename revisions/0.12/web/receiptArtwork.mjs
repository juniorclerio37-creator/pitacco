import {scheduleInfo} from './scheduleInfo.mjs';
import {clean,amount,cash,first,platformName,deliveryAddress,isPaid,collectionAtDelivery} from './approvedReceipt.mjs';
import {receiptQrMatrix,receiptMenuMessage} from './receiptMenuQr.mjs';
import {receiptLogoDimensions,monochromeLogo,drawReceiptPlatformMark} from './receiptBranding.mjs';
export const receiptFontSize=value=>['small','medium','large'].includes(value)?value:'medium';
export function receiptPayment(r){
 const raw=first(r.payment_method,typeof r.payment==='string'?r.payment:r.payment?.method,r.payment_type);
 const m=raw.toLowerCase();
 const method=/^(cash|cod|dinheiro)$/.test(m)?'Dinheiro':/^(pix_manual|pix)$/.test(m)?'Pix':/^(card_on_delivery|cartao_entrega|cartao_na_entrega)$/.test(m)?'Cartão na entrega':raw||'Não informado';
 const total=Math.round(amount(r.total??r.total_amount)*100);
 if(m==='fiado')return {state:'no_collect',method:'Sem cobrança na entrega',total};
 if(isPaid(r)||r.courier_collection?.received===true||['pago','aprovado'].includes(clean(r.payment_status).toLowerCase()))return {state:'paid',method,total,online:r.payment_online===true||r.paid_online===true||/online|gateway|marketplace|pré.pago|prepaid/i.test(first(r.payment_timing,r.payment_when,r.payment_channel))};
 if(!collectionAtDelivery(r,method))return {state:'unknown',method,total};
 const due=Math.round(amount(r.amount_to_collect??r.amount_due??total/100)*100);
 if(due<=0)return {state:'unknown',method,total};
 const legacy=String(r.notes||'').match(/(?:^|\s)Troco para:\s*R\$\s*([0-9]{1,7}(?:[.,][0-9]{1,2})?)\s*$/i);
 const provided=r.change_for??r.cash_given??r.troco_para??legacy?.[1];
 const given=provided==null?null:Math.round(amount(provided)*100);
 return {state:'collect',method,total,due,given:method==='Dinheiro'&&given!==null&&given>=due?given:null,change:method==='Dinheiro'&&given!==null&&given>=due?given-due:null,invalidChange:method==='Dinheiro'&&given!==null&&given<due};
}
export function renderReceiptCanvas(job,width=80,opts={},makeCanvas=()=>document.createElement('canvas')){
 const r=job?.receipt;if(!r||typeof r!=='object')throw Error('Dados da comanda indisponíveis');
 const w=Number(width)===58?384:576, base={small:21,medium:25,large:30}[receiptFontSize(opts.fontSize)], pad=12, right=w-pad, inner=w-2*pad;
 const canvas=makeCanvas();canvas.width=w;canvas.height=1;const ctx=canvas.getContext('2d');if(!ctx)throw Error('Não foi possível preparar a impressão gráfica');
 const ops=[];let y=pad;
 const font=(size,bold)=> (bold?'700 ':'400 ')+size+'px Arial, sans-serif';
 const measure=(s,size,bold)=>{ctx.font=font(size,bold);return ctx.measureText(s).width};
 const split=(value,max,size,bold)=>{
  let out=[],line='';
  for(const word of clean(value).split(' ')){
   if(!word)continue;
   if(line&&measure(line+' '+word,size,bold)<=max){line+=' '+word;continue}
   if(line){out.push(line);line=''}
   for(const ch of word){if(line&&measure(line+ch,size,bold)>max){out.push(line);line=''}line+=ch}
  }
  if(line)out.push(line);return out.length?out:[''];
 };
 function txt(value,x,top,size=base,bold=false,align='left',color='#000'){ops.push(c=>{c.fillStyle=color;c.font=font(size,bold);c.textBaseline='top';c.textAlign=align;c.fillText(value,x,top)});}
 const lh=size=>Math.ceil(size*1.30);
 function lines(value,{x=pad,max=right-x,size=base,bold=false,align='left',color='#000'}={}){for(const s of split(value,max,size,bold)){txt(s,align==='center'?x+max/2:align==='right'?x+max:x,y,size,bold,align,color);y+=lh(size)}}
 function rule(){y+=5;const top=y;ops.push(c=>{c.fillStyle='#000';c.fillRect(pad,top,inner,2)});y+=9}
 function box(top,h,filled){ops.push(c=>{c.beginPath();c.roundRect(pad,top,inner,h,7);if(filled){c.fillStyle='#000';c.fill()}else{c.strokeStyle='#000';c.lineWidth=3;c.stroke()}})}
 function banner(value,size=base+5,filled=true){y+=4;const arr=split(value,inner-20,size,true),top=y,h=arr.length*lh(size)+14;box(top,h,filled);y+=7;for(const s of arr){txt(s,w/2,y,size,true,'center',filled?'#fff':'#000');y+=lh(size)}y=top+h+8}
 function pair(label,value,bold=false,size=base,x=pad){
  const v=clean(value);if(!v){lines(label,{x,max:right-x,size,bold});return}
  const vw=measure(v,size,true),available=right-x;
  if(vw+Math.max(size*4,48)>available){lines(label,{x,max:available,size,bold});lines(v,{x,max:available,size,bold:true,align:'right'});return}
  const arr=split(label,available-vw-12,size,bold),top=y;
  arr.forEach(s=>{txt(s,x,y,size,bold);y+=lh(size)});txt(v,right,top,size,true,'right');
 }
 const icon=(kind,x,top,size)=>ops.push(c=>{const s=size/24;c.save();c.translate(x,top);c.scale(s,s);c.strokeStyle='#000';c.lineWidth=1.8;c.lineCap='round';c.lineJoin='round';c.beginPath();if(kind==='person'){c.arc(12,6,4,0,Math.PI*2);c.moveTo(4,22);c.lineTo(4,19);c.quadraticCurveTo(4,12,12,12);c.quadraticCurveTo(20,12,20,19);c.lineTo(20,22);c.closePath()}else if(kind==='pin'){c.moveTo(12,23);c.bezierCurveTo(-6,7,4,0,12,0);c.bezierCurveTo(20,0,30,7,12,23);c.moveTo(16,8);c.arc(12,8,4,0,Math.PI*2)}else{c.roundRect(3,7,18,15,2);c.moveTo(8,7);c.lineTo(8,5);c.quadraticCurveTo(12,-1,16,5);c.lineTo(16,7)}c.stroke();c.restore()});
 if(opts.printLogo===true&&opts.logoImage){
  try{
   const dims=receiptLogoDimensions(opts.logoImage.naturalWidth||opts.logoImage.width,opts.logoImage.naturalHeight||opts.logoImage.height,width,opts.logoSize);
   const logo=monochromeLogo(opts.logoImage,dims,makeCanvas);
   if(logo){const top=y,left=Math.floor((w-logo.width)/2);ops.push(c=>c.drawImage(logo,left,top));y+=logo.height+10;}
  }catch{/* A missing or unreadable logo never blocks an order print. */}
 }
 const store=first(opts.storeName,r.store_name,r.company_name,r.store?.name);
 if(store)lines(store.toUpperCase(),{size:base+9,bold:true,align:'center'});
 if(job.test===true)banner('TESTE DE IMPRESSÃO — SEM VALIDADE',base,true);
 const subtitle=first(r.store_tagline,r.store?.tagline);if(subtitle)lines(subtitle,{align:'center'});
 const shopPhone=first(opts.whatsapp,r.store_phone,r.store?.phone);if(shopPhone&&opts.showWhatsapp!==false)lines(shopPhone,{align:'center'});
 const platform=platformName(first(r.platform,r.marketplace,r.source,job.platform,job.source));
 const number=platform==='Loja'?first(r.display_number,r.order_number,r.number,r.display_id,r.external_order_number,job.order_id?.slice(0,8)):first(r.external_order_number,r.marketplace_order_number,r.original_order_number,r.order_number,r.display_number,r.number,job.order_id?.slice(0,8));
 if(opts.platformIcon!==false){
  const size=base+7, markSize=Math.max(46,base+20), inset=pad+markSize+22, insetWidth=right-inset-8;
  const arr=split(platform+' Nº '+(number||'Não informado'),insetWidth-14,size,true);
  const top=y+4,h=Math.max(markSize+16,arr.length*lh(size)+16);
  box(top,h,true);
  ops.push(c=>drawReceiptPlatformMark(c,platform,pad+8,top+(h-markSize)/2,markSize));
  ops.push(c=>{c.fillStyle='#fff';c.beginPath();c.roundRect(inset,top+5,insetWidth,h-10,5);c.fill()});
  let yy=top+(h-arr.length*lh(size))/2;
  for(const line of arr){txt(line,inset+insetWidth/2,yy,size,true,'center');yy+=lh(size)}
  y=top+h+8;
 }else banner(platform+' Nº '+(number||'Não informado'),base+7);
 const schedule=scheduleInfo(r);if(schedule){banner('PEDIDO AGENDADO',base+6);lines('Modalidade: '+schedule.modality,{bold:true});lines('Data/hora: '+schedule.when,{bold:true});if(schedule.release)lines('Início do preparo: '+schedule.release,{bold:true});banner('PRODUÇÃO CONFORME AGENDAMENTO',base,false);}
 const operation=/retirada|pickup|balc[aã]o|takeaway/i.test(first(r.fulfillment_type,r.order_type,r.delivery_type,r.logistics))?'RETIRADA':'ENTREGA';
 lines(operation,{bold:true,align:'center'});
 const stamp=first(r.created_at,r.date,job.created_at);if(stamp){const d=new Date(stamp);const date=/^\d{4}-\d{2}-\d{2}T/.test(stamp)&&Number.isFinite(d.getTime())?d.toLocaleString('pt-BR',{timeZone:'America/Sao_Paulo',dateStyle:'short',timeStyle:'short'}):stamp;lines(date,{align:'center'})}
 rule();icon('person',pad,y,base+6);const infoX=pad+base+16;
 lines('Cliente: '+first(r.customer_name,r.customer?.name,typeof r.customer==='string'?r.customer:'','Não informado'),{x:infoX,bold:true});
 const phone=first(r.phone,r.customer_phone,r.customer?.phone,r.buyer?.phone,r.delivery?.customer_phone);if(opts.phone!==false&&phone)lines('Telefone: '+phone,{x:infoX});
 const loc=first(r.localizer,r.localizador,r.locator,r.order_locator,r.delivery_locator,r.external_locator,r.pickup_locator);if(loc)lines('Localizador: '+loc,{x:infoX,bold:true});
 const address=deliveryAddress(r.address||r.delivery_address||r.customer?.address||r.delivery?.address);
 if(opts.address!==false&&(address||r.reference)){rule();icon('pin',pad,y,base+6);if(address)lines('Endereço: '+address,{x:infoX,bold:true});if(r.reference)lines('Referência: '+clean(r.reference),{x:infoX})}
 const provider=first(r.delivery_provider,r.logistics_provider,r.fulfillment_provider);if(provider)lines('Entrega por: '+provider);
 const eta=first(r.delivery_eta,r.delivery_estimate,r.estimated_delivery);if(eta)lines('Previsão: '+eta);
 rule();banner('QTD / DESCRIÇÃO / VALOR',base,true);
 let count=0;
 for(const item of Array.isArray(r.items)?r.items:[]){
  if(!item||typeof item!=='object')continue;
  const qty=amount(item.quantity??item.qty??1)||1;count+=qty;
  const total=item.total??item.total_price??item.price_total??(item.unit_total!=null?amount(item.unit_total)*qty:null);
  pair(qty+'x '+first(item.name,item.title,'Produto'),total==null?'':cash(total),true);
  const options=[...(Array.isArray(item.options)?item.options:[]),...(Array.isArray(item.complements)?item.complements:[]),...(Array.isArray(item.additions)?item.additions:[]),...(Array.isArray(item.modifiers)?item.modifiers:[])];
  function modifier(v,depth=0,context=options){if(depth>5)return;const mod=typeof v==='string'?{name:v}:v;if(!mod||typeof mod!=='object')return;const name=first(mod.name,mod.title,mod.label,mod.option?.name),price=mod.total??mod.total_price??mod.price;const x=pad+Math.min(depth+1,3)*10;
   const pizza=context.some(o=>o?.group==='Sabor'&&Number.isInteger(o.denominator));
   const fraction=pizza&&mod.group==='Sabor'&&Number.isInteger(mod.numerator)&&Number.isInteger(mod.denominator)&&mod.numerator>0&&mod.denominator>=mod.numerator;
   const pizzaPart=pizza&&['Tamanho','Borda','Massa','Adicional'].includes(mod.group);
   const label=fraction?'Sabor '+mod.numerator+'/'+mod.denominator+': '+name:pizzaPart?mod.group+': '+name:(amount(mod.quantity??mod.qty??1)||1)+'x '+name;
   if(name)pair('– '+label,price==null||amount(price)===0||fraction||pizzaPart?'':cash(price),false,base,x);
   for(const child of Array.isArray(mod.options)?mod.options:[])modifier(child,depth+1,mod.options);
  }
  if(opts.complements!==false)options.forEach(v=>modifier(v));
  if(opts.notes!==false&&item.notes)lines('Obs.: '+clean(item.notes),{bold:true});
  y+=7;
 }
 const notes=String(r.notes||'').replace(/(?:^|\s)Troco para:\s*R\$\s*[0-9]{1,7}(?:[.,][0-9]{1,2})?\s*$/i,'').trim();
 if(opts.notes!==false&&notes){rule();lines('OBSERVAÇÕES',{bold:true});lines(notes)}
 rule();pair('Quantidade de itens:',String(count));
 if(r.subtotal!=null)pair('Subtotal dos itens:',cash(r.subtotal));
 if(r.delivery_fee!=null)pair('Valor da entrega:',cash(r.delivery_fee));
 if(r.service_fee!=null)pair('Taxa de serviço:',cash(r.service_fee));
 if(r.discount!=null&&amount(r.discount)!==0)pair('Desconto:','– '+cash(Math.abs(amount(r.discount))));
 const pay=receiptPayment(r);
 banner('TOTAL: '+cash(pay.total/100),base+8);
 if(pay.state==='no_collect'){banner('NÃO COBRAR NA ENTREGA',base+4,false)}
 else if(pay.state==='paid'){lines('Forma de pagamento: '+pay.method,{bold:true});banner(pay.online?'PAGO ONLINE':'PEDIDO PAGO',base+5,false);lines('NÃO COBRAR NA ENTREGA',{bold:true,align:'center'})}
 else if(pay.state==='collect'){lines('Forma de pagamento: '+pay.method,{bold:true});banner('COBRAR NA ENTREGA',base+4,false);pair('Valor a cobrar:',cash(pay.due/100),true);if(pay.method==='Dinheiro'){if(pay.given!==null){pair('Cliente entregará:',cash(pay.given/100));banner('TROCO: '+cash(pay.change/100),base+5,false)}else lines(pay.invalidChange?'Conferir valor informado para troco.':'Troco não solicitado.',{bold:true})}}
 else{lines('Forma de pagamento: '+pay.method);banner('PAGAMENTO A CONFERIR',base+3,false)}
 if(opts.menuQr===true&&opts.menuUrl){
  let matrix=null;try{matrix=receiptQrMatrix(opts.menuUrl)}catch{}
  if(matrix){
   rule();lines('PEÇA PELO NOSSO CARDÁPIO',{bold:true,align:'center',size:base+2});
   lines(receiptMenuMessage(opts.menuMessage),{align:'center'});
   // Integer printer dots, minimum 4 quiet modules, 6 dots per module (about 34 mm).
   const module=6,quiet=4,side=(matrix.length+quiet*2)*module,left=Math.floor((w-side)/2),top=y+5;
   ops.push(c=>{c.fillStyle='#fff';c.fillRect(left,top,side,side);c.fillStyle='#000';matrix.forEach((row,yy)=>row.forEach((dark,xx)=>{if(dark)c.fillRect(left+(xx+quiet)*module,top+(yy+quiet)*module,module,module)}))});
   y=top+side+5; // The menu address is encoded in the QR; do not print it as text.
  }
 }
 rule();lines('Cupom não fiscal',{align:'center'});lines('Impresso por Pitacco',{bold:true,align:'center'});
 if(y+pad>16000)throw Error('Comanda muito longa para impressão gráfica; confira os itens.');
 canvas.height=Math.ceil(y+pad);ctx.fillStyle='#fff';ctx.fillRect(0,0,w,canvas.height);for(const op of ops)op(ctx);return canvas;
}
export function rasterReceipt(job,width,opts,makeCanvas){
 const canvas=renderReceiptCanvas(job,width,opts,makeCanvas),w=canvas.width,h=canvas.height;
 const rgba=canvas.getContext('2d').getImageData(0,0,w,h).data;
 const bytes=new Uint8Array(w/8*h);
 for(let y=0;y<h;y++)for(let x=0;x<w;x++){const i=(y*w+x)*4;if(rgba[i]+rgba[i+1]+rgba[i+2]<480)bytes[y*w/8+(x>>3)]|=128>>(x&7)}
 let raw='';for(let i=0;i<bytes.length;i+=8192)raw+=String.fromCharCode(...bytes.subarray(i,i+8192));
 return 'PITACCO_RASTER_V1:'+w+':'+h+':'+btoa(raw);
}
