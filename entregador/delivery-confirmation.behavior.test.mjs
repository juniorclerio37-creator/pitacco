import test from "node:test";
import assert from "node:assert/strict";
import {showDeliveryFinish,showArrivalConfirmation} from "./delivery-confirmation.mjs";

class FakeElement {
 constructor(tag){
  this.tagName=tag;this.children=[];this.parent=null;this.attributes={};
  this.listeners={};this.className="";this.textContent="";this.disabled=false;
  this.hidden=false;this.open=false;this.dataset={};this.value="";
  this.classList={add:(...names)=>{this.className=[...new Set([...this.className.split(/\s+/).filter(Boolean),...names])].join(" ")}};
 }
 setAttribute(name,value){this.attributes[name]=String(value);if(name==="id")this.id=String(value)}
 append(...children){
  for(const child of children){
   if(child.parent)child.parent.children=child.parent.children.filter(x=>x!==child);
   this.children.push(child);child.parent=this;
  }
 }
 replaceChildren(...children){
  for(const child of this.children)child.parent=null;
  this.children=[];this.append(...children);
 }
 addEventListener(name,fn){(this.listeners[name]??=[]).push(fn)}
 async emit(name,event={}){
  for(const fn of this.listeners[name]||[])await fn({...event,
   preventDefault:()=>{},target:this,currentTarget:this});
 }
 remove(){
  if(this.parent)this.parent.children=this.parent.children.filter(x=>x!==this);
  this.parent=null;
 }
 close(){this.open=false;for(const fn of this.listeners.close||[])fn({})}
 showModal(){this.open=true}
 focus(){globalThis.document.activeElement=this}
 querySelector(selector){return find(this,selector)}
 querySelectorAll(selector){const out=[];function walk(node){
  for(const c of node.children){if(matches(c,selector))out.push(c);walk(c)}
 }walk(this);return out}
}
function matches(node,selector){
 if(selector==="button")return node.tagName==="button";
 if(selector.startsWith("."))return node.className.split(/\s+/).includes(selector.slice(1));
 if(selector.startsWith("#"))return node.id===selector.slice(1);
 return node.tagName===selector;
}
function find(node,selector){return node.querySelectorAll(selector)[0]||null}
function textOf(node){return [node.textContent,...node.children.map(textOf)].join(" ")}
function buttonWith(root,label){return root.querySelectorAll("button").find(x=>x.textContent===label)}
function setup(){
 const body=new FakeElement("body");
 globalThis.document={body,activeElement:null,
  createElement:tag=>new FakeElement(tag)};
 globalThis.window={PitaccoPush:undefined,location:{assign:()=>{}}};
 Object.defineProperty(globalThis,"navigator",{configurable:true,value:{clipboard:{writeText:async()=>{}}}});
 return body;
}
const order={id:"order-1",source:"proprio",public_number:"4587"};
const paid={state:"paid",received_by_courier:true,method:"Dinheiro",amount:42.50};
test("COD requires verified server receipt before revealing PIN, then server code validation",async()=>{
 const body=setup();
 let payments=0,codes=0;
 showDeliveryFinish({delivery:order,
  payment:{state:"collect",method:"Dinheiro",amount:42.5,change_for:50,change_due:7.5},
  onConfirmPayment:async()=>{payments++;return paid;},
  onVerifyCode:async code=>{codes++;return code==="123456";}
 });
 const dlg=find(body,"#deliveryFinishDialog");
 assert.ok(dlg?.open);
 assert.match(textOf(dlg),/Confirmar recebimento/);
 assert.match(textOf(dlg),/R\$[\s\u00a0]*42,50/);
 assert.equal(find(dlg,".verify-input"),null,"PIN must not be requested before paying");
 assert.equal(codes,0);
 await buttonWith(dlg,"Sim, recebi").emit("click");
 assert.equal(payments,1);
 assert.match(textOf(dlg),/Confirmar entrega/);
 const input=find(dlg,".verify-input");
 assert.ok(input,"PIN appears after a verified receipt; modal="+textOf(dlg));
 input.value="123456";await input.emit("input");
 const form=find(dlg,".delivery-sheet-code-form");
 await form.emit("submit");
 assert.equal(codes,1);
 assert.match(textOf(dlg),/Entrega concluída!/);
 await buttonWith(dlg,"Fechar").emit("click");
 assert.equal(find(body,"#deliveryFinishDialog"),null);
});
test("declined or failed receipt cannot bypass payment and cannot complete",async()=>{
 const body=setup();let codes=0;
 showDeliveryFinish({delivery:order,
  payment:{state:"collect",method:"Cartão na entrega",amount:35.90},
  onConfirmPayment:async()=>({state:"collect",received_by_courier:false}),
  onVerifyCode:async()=>{codes++;return true;}
 });
 const dlg=find(body,"#deliveryFinishDialog");
 await buttonWith(dlg,"Sim, recebi").emit("click");
 assert.equal(find(dlg,".verify-input"),null);
 assert.match(textOf(dlg),/O recebimento não foi confirmado/);
 assert.equal(codes,0);
 await buttonWith(dlg,"Não, voltar").emit("click");
 assert.equal(find(body,"#deliveryFinishDialog"),null);
});
test("prepaid order opens code modal directly; wrong PIN does not claim delivery",async()=>{
 const body=setup();
 let received=0,attempts=0;
 showDeliveryFinish({delivery:order,
  payment:{state:"paid",method:"Online",amount:45},
  onConfirmPayment:async()=>{received++;return paid;},
  onVerifyCode:async()=>{attempts++;return false;}
 });
 const dlg=find(body,"#deliveryFinishDialog");
 assert.ok(find(dlg,".verify-input"));
 assert.equal(received,0);
 const input=find(dlg,".verify-input");input.value="123456";await input.emit("input");
 await find(dlg,".delivery-sheet-code-form").emit("submit");
 assert.equal(attempts,1);
 assert.doesNotMatch(textOf(dlg),/Entrega concluída!/);
 assert.match(textOf(dlg),/Código não confirmado/);
 await buttonWith(dlg,"Cancelar").emit("click");
});
test("arrival is not written before explicit confirmation",async()=>{
 const body=setup();let count=0;
 const promise=showArrivalConfirmation({delivery:order,
  onConfirm:async()=>{count++;return true;}
 });
 const dlg=find(body,"#deliveryFinishDialog");
 assert.equal(count,0);
 assert.match(textOf(dlg),/Cheguei na entrega/);
 await buttonWith(dlg,"Confirmar chegada").emit("click");
 assert.equal(await promise,true);
 assert.equal(count,1);
 assert.equal(find(body,"#deliveryFinishDialog"),null);
});
test("unhomologated marketplace cannot display or verify fabricated code",async()=>{
 const body=setup();let calls=0;
 showDeliveryFinish({delivery:{...order,source:"99food"},payment:{state:"paid"},
  onConfirmPayment:async()=>{calls++;return paid;},
  onVerifyCode:async()=>{calls++;return true;}
 });
 const dlg=find(body,"#deliveryFinishDialog");
 assert.match(textOf(dlg),/Confirmação indisponível/);
 assert.equal(find(dlg,".verify-input"),null);
 assert.equal(calls,0);
 await buttonWith(dlg,"Voltar").emit("click");
});


