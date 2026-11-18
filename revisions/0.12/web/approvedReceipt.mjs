// Pitacco thermal receipt — one professional default for every establishment.
// The same plain-text output powers native Windows ESC/POS and browser printing.
// Keep all merchant data tenant-scoped at the caller. Never infer that a payment is paid.
const clean=value=>String(value??'').replace(/[\x00-\x1f\x7f]/g,' ').replace(/\s+/g,' ').trim();
const amount=value=>{
 if(typeof value==='number')return Number.isFinite(value)?value:0;
 const raw=clean(value).replace(/[^\d,.-]/g,'');
 const normalized=raw.includes(',')?raw.replace(/\./g,'').replace(',','.'):raw;
 const parsed=Number(normalized);
 return Number.isFinite(parsed)?parsed:0;
};
const cash=value=>amount(value).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
const first=(...values)=>values.map(clean).find(Boolean)||'';
const wrap=(value,width)=>{
 const words=clean(value).split(' ').filter(Boolean),result=[];
 let current='';
 for(let word of words){
  while(word.length>width){
   if(current){result.push(current);current='';}
   result.push(word.slice(0,width));word=word.slice(width);
  }
  if(!word)continue;
  if(current&&current.length+1+word.length>width){result.push(current);current=word;}
  else current=current?current+' '+word:word;
 }
 if(current)result.push(current);
 return result;
};
const platformName=value=>{
 const origin=clean(value).toLowerCase().replace(/\s+/g,'');
 if(/99food|99-food|^99$/.test(origin))return '99Food';
 if(origin.includes('ifood'))return 'iFood';
 if(origin.includes('keeta'))return 'Keeta';
 if(/^(own|proprio|próprio|propria|própria|loja|cardapio|cardápio|web|direct|balcao|balcão|counter|site)$/.test(origin)||!origin)return 'Loja';
 return clean(value);
};
const deliveryAddress=value=>{
 if(typeof value==='string')return clean(value);
 if(!value||typeof value!=='object')return '';
 const street=first(value.street,value.street_name,value.logradouro,value.address,value.line1,value.rua);
 const number=first(value.number,value.numero);
 const unit=first(value.complement,value.complemento,value.line2);
 const district=first(value.neighborhood,value.bairro);
 const city=first(value.city,value.cidade);
 const state=first(value.state,value.uf);
 const zip=first(value.zip,value.zip_code,value.cep);
 const main=[street,number].filter(Boolean).join(', ');
 return [main,unit,district,[city,state].filter(Boolean).join('/'),zip].filter(Boolean).join(' - ');
};
const isPaid=receipt=>{
 const status=clean(receipt.payment_status||receipt.payment?.status).toLowerCase();
 return receipt.payment_confirmed===true||receipt.paid===true||receipt.is_paid===true||
 ['paid','approved','captured','confirmed','settled'].includes(status);
};
const collectionAtDelivery=(receipt,method)=>{
 const timing=clean(first(receipt.payment_timing,receipt.payment_when,receipt.payment_location,receipt.payment_channel)).toLowerCase();
 if(receipt.payment_on_delivery===true||receipt.collect_on_delivery===true)return true;
 if(receipt.payment_on_delivery===false||receipt.collect_on_delivery===false)return false;
 if(/entrega|delivery|cash.on.delivery|offline|on.arrival/.test(timing))return true;
 if(/dinheiro|cash|na entrega/.test(method.toLowerCase()))return true;
 return false;
};

