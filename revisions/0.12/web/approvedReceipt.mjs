// Text-only thermal receipt: no remote assets, scripts or unverified payment claims.
const clean=x=>String(x??'').replace(/[\x00-\x1f\x7f]/g,' ').replace(/\s+/g,' ').trim();
const cash=x=>Number(x||0).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
const amount=x=>Number(String(x??0).replace(',','.'))||0;
const wrap=(s,w)=>{const out=[];let line='';for(const word of clean(s).split(' ')){if((line+' '+word).trim().length>w){if(line)out.push(line);line=word}else line=(line+' '+word).trim()}if(line)out.push(line);return out};
export function approvedReceipt(job,width=80,opts={}){
 const r=job?.receipt;if(!r||typeof r!=='object')return null;
 const n=width===58?30:44, lines=[],rule='-'.repeat(n);
 const add=(x='')=>lines.push(...(x?wrap(x,n):['']));
 const heading=x=>{add();add(rule);add(x);add(rule);add()};
 const store=opts.storeName||r.store_name||r.company_name||r.store?.name||'';
 if(store)add(store.toUpperCase());
 if(opts.showWhatsapp&&opts.whatsapp)add('WhatsApp: '+opts.whatsapp);
 add(rule);add('PEDIDO '+clean(r.display_number||r.external_order_number||r.order_number||r.display_id||r.number||job.order_id?.slice(0,8)||''));
 add('Origem: '+clean(r.source||'Cardapio proprio'));
 add('Data: '+clean(r.created_at||r.date||''));
 heading('CLIENTE');
 add(clean(r.customer_name||r.customer?.name||r.customer||'Nao informado'));
 if(r.phone||r.customer_phone)add('Telefone: '+clean(r.phone||r.customer_phone));
 if(r.address||r.delivery_address)add('Endereco: '+clean(typeof(r.address||r.delivery_address)==='string'?(r.address||r.delivery_address):JSON.stringify(r.address||r.delivery_address)));
 if(r.reference)add('Referencia: '+clean(r.reference));
 heading('ITENS');
 for(const item of Array.isArray(r.items)?r.items:[]){
  const qty=amount(item.quantity??item.qty??1);
  add(qty+' x '+clean(item.name||item.title||'Produto')+(item.total!=null?'  '+cash(item.total):''));
  const mods=[...(Array.isArray(item.options)?item.options:[]),...(Array.isArray(item.complements)?item.complements:[]),...(Array.isArray(item.additions)?item.additions:[])];
  for(const m of mods)add('   '+amount(m.quantity??m.qty??1)+'x '+clean(m.name||m.title||m.label));
  if(item.notes)add('Obs: '+clean(item.notes));
  add();
 }
 if(r.notes){add('OBSERVACOES');add(r.notes);add()}
 add(rule);
 if(r.subtotal!=null)add('Subtotal: '+cash(r.subtotal));
 if(r.delivery_fee!=null)add('Entrega: '+cash(r.delivery_fee));
 if(r.service_fee!=null)add('Servico: '+cash(r.service_fee));
 if(r.discount!=null)add('Desconto: -'+cash(r.discount));
 const total=amount(r.total??r.total_amount);
 add('TOTAL: '+cash(total));add(rule);
 const method=clean(r.payment_method||r.payment||r.payment_type||'Nao informado');
 add('Pagamento: '+method);
 // Only explicit confirmation authorizes a PAID message.
 const paid=r.payment_confirmed===true||r.payment_status==='paid'||r.paid===true;
 if(paid)add('*** PAGO - NAO COBRAR ***');
 else {add('*** COBRAR NA ENTREGA ***');
  if(/dinheiro|cash/i.test(method)){
   const given=amount(r.change_for??r.cash_given??r.troco_para);
   if(given>0){add('Troco para: '+cash(given));add('TROCO: '+cash(Math.max(0,given-total)))}
  }
 }
 add();add('Impresso por Pitacco Gestao de Delivery');add();add();
 return lines.join('\n');
}
