import {money} from "./payment-ui.mjs";
import {courierActionStage} from "./delivery-flow.mjs";

// Um teste interno de FCM não é pedido comercial, não tem cliente real nem PIN.
// Identificação restrita evita ocultar pedidos legítimos com dados incompletos.
export function isNotificationDiagnostic(delivery){
 return delivery?.source==="proprio" &&
  delivery.order_id==null &&
  /^PITACCO_FCM_DIAG_[0-9]{8}_[0-9]+$/.test(String(delivery.notes||"")) &&
  /^TESTE INTERNO PITACCO\b/.test(String(delivery.customer_name||"")) &&
  /^SEM DESTINO\s*[—–-]\s*TESTE DE NOTIFICAÇÃO\b/.test(String(delivery.address||""));
}

export function deliveryBucket(delivery){
 if(!delivery || ["entregue","cancelada"].includes(delivery.status))return "terminal";
 return courierActionStage(delivery)==="collect"?"coleta":"andamento";
}
export function paymentChipInfo(payment){
 const p=payment||{state:"unknown",method:"Não informada",amount:null};
 const method=String(p.method||"Não informada");
 const name=method.toLocaleLowerCase("pt-BR");
 const collect=p.state==="collect",paid=p.state==="paid";
 const card=/cartão|cartao|crédito|credito|débito|debito|maquininha/.test(name);
 const cash=/dinheiro|cash/.test(name);
 return {
  tone:p.state==="no_collect"?"paid":paid?"paid":collect?"collect":"unknown",
  label:p.state==="no_collect"?"Sem cobrança na entrega":paid?"Pago"+(name==="online"?" (Online)":""):collect
   ?card?"Cartão na entrega":cash?"Dinheiro na entrega":"A cobrar":"Pagamento a verificar",
  hint:p.state==="no_collect"?"Não cobrar o cliente":collect?(card?"Leve a maquininha":cash?"Leve o troco":method):paid?method:"Confira com a loja",
  value:p.amount!=null&&Number.isFinite(Number(p.amount))?money(p.amount):null,
  icon:p.state==="no_collect"?"✓":paid?"✓":card?"▤":cash?"R$":"!"
 };
}
function node(tag,cls,value){
 const e=document.createElement(tag);
 if(cls)e.className=cls;
 if(value!==undefined)e.textContent=String(value);
 return e;
}
export function compactPaymentChip(payment){
 const info=paymentChipInfo(payment);
 const box=node("div","compact-payment-chip compact-payment-"+info.tone);
 box.setAttribute("aria-label","Pagamento: "+info.label+(info.value?" "+info.value:""));
 box.append(node("span","compact-payment-icon",info.icon));
 const copy=node("div","compact-payment-copy");
 copy.append(node("strong","",info.label),node("small","",info.hint));
 if(info.value)copy.append(node("b","compact-payment-total",info.value));
 box.append(copy);
 return box;
}
export function safeFinishedToday(row,today){
 if(row?.status!=="entregue")return false;
 const t=row.finished_at||row.completed_at;
 if(!t)return false;
 const date=new Date(t);
 if(!Number.isFinite(date.getTime()))return false;
 const parts=new Intl.DateTimeFormat("en-CA",{timeZone:"America/Sao_Paulo",year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(date);
 const key=Object.fromEntries(parts.map(p=>[p.type,p.value]));
 return key.year+"-"+key.month+"-"+key.day===today;
}
