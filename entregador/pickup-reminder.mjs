import {money} from "./payment-ui.mjs";

// O lembrete na COLETA não registra pagamento. Apenas o botão final executa
// a coleta existente, mantendo as integrações e validações do lojista.
export function pickupReminderType(payment) {
 if (payment?.state !== "collect") return null;
 const method=String(payment.method||"").toLocaleLowerCase("pt-BR");
 if (/dinheiro|cash|espécie/.test(method)) return "cash";
 if (/cart[aã]o|maquininha|credit|debit|card/.test(method)) return "card";
 return null;
}

const ICONS={
 card:'<svg viewBox="0 0 110 108" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><g transform="rotate(14 54 58)"><rect x="34" y="12" width="53" height="82" rx="10" fill="#29334b" stroke="#20293b" stroke-width="3"/><rect x="40" y="19" width="41" height="30" rx="5" fill="#c8eafb"/><path d="M55 26q9 8 0 16M62 23q14 11 0 22M48 30q4 4 0 8" fill="none" stroke="#446a87" stroke-width="2.6" stroke-linecap="round"/><g fill="#77849c"><rect x="42" y="55" width="10" height="9" rx="3"/><rect x="56" y="55" width="10" height="9" rx="3"/><rect x="70" y="55" width="10" height="9" rx="3"/><rect x="42" y="68" width="10" height="9" rx="3"/><rect x="56" y="68" width="10" height="9" rx="3"/></g><rect x="70" y="68" width="10" height="20" rx="3" fill="#ff8b19"/><rect x="42" y="81" width="24" height="8" rx="3" fill="#6d7c97"/></g><g stroke="#f47718" stroke-width="5" stroke-linecap="round"><path d="M89 11l3-9M99 21l9-4M98 31l10 1"/></g></svg>',
 cash:'<svg viewBox="0 0 110 108" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><g transform="rotate(-13 54 54)"><rect x="20" y="31" width="72" height="53" rx="6" fill="#2e993f" opacity=".45"/><rect x="18" y="25" width="76" height="55" rx="6" fill="#53bd4b" stroke="#2d983f" stroke-width="3"/><path d="M27 34h59v36H27z" fill="#80d46a"/><circle cx="56" cy="52" r="18" fill="#4bad40"/><text x="56" y="59" text-anchor="middle" fill="white" font-size="23" font-weight="900" font-family="Arial,sans-serif">R$</text><circle cx="27" cy="34" r="5" fill="#4bad40"/><circle cx="86" cy="34" r="5" fill="#4bad40"/><circle cx="27" cy="70" r="5" fill="#4bad40"/><circle cx="86" cy="70" r="5" fill="#4bad40"/></g><g stroke="#f47718" stroke-width="5" stroke-linecap="round"><path d="M90 14l4-11M99 24l10-3M99 34l10 3"/></g></svg>'
};
let activeDialog=null;
function el(tag,cls,text){
 const item=document.createElement(tag);
 if(cls)item.className=cls;
 if(text!==undefined)item.textContent=String(text);
 return item;
}
function dataRow(label,value,cls){
 const row=el("div","pickup-reminder-data-row");
 row.append(el("span","",label),el("strong",cls||"",value));
 return row;
}

export async function showPickupReminder(payment,onConfirm){
 const kind=pickupReminderType(payment);
 if(!kind||activeDialog)return false;
 const isCard=kind==="card";
 const dialog=el("dialog","pitacco-pickup-modal");
 dialog.setAttribute("aria-labelledby","pitacco-pickup-title");
 dialog.setAttribute("aria-describedby","pitacco-pickup-description");
 const content=el("div","pickup-reminder-body");
 const closeIcon=el("button","pickup-reminder-close","×");
 closeIcon.type="button";
 closeIcon.setAttribute("aria-label","Fechar lembrete sem coletar o pedido");
 const hero=el("div","pickup-reminder-hero pickup-reminder-hero--"+kind);
 hero.innerHTML=ICONS[kind]; // Ilustrações locais fixas, sem HTML externo
 const title=el("h2","pickup-reminder-title",isCard?"Leve a maquininha":"Leve o troco");
 title.id="pitacco-pickup-title";
 const desc=el("p","pickup-reminder-description",isCard
  ?"Este pedido será pago no cartão na entrega. Confira se você está com a maquininha antes de coletar o pedido."
  :"Este pedido será pago em dinheiro na entrega.");
 desc.id="pitacco-pickup-description";
 const summary=el("div","pickup-reminder-data");
 if(isCard){
  const cardRow=el("div","pickup-reminder-payment-method");
  const cardSvg=el("span","pickup-reminder-card-icon");
  cardSvg.innerHTML='<svg viewBox="0 0 26 24" fill="none" aria-hidden="true"><rect x="2" y="4" width="22" height="16" rx="3" stroke="currentColor" stroke-width="2"/><path d="M3 9h20M6 15h6" stroke="currentColor" stroke-width="2"/></svg>';
  const label=el("span","","Forma de pagamento: ");
  const value=el("strong","","Cartão na entrega");
  cardRow.append(cardSvg,label,value);summary.append(cardRow);
 }else{
  summary.append(dataRow("Valor a cobrar:",payment.amount!=null?money(payment.amount):"A confirmar","is-accent"));
  summary.append(dataRow("Troco para:",payment.change_for!=null?money(payment.change_for):"Não informado"));
  summary.append(dataRow("Troco necessário:",payment.change_for!=null&&payment.change_due!=null
   ?money(payment.change_due):"Confira com o cliente","is-accent"));
 }
 const buttons=el("div","pickup-reminder-buttons");
 const cancel=el("button","pickup-reminder-back","Voltar");cancel.type="button";
 const confirm=el("button","pickup-reminder-confirm",isCard?"Estou com a maquininha":"Troco conferido");
 confirm.type="button";
 const error=el("p","pickup-reminder-error","");
 error.setAttribute("role","alert");
 error.hidden=true;
 buttons.append(cancel,confirm);
 content.append(closeIcon,hero,title,desc,summary,error,buttons);
 dialog.append(content);
 document.body.append(dialog);
 activeDialog=dialog;
 let working=false,settled=false;
 const previousFocus=document.activeElement;
 let done;
 const result=new Promise(resolve=>{done=resolve});
 const finish=value=>{
  if(settled)return;
  settled=true;
  if(dialog.open)dialog.close();
  dialog.remove();
  activeDialog=null;
  if(previousFocus?.isConnected)previousFocus.focus({preventScroll:true});
  done(value);
 };
 cancel.addEventListener("click",()=>{if(!working)finish(false)});
 closeIcon.addEventListener("click",()=>{if(!working)finish(false)});
 dialog.addEventListener("cancel",event=>{event.preventDefault();if(!working)finish(false)});
 confirm.addEventListener("click",async()=>{
  if(working)return;
  working=true;confirm.disabled=true;cancel.disabled=true;closeIcon.disabled=true;
  confirm.textContent="Registrando coleta...";
  error.hidden=true;
  try{
   // A coleta e o despacho permanecem no fluxo original, depois do aceite.
   if((await onConfirm())===true){finish(true);return;}
   throw new Error("A coleta não foi confirmada. Confira a conexão e tente novamente.");
  }catch(e){
   error.textContent=String(e?.message||"Não foi possível registrar a coleta.");
   error.hidden=false;
  }finally{
   working=false;confirm.disabled=false;cancel.disabled=false;closeIcon.disabled=false;
   confirm.textContent=isCard?"Estou com a maquininha":"Troco conferido";
  }
 });
 dialog.showModal();
 confirm.focus({preventScroll:true});
 return result;
}