test("merchant configured four-digit PIN uses exactly four visual cells",async()=>{
 const body=setup();let codes=0;
 showDeliveryFinish({delivery:{...order,code_length:4},
  payment:{state:"paid",method:"Online",amount:24},
  onConfirmPayment:async()=>{throw Error("Already paid")},
  onVerifyCode:async code=>{codes++;return code==="1234";}
 });
 const dlg=find(body,"#deliveryFinishDialog");
 const pin=find(dlg,".delivery-sheet-pin-input");
 assert.equal(pin.maxLength,4);
 assert.equal(find(dlg,".delivery-sheet-pin-cells").children.length,4);
 pin.value="1234";await pin.emit("input");
 await find(dlg,".delivery-sheet-code-form").emit("submit");
 assert.equal(codes,1);
 assert.match(textOf(dlg),/Entrega concluída!/);
 await buttonWith(dlg,"Fechar").emit("click");
});
test("iFood requires four digits, and its rejected code appears red without completing",async()=>{
 const body=setup();let queries=0;
 showDeliveryFinish({delivery:{...order,source:"ifood"},
  payment:{state:"paid",method:"Online",amount:24},
  onConfirmPayment:async()=>{throw Error("Already paid")},
  onVerifyCode:async code=>{
   queries++;
   const msg=find(body,".verify-error");
   msg.textContent="Código incorreto";msg.hidden=false;
   return false;
  }
 });
 const dlg=find(body,"#deliveryFinishDialog");
 const pin=find(dlg,".delivery-sheet-pin-input");
 assert.equal(pin.maxLength,4);
 assert.match(pin.placeholder,/4 dígitos/);
 pin.value="1234";await pin.emit("input");
 await find(dlg,".delivery-sheet-code-form").emit("submit");
 assert.equal(queries,1);
 assert.equal(find(dlg,".verify-error").textContent,"Código incorreto");
 assert.equal(pin.attributes["aria-invalid"],"true");
 assert.doesNotMatch(textOf(dlg),/Entrega concluída!/);
 await buttonWith(dlg,"Cancelar").emit("click");
});
