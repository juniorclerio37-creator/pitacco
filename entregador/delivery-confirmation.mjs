import {money} from "./payment-ui.mjs";

let activeDialog=null;
function el(tag,cls,txt){
 const n=document.createElement(tag);
 if(cls)n.className=cls;
 if(txt!==undefined)n.textContent=String(txt);
 return n;
}
function icon(kind){
 const span=el("span","delivery-sheet-icon delivery-sheet-icon--"+kind);
 const figures={
  arrive:"⌖",paid:"✓",card:"▣",cash:"R$",code:"▣",done:"✓",warning:"!"
 };
 span.textContent=figures[kind]||"✓";
 span.setAttribute("aria-hidden","true");
 return span;
}
function sourceLabel(source){
 return ({proprio:"Pitacco",ifood:"iFood","99food":"99Food",keeta:"Keeta"})[source]||"Loja";
}
function paymentVariant(payment){
 const method=String(payment?.method||"").toLocaleLowerCase("pt-BR");
 return /dinheiro|cash|espécie/.test(method)?"cash":/cart[aã]o|maquininha|credit|debit|card/.test(method)?"card":"paid";
}
function modalBase(delivery,titleId){
 if(activeDialog)return null;
 const previous=document.activeElement;
 const dlg=el("dialog","pitacco-delivery-sheet");
 dlg.id="deliveryFinishDialog";
 dlg.dataset.deliveryId=String(delivery.id);
 dlg.setAttribute("aria-labelledby",titleId);
 dlg.setAttribute("aria-modal","true");
 const body=el("div","delivery-sheet-body");
 const drag=el("div","delivery-sheet-handle");
 drag.setAttribute("aria-hidden","true");
 const x=el("button","delivery-sheet-x","×");x.type="button";x.setAttribute("aria-label","Fechar janela");
 const content=el("div","delivery-sheet-content");
 const error=el("p","delivery-sheet-error","");
 error.setAttribute("role","alert");error.hidden=true;
 body.append(drag,x,content,error);
 dlg.append(body);
 document.body.append(dlg);
 activeDialog=dlg;
 let running=false,closed=false;
 const close=()=>{
  if(running||closed)return false;
  closed=true;
  if(dlg.open)dlg.close();
  dlg.remove();activeDialog=null;
  if(previous?.isConnected&&previous.focus)previous.focus({preventScroll:true});
  return true;
 };
 const setBusy=value=>{
  running=!!value;
  dlg.setAttribute("aria-busy",String(running));
  for(const b of dlg.querySelectorAll("button"))b.disabled=running;
 };
 const fail=msg=>{error.textContent=String(msg||"Não foi possível confirmar. Tente novamente.");error.hidden=false;};
 const clear=()=>{error.hidden=true;error.textContent="";};
 x.addEventListener("click",()=>close());
 dlg.addEventListener("cancel",event=>{event.preventDefault();close();});
 dlg.showModal();
 return {dlg,content,error,close,setBusy,fail,clear,isClosed:()=>closed,isRunning:()=>running};
}
function header(ctx,{kind,title,text,delivery}){
 ctx.content.replaceChildren();
 ctx.clear();
 const h=el("div","delivery-sheet-head");
 const pic=icon(kind);
 const titleEl=el("h2","delivery-sheet-title",title);
 titleEl.id="delivery-action-title";
 h.append(pic,titleEl,el("p","delivery-sheet-lead",text));
 const order=el("div","delivery-sheet-order");
 const badge=el("strong","",delivery?.public_number?"Pedido #"+delivery.public_number:"Pedido da loja");
 order.append(badge,el("span","",sourceLabel(delivery.source)));
 h.append(order);
 ctx.content.append(h);
}
function buttons(ctx,items){
 const bar=el("div","delivery-sheet-buttons");
 for(const item of items){
  const b=el("button","delivery-sheet-button "+(item.main?"is-primary":"is-secondary"),item.label);
  b.type="button";
  b.addEventListener("click",item.onClick);
  bar.append(b);
 }
 ctx.content.append(bar);
}
export async function showArrivalConfirmation({delivery,onConfirm}){
 const ctx=modalBase(delivery,"delivery-action-title");
 if(!ctx)return false;
 let resolve,settled=false;
 const outcome=new Promise(done=>{resolve=done;});
 const settle=value=>{if(!settled){settled=true;resolve(!!value);}};
 const close=success=>{
  if(ctx.isRunning())return;
  // Resolva antes do evento "close" (nativo ou imediato no WebView).
  settle(success);ctx.close();
 };
 // X e Voltar do Android nunca registram chegada.
 ctx.dlg.addEventListener("close",()=>settle(false),{once:true});
 header(ctx,{kind:"arrive",title:"Cheguei na entrega",
  text:"Confirme que você realmente chegou ao endereço do cliente. Esta chegada será registrada para a loja.",
  delivery});
 buttons(ctx,[
  {label:"Cancelar",onClick:()=>close(false)},
  {label:"Confirmar chegada",main:true,onClick:async()=>{
   if(ctx.isRunning())return;
   ctx.setBusy(true);
   try{
    if((await onConfirm())!==true)throw Error("O servidor não confirmou a chegada. Verifique a conexão.");
    // A confirmação não marca o pedido como concluído.
    ctx.setBusy(false);close(true);
   }catch(e){ctx.setBusy(false);ctx.fail(e?.message);}
  }}
 ]);
 return outcome;
}
function paymentDetails(ctx,payment){
 const wrap=el("div","delivery-sheet-payment");
 const method=String(payment?.method||"Forma não informada");
 const entries=[["Forma de pagamento",method]];
 if(payment.amount!=null)entries.push(["Valor a receber",money(payment.amount)]);
 if(paymentVariant(payment)==="cash"&&payment.change_for!=null){
  entries.push(["Troco para",money(payment.change_for)]);
  if(payment.change_due!=null)entries.push(["Troco a devolver",money(payment.change_due)]);
 }
 for(const [label,value]of entries){
  const row=el("div","delivery-sheet-payment-row");
  row.append(el("span","",label),el("strong","",value));
  wrap.append(row);
 }
 ctx.content.append(wrap);
}
function paymentStep(ctx,delivery,payment,{onConfirmPayment,onVerifyCode,onProviderRetry}){
 const kind=paymentVariant(payment);
 header(ctx,{kind,title:"Confirmar recebimento",
  text:kind==="card"?"Você recebeu o pagamento na maquininha? Confirme apenas se a transação foi realmente aprovada.":kind==="cash"
   ?"Você recebeu o valor em dinheiro e entregou o troco, quando necessário?":
   "Você recebeu o valor do cliente? Confirme somente após o recebimento.",
  delivery});
 paymentDetails(ctx,payment);
 const note=el("p","delivery-sheet-notice",
  "Este botão registra o recebimento declarado pelo entregador. Não aprova transações no banco ou na maquininha.");
 ctx.content.append(note);
 buttons(ctx,[
  {label:"Não, voltar",onClick:()=>ctx.close()},
  {label:"Sim, recebi",main:true,onClick:async()=>{
   if(ctx.isRunning())return;
   ctx.setBusy(true);
   try{
    const result=await onConfirmPayment();
    if(result?.state!=="paid"||result?.received_by_courier!==true)
     throw Error("O recebimento não foi confirmado no Pitacco. Tente novamente.");
    ctx.setBusy(false);
    codeStep(ctx,delivery,result,{onVerifyCode,onProviderRetry});
   }catch(e){ctx.setBusy(false);ctx.fail(e?.message||"Pagamento não confirmado. Tente novamente.");}
  }}
 ]);
}
function addPinInput(ctx,delivery){
 const own=delivery.source==="proprio";
 const configured=Number(delivery.code_length);
 const max=own&&Number.isInteger(configured)&&configured>=4&&configured<=8?configured:own?6:4;
 const wrap=el("div","delivery-sheet-pin-wrap");
 const input=el("input","verify-input delivery-sheet-pin-input");
 input.type="text";input.inputMode="numeric";input.autocomplete="one-time-code";
 input.maxLength=max;input.pattern="[0-9]{"+max+"}";
 input.setAttribute("aria-label",own?"Código Pitacco de "+max+" dígitos":"Código iFood de 4 dígitos");
 input.placeholder=own?"Código de "+max+" dígitos":"Código iFood (4 dígitos)";
 const error=el("p","verify-error","");
 error.hidden=true;error.setAttribute("role","status");error.setAttribute("aria-live","polite");
 error.id="verify-error-"+delivery.id;
 input.setAttribute("aria-describedby",error.id);
 input.setAttribute("aria-invalid","false");
 if(own){
  const cells=el("div","delivery-sheet-pin-cells");
  const spans=Array.from({length:max},()=>el("span","delivery-sheet-pin-cell","—"));
  for(const cell of spans)cells.append(cell);
  cells.setAttribute("style","grid-template-columns:repeat("+max+",minmax(0,1fr))");
  wrap.append(cells);
  wrap.classList.add("is-six-digit");
  wrap.addEventListener("click",()=>input.focus());
  const update=()=>{
   input.value=input.value.replace(/[^0-9]/g,"").slice(0,max);
   for(let i=0;i<max;i++)spans[i].textContent=input.value.charAt(i)||"—";
   error.hidden=true;input.setAttribute("aria-invalid","false");
  };
  input.addEventListener("input",update);update();
 }else{
  input.addEventListener("input",()=>{
   input.value=input.value.replace(/[^0-9]/g,"").slice(0,4);
   error.hidden=true;input.setAttribute("aria-invalid","false");
  });
 }
 wrap.append(input,error);
 ctx.content.append(wrap);
 return input;
}
function addIfoodFallback(ctx,onProviderRetry){
 const wrap=el("details","delivery-sheet-ifood-help");
 wrap.append(el("summary","","Não conseguiu validar pelo código?"));
 const note=el("p","","Use a confirmação oficial do iFood. O pedido só será concluído após a validação do provedor.");
 const officialUrl="https://confirmacao-entrega-propria.ifood.com.br/";
 const link=el("a","delivery-sheet-official","Abrir confirmação no iFood");
 link.href=officialUrl;
 link.target=window.PitaccoPush?.postMessage?"_self":"_blank";
 link.rel="noopener noreferrer";
 link.addEventListener("click",e=>{
  if(window.PitaccoPush?.postMessage){e.preventDefault();window.location.assign(officialUrl);}
 });
 const copy=el("button","delivery-sheet-copy","Copiar link para o navegador");copy.type="button";
 copy.addEventListener("click",async()=>{
  try{await navigator.clipboard.writeText(officialUrl);copy.textContent="Link copiado!";}
  catch{window.prompt("Copie o endereço e abra no navegador:",officialUrl);}
 });
 wrap.append(note,link,copy);
 if(typeof onProviderRetry==="function"){
  const retry=el("button","delivery-sheet-copy","Tentar avisar iFood da chegada");
  retry.type="button";
  retry.addEventListener("click",async()=>{
   try{await onProviderRetry();retry.textContent="Solicitação enviada";}catch(e){ctx.fail(e.message);}
  });
  wrap.append(retry);
 }
 ctx.content.append(wrap);
}
function successStep(ctx,delivery){
 header(ctx,{kind:"done",title:"Entrega concluída!",
  text:"Pedido finalizado com sucesso e atualizado no Pitacco. O ganho é contabilizado conforme os valores configurados pela loja.",
  delivery});
 const yes=el("div","delivery-sheet-success","✓ Entrega registrada no sistema do lojista");
 ctx.content.append(yes);
 buttons(ctx,[{label:"Fechar",main:true,onClick:()=>ctx.close()}]);
}
function codeStep(ctx,delivery,payment,{onVerifyCode,onProviderRetry}){
 if(!["proprio","ifood"].includes(delivery.source)){
  header(ctx,{kind:"warning",title:"Confirmação indisponível",
   text:"A verificação oficial do código desta plataforma ainda está em homologação. A entrega não será concluída manualmente.",
   delivery});
  buttons(ctx,[{label:"Voltar",main:true,onClick:()=>ctx.close()}]);
  return;
 }
 header(ctx,{kind:"code",title:"Confirmar entrega",
  text:delivery.source==="proprio"
    ?"Digite o código de "+Number(delivery.code_length||6)+" dígitos informado pelo cliente."
    :"Digite o código de 4 dígitos do iFood. Ele será validado diretamente no iFood.",
  delivery});
 if(payment?.state==="unknown")ctx.content.append(
  el("p","delivery-sheet-warning","Pagamento sem confirmação no Pitacco. Confira a situação com a loja antes de concluir."));
 const input=addPinInput(ctx,delivery);
 const form=el("form","delivery-sheet-code-form");form.noValidate=true;
 // Move the input and the visual pin slots into the real form.
 const pin=ctx.content.querySelector(".delivery-sheet-pin-wrap");
 form.append(pin);
 const bar=el("div","delivery-sheet-buttons");
 const cancel=el("button","delivery-sheet-button is-secondary","Cancelar");
 cancel.type="button";cancel.addEventListener("click",()=>ctx.close());
 const finish=el("button","delivery-sheet-button is-primary","Finalizar entrega");
 finish.type="submit";
 bar.append(cancel,finish);form.append(bar);
 form.addEventListener("submit",async event=>{
  event.preventDefault();
  if(ctx.isRunning())return;
  const digits=input.value.trim();
  const expected=delivery.source==="proprio"?Number(delivery.code_length||6):4;
  const valid=/^[0-9]+$/.test(digits)&&digits.length===expected;
  if(!valid){
   const msg="Informe o código de "+expected+" dígitos.";
   const error=ctx.content.querySelector(".verify-error");
   if(error){error.textContent=msg;error.hidden=false;}
   else ctx.fail(msg);
   input.setAttribute("aria-invalid","true");return;
  }
  ctx.setBusy(true);ctx.clear();
  try{
   if((await onVerifyCode(digits))!==true){
    const notice=ctx.content.querySelector(".verify-error");
    throw Error(notice&&!notice.hidden?notice.textContent:"Código não confirmado. Confira e tente novamente.");
   }
   input.value="";ctx.setBusy(false);successStep(ctx,delivery);
  }catch(err){
   ctx.setBusy(false);
   const pinError=ctx.content.querySelector(".verify-error");
   if(pinError&&!pinError.hidden){input.setAttribute("aria-invalid","true");return;}
   ctx.fail(err?.message||"Não foi possível validar o código.");
  }
 });
 ctx.content.append(form);
 if(delivery.source==="ifood")addIfoodFallback(ctx,onProviderRetry);
 // Open the keyboard only after the sheet is visible.
 input.focus({preventScroll:true});
}
export function showDeliveryFinish({delivery,payment,onConfirmPayment,onVerifyCode,onProviderRetry}){
 const ctx=modalBase(delivery,"delivery-action-title");
 if(!ctx)return false;
 const args={onConfirmPayment,onVerifyCode,onProviderRetry};
 if(payment?.state==="collect")paymentStep(ctx,delivery,payment,args);
 else codeStep(ctx,delivery,payment,args);
 return true;
}
