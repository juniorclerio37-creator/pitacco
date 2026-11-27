import {rasterReceipt} from './receiptArtwork.mjs';
import {readPrintPreferences} from './printPreferences.mjs';
import {loadReceiptMenuUrl} from './receiptMenuQr.mjs';
import {loadReceiptLogo} from './receiptBranding.mjs';
import {approvedReceipt} from './approvedReceipt.mjs';
/** Transport-only bridge. Acceptance and print identities are issued by the server. */
export function nativeAvailable(){return typeof window !== 'undefined' && !!window.__TAURI__?.core?.invoke;}
export function invoke(command,args){if(!nativeAvailable())return Promise.reject(new Error('Disponível no aplicativo Windows.'));return window.__TAURI__.core.invoke(command,args);}
const clean=value=>String(value??'').replace(/[\x00-\x1f\x7f]/g,' ').slice(0,4000);
const money=value=>Number(value||0).toFixed(2).replace('.',',');
export function receiptText(job){
 const r=job.receipt||{}, columns=Number(job.width)===58?32:48;
 const options=typeof localStorage!=='undefined'&&job.store_id?JSON.parse(localStorage.getItem('pitacco:print-options:'+job.store_id)||'{}'):{};
 const formatted=approvedReceipt(job,Number(job.width)===58?58:80,options);
 if(formatted)return formatted;
 if(typeof job.receipt_text==='string')return job.receipt_text.split('\n').flatMap(line=>{const text=clean(line),out=[];for(let i=0;i<text.length;i+=columns)out.push(text.slice(i,i+columns));return out.length?out:[''];}).join('\n')+'\n\n';
 const lines=['DELIVERYGESTOR',`Pedido: ${clean(r.number||r.order_number||r.order_id||job.order_id)}`,`Origem: ${clean(r.source)}`,`Aceito: ${clean(r.accepted_at)}`,`Setor: ${clean(job.sector)} | Via ${job.copy_no||1}`];
 if(r.reprint)lines.push('*** REIMPRESSAO ***');
 lines.push('-'.repeat(columns),`Cliente: ${clean(r.customer||r.customer_name)}`);
 for(const item of Array.isArray(r.items)?r.items:[]){lines.push(`${clean(item.quantity)} x ${clean(item.name)} R$ ${money(item.unit_price)}`);for(const extra of Array.isArray(item.modifiers)?item.modifiers:[])lines.push(` + ${clean(extra)}`);}
 if(r.notes)lines.push(`OBS: ${clean(r.notes)}`);
 lines.push('-'.repeat(columns),`Total: R$ ${money(r.total)}`,`Desconto: R$ ${money(r.discount)}`,`Pagamento: ${clean(r.payment||r.payment_method)} ${clean(r.payment_status)}`,`Logistica: ${clean(r.logistics||r.logistics_provider)}`);
 if(r.address)lines.push(`Endereco: ${clean(r.address)}`);
 if(r.reference)lines.push(`Referencia: ${clean(r.reference)}`);
 // Only the explicit fields above are printed. Secret delivery codes/raw payloads are never serialized.
 return lines.flatMap(line=>{const out=[];for(let i=0;i<line.length;i+=columns)out.push(line.slice(i,i+columns));return out.length?out:[''];}).join('\n')+'\n\n';
}
export async function ingestJobs({jobs,device,call,ack,storeName,client,storeLogoPath}){
 const menuUrls=new Map();
 for(const job of jobs){
  const identity={id:job.id,storeId:job.store_id,printer:job.printer,width:Number(job.width)};
  if(await call('has_saved_print_job',identity)===true){
   await ack({p_job:job.id,p_device:device,p_state:'saved',p_error:null});
   continue;
  }
  const preferences=readPrintPreferences(job.store_id);
  if(preferences.menuQr===true&&!menuUrls.has(job.store_id))menuUrls.set(job.store_id,await loadReceiptMenuUrl(client,job.store_id));
  const menuUrl=preferences.menuQr===true?menuUrls.get(job.store_id):'';
  const logoImage=preferences.printLogo===true?await loadReceiptLogo(client,job.store_id,storeLogoPath):null;
  try{await call('enqueue_job',{job:{id:job.id,store_id:job.store_id,printer:job.printer,width:job.width,receipt:typeof document!=='undefined'&&job.receipt?rasterReceipt(job,job.width,{...preferences,storeName,menuUrl,logoImage}):receiptText(job)}});}
  catch(error){
   // A concurrent replay may have won the durable write. Never replace or resend the first receipt.
   if(await call('has_saved_print_job',identity)!==true)throw error;
  }
  // ACK after the native SQLite transaction succeeds; replay uses the same UUID.
  await ack({p_job:job.id,p_device:device,p_state:'saved',p_error:null});
 }
}