export function approvedReceipt(job,width=80,opts={}){
 const r=job?.receipt;
 if(!r||typeof r!=='object')return null;
 const n=Number(width)===58?30:44;
 const lines=[],rule='-'.repeat(n),doubleRule='='.repeat(n);
 const add=value=>{
  if(value==null||value===''){lines.push('');return;}
  lines.push(...wrap(value,n));
 };
 const center=value=>{
  for(const text of wrap(value,n))lines.push(' '.repeat(Math.max(0,Math.floor((n-text.length)/2)))+text);
 };
 const pair=(label,value)=>{
  const left=clean(label),right=clean(value);
  if(left.length+right.length+1<=n){
   lines.push(left+' '.repeat(n-left.length-right.length)+right);
  }else{
   add(left);add('  '+right);
  }
 };
 const store=first(opts.storeName,r.store_name,r.company_name,r.store?.name);
 if(store){center(store);if(opts.showWhatsapp&&opts.whatsapp)center('WhatsApp: '+opts.whatsapp);}
 center('CUPOM NAO FISCAL');
 lines.push(rule);
 const platform=platformName(first(r.platform,r.marketplace,r.source,job.platform,job.source));
 const number=platform==='Loja'?
  first(r.display_number,r.order_number,r.number,r.display_id,r.external_order_number,job.order_id?.slice(0,8)):
  first(r.external_order_number,r.marketplace_order_number,r.original_order_number,r.order_number,r.display_number,r.number,job.order_id?.slice(0,8));
 const operation=first(r.fulfillment_type,r.order_type,r.delivery_type);
 center(/retirada|pickup|balc[aã]o/i.test(operation)?'RETIRADA':'ENTREGA');
 center(platform+' Nº '+(number||'Nao informado'));
 lines.push(doubleRule);
 if(r.created_at||r.date||job.created_at)add('Criado em: '+first(r.created_at,r.date,job.created_at));
 add('Cliente: '+first(r.customer_name,r.customer?.name,typeof r.customer==='string'?r.customer:'','Nao informado'));
 const phone=first(r.phone,r.customer_phone,r.customer?.phone,r.buyer?.phone,r.delivery?.customer_phone);
 if(opts.phone!==false&&phone)add('Telefone: '+phone);
 const locator=first(r.localizer,r.localizador,r.locator,r.order_locator,r.delivery_locator,r.external_locator,r.pickup_locator);
 if(locator)add('Localizador: '+locator);
 const address=deliveryAddress(r.address||r.delivery_address||r.customer?.address||r.delivery?.address);
 if(opts.address!==false&&address)add('Endereco: '+address);
 if(opts.address!==false&&r.reference)add('Referencia: '+clean(r.reference));
 const courier=first(r.delivery_provider,r.logistics_provider,r.fulfillment_provider);
 if(courier)add('Entrega por: '+courier);
 lines.push(rule);
 add('ITENS');
 lines.push(rule);
 for(const item of Array.isArray(r.items)?r.items:[]){
  if(!item||typeof item!=='object')continue;
  const qty=amount(item.quantity??item.qty??1)||1;
  const name=first(item.name,item.title,'Produto');
  const total=item.total??item.total_price??item.price_total;
  if(total!=null)pair(qty+'x '+name,cash(total));
  else add(qty+'x '+name);
  const options=[
   ...(Array.isArray(item.options)?item.options:[]),
   ...(Array.isArray(item.complements)?item.complements:[]),
   ...(Array.isArray(item.additions)?item.additions:[]),
   ...(Array.isArray(item.modifiers)?item.modifiers:[])
  ];
  if(opts.complements!==false)for(const option of options){
   const mod=typeof option==='string'?{name:option,quantity:1}:option;
   if(!mod||typeof mod!=='object')continue;
   const modName=first(mod.name,mod.title,mod.label,mod.option?.name);
   if(modName){
    const description='  '+(amount(mod.quantity??mod.qty??1)||1)+'x '+modName;
    const price=mod.total??mod.total_price??mod.price;
    if(price!=null)pair(description,cash(price));
    else add(description);
   }
   for(const nested of Array.isArray(mod.options)?mod.options:[]){
    const child=typeof nested==='string'?{name:nested}:nested;
    if(child&&typeof child==='object'){
     const childName=first(child.name,child.title,child.label);
     if(childName)add('    '+(amount(child.quantity??child.qty??1)||1)+'x '+childName);
    }
   }
  }
  if(opts.notes!==false&&item.notes)add('Obs: '+clean(item.notes));
  add();
 }
 if(opts.notes!==false&&r.notes){add('OBSERVACOES: '+clean(r.notes));add();}
 lines.push(rule);
 if(r.subtotal!=null)pair('Subtotal:',cash(r.subtotal));
 if(r.delivery_fee!=null)pair('Valor da entrega:',cash(r.delivery_fee));
 if(r.service_fee!=null)pair('Taxa de servico:',cash(r.service_fee));
 if(r.discount!=null)pair('Desconto:','-'+cash(Math.abs(amount(r.discount))));
 const total=amount(r.total??r.total_amount);
 lines.push(doubleRule);
 pair('TOTAL:',cash(total));
 lines.push(doubleRule);
 const rawMethod=r.payment_method??(typeof r.payment==='string'?r.payment:r.payment?.method)??r.payment_type;
 const method=first(rawMethod,'Nao informado');
 add('Forma de pagamento: '+method);
 if(isPaid(r)){
  const online=r.payment_online===true||r.paid_online===true||
   /online|gateway|marketplace|pré.pago|prepaid/i.test(first(r.payment_timing,r.payment_when,r.payment_channel))||
   !collectionAtDelivery(r,method);
  add(online?'*** PAGO ONLINE ***':'*** PEDIDO PAGO ***');
  add('NAO COBRAR NA ENTREGA');
 }else if(collectionAtDelivery(r,method)){
  lines.push(doubleRule);
  center('COBRAR NA ENTREGA');
  pair('Valor a cobrar:',cash(r.amount_to_collect??r.amount_due??total));
  if(/dinheiro|cash/i.test(method)){
   const given=amount(r.change_for??r.cash_given??r.troco_para);
   if(given>0){
    pair('Troco para:',cash(given));
    pair('TROCO:',cash(Math.max(0,given-amount(r.amount_to_collect??r.amount_due??total))));
   }
  }
  lines.push(doubleRule);
 }else{
  center('PAGAMENTO A CONFERIR');
  add('Nao marcar como pago sem confirmacao.');
 }
 add();
 center('Impresso por Pitacco');
 center('Gestao de Delivery');
 add();
 return lines.join('\n');
}
