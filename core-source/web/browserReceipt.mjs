import {approvedReceipt} from './approvedReceipt.mjs';

export const escapeReceiptHtml=value=>String(value??'').replace(/[&<>"']/g,c=>({
 '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
})[c]);

export function browserReceiptText(order,displayNumber,storeName=''){
 if(!order||!order.id||!order.receipt||!Array.isArray(order.receipt.items))throw Error('Dados do pedido indisponíveis para impressão.');
 const receipt={...order.receipt,
  scheduled_for:order.scheduled_for||order.receipt.scheduled_for,
  scheduled_release_at:order.scheduled_release_at||order.receipt.scheduled_release_at,
  display_number:displayNumber||order.receipt.display_number,
  store_name:storeName||order.receipt.store_name||'',
  source:order.source||order.receipt.source,
  created_at:order.created_at||order.receipt.created_at,
  total:order.receipt.total??order.gross,
  customer_name:order.receipt.customer_name||order.receipt.customer
 };
 const text=approvedReceipt({order_id:order.id,receipt},80);
 if(!text)throw Error('Não foi possível montar a comanda deste pedido.');
 return text;
}
export function browserReceiptHtml(text){
 return '<!doctype html><html lang="pt-BR"><head><meta charset="UTF-8"><title>Comanda Pitacco</title>'+
  '<style>@page{margin:4mm}body{margin:0;background:#fff;color:#000;font:12px/1.35 ui-monospace,Consolas,monospace}'+
  'main{max-width:80mm;margin:0 auto;padding:8px;box-sizing:border-box}pre{margin:0;white-space:pre-wrap;overflow-wrap:anywhere;font:inherit}'+
  '@media screen{body{padding:12px;background:#eee}main{background:white;box-shadow:0 2px 12px #999}}'+
  '</style></head><body><main><pre>'+escapeReceiptHtml(text)+'</pre></main></body></html>';
}
export function openBrowserPrint(order,displayNumber,storeName='',openTab=()=>window.open('','_blank','width=500,height=800')){
 // Abrir a janela durante o clique direto; não tentar localizar impressoras via JavaScript.
 const preview=openTab();
 if(!preview)throw Error('O navegador bloqueou a janela. Autorize pop-ups do Pitacco e tente novamente.');
 try{
  const text=browserReceiptText(order,displayNumber,storeName);
  preview.document.open();
  preview.document.write(browserReceiptHtml(text));
  preview.document.close();
  preview.focus();
  // O navegador/usuário escolhe a impressora. Nunca registrar o papel como impresso.
  preview.setTimeout(()=>preview.print(),200);
  return true;
 }catch(err){preview.close();throw err}
}
