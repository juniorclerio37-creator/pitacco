// Resumo financeiro do pedido para o motoboy. O servidor autoriza a leitura
// e a gravação; a interface nunca afirma pagamento apenas pelo clique local.
export const money=v=>Number(v??0).toLocaleString("pt-BR",{style:"currency",currency:"BRL"});
function node(tag,cls,text){
 const n=document.createElement(tag);
 if(cls)n.className=cls;if(text!==undefined)n.textContent=String(text);
 return n;
}
export function paymentSummaryPanel(payment){
 const p=payment||{state:"unknown",method:"Não informada",amount:null};
 const kind=["paid","collect"].includes(p.state)?p.state:"unknown";
 const shell=node("section","card-payment card-payment--"+kind);
 shell.setAttribute("aria-label","Status do pagamento");
 const heading=node("div","card-payment-heading");
 const left=node("div","");
 left.append(node("small","card-payment-eyebrow","PAGAMENTO"));
 left.append(node("strong","card-payment-title",kind==="paid"
  ?p.received_by_courier?"Recebido pelo entregador":"Pago"
  :kind==="collect"?"Cobrar na entrega":"Pagamento a verificar"));
 const badge=node("span","card-payment-badge",kind==="paid"?"✓ PAGO":kind==="collect"?"● A COBRAR":"! CONFERIR");
 heading.append(left,badge);shell.append(heading);
 const line=node("div","card-payment-line");
 line.append(node("span","",p.method||"Não informada"));
 if(p.amount!=null&&Number.isFinite(Number(p.amount)))
  line.append(node("strong","",money(p.amount)));
 shell.append(line);
 if(kind==="collect"&&p.change_for!=null){
  shell.append(node("p","card-payment-change","Troco para "+money(p.change_for)+
    " · devolver "+money(p.change_due)));
 }
 if(kind==="unknown")shell.append(node("p","card-payment-alert",
  "Pagamento sem confirmação disponível. Confira com a loja antes de entregar."));
 return shell;
}
export function courierCollectStep(payment,onConfirm){
 const box=node("section","courier-collect-step");
 box.append(node("small","courier-step-label","PRÓXIMA AÇÃO"));
 box.append(node("strong","courier-step-title","Cobrar pagamento"));
 box.append(node("p","courier-step-copy","Receba "+money(payment.amount)+" em "+
  (payment.method||"forma informada pela loja")+" antes de finalizar."));
 if(payment.change_for!=null)box.append(node("p","card-payment-change",
  "Troco para "+money(payment.change_for)+" · devolver "+money(payment.change_due)));
 const open=node("button","btn primary courier-collect-open","Cobrar pagamento");
 open.type="button";box.append(open);
 const confirmation=node("div","courier-collect-confirm");confirmation.hidden=true;
 confirmation.append(node("p","","Confirme somente depois que o cliente efetivamente pagar. A loja verá este registro."));
 const actions=node("div","courier-collect-actions");
 const yes=node("button","btn primary","Confirmar pagamento recebido");yes.type="button";
 yes.addEventListener("click",async()=>{yes.disabled=true;try{await onConfirm()}finally{yes.disabled=false;}});
 const back=node("button","btn ghost","Voltar");back.type="button";
 back.addEventListener("click",()=>{confirmation.hidden=true;open.hidden=false;});
 actions.append(yes,back);confirmation.append(actions);box.append(confirmation);
 open.addEventListener("click",()=>{open.hidden=true;confirmation.hidden=false;});
 return box;
}
