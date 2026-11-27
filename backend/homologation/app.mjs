import {readCoreMenu,placeCoreOrder,recoverCoreOrder,readCoreSchedule} from './storefront.mjs';
import {readCoreTracking} from './tracking.mjs';
const slug='core-checkout-fixture';
const productId='91000000-0000-0000-0000-000000000003';
const $=id=>document.getElementById(id);
const money=n=>new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(n);
let product,pending,receipt,busy=false;
function message(t){$('status').textContent=t;}
function controls({submit=false,recover=false,retry=false}={}){
  $('submit').hidden=!submit;$('recover').hidden=!recover;$('retry').hidden=!retry;
  for(const id of ['submit','recover','retry'])$(id).disabled=busy;
}
function confirmed(data){
  const scheduled=Boolean(pending?.scheduled_for);
  receipt=data;pending=null;$('checkout').hidden=true;$('success').hidden=false;
  $('success-title').textContent=scheduled?'Pedido agendado enviado com sucesso':'Pedido confirmado!';
  $('scheduled-notice').hidden=!scheduled;
  $('receipt').textContent='Total confirmado: '+money(Number(data.total));message('Pedido de teste registrado.');
}
async function load(){
  const result=await readCoreMenu(slug);
  if(result.state!=='ready'){message('Cardápio de teste indisponível.');return;}
  product=result.data.products.find(p=>p.id===productId);
  if(!product||!Number.isFinite(Number(product.price))){message('Produto de teste indisponível.');return;}
  $('shop').textContent=result.data.store.name;
  $('product').textContent=product.name;$('price').textContent=money(Number(product.price));
  $('menu').hidden=false;message('Cardápio carregado.');
}
$('load-schedule').addEventListener('click',async()=>{
  if(busy||pending||receipt)return;
  busy=true;$('load-schedule').disabled=true;$('review').disabled=true;
  $('schedule').replaceChildren(new Option('Pedido imediato',''));
  const result=await readCoreSchedule(slug,'pickup');
  if(result.state==='ready'){
    const format=new Intl.DateTimeFormat('pt-BR',{dateStyle:'short',timeStyle:'short',timeZone:'America/Sao_Paulo'});
    for(const slot of result.data.slots)$('schedule').add(new Option(format.format(new Date(slot)),slot));
    message(result.data.slots.length?'Horários disponíveis.':'Nenhum horário disponível.');
  }else message('Não foi possível consultar os horários. Tente novamente.');
  busy=false;$('load-schedule').disabled=false;$('review').disabled=false;
});
$('review').addEventListener('click',()=>{
  if(pending||busy||receipt)return;
  const quantity=Number($('quantity').value);
  if(!Number.isInteger(quantity)||quantity<1||quantity>5){message('Quantidade inválida.');return;}
  pending=Object.freeze({request_id:crypto.randomUUID(),customer:'Cliente Navegador Fixture',phone:'21988882222',items:[{product_id:productId,quantity,options:[]}],fulfillment:'pickup',payment:'pix_manual',...($('schedule').value?{scheduled_for:$('schedule').value}:{})});
  $('summary').textContent=quantity+' × '+product.name+' · estimativa '+money(quantity*Number(product.price))+(pending.scheduled_for?' · '+$('schedule').selectedOptions[0].text:'');
  $('menu').hidden=true;$('checkout').hidden=false;controls({submit:true});
});
async function send(){
  if(busy||!pending)return;
  busy=true;controls();message('Enviando pedido…');
  const result=await placeCoreOrder(slug,pending);
  busy=false;
  if(result.state==='confirmed'){confirmed(result.data);return;}
  message('Confirmação não recebida. Recupere o pedido antes de reenviar.');
  controls({recover:true});
}
$('submit').addEventListener('click',send);
$('retry').addEventListener('click',send);
$('recover').addEventListener('click',async()=>{
  if(busy||!pending)return;
  busy=true;controls();message('Consultando confirmação…');
  const result=await recoverCoreOrder(slug,pending.request_id);
  busy=false;
  if(result.state==='confirmed'){confirmed(result.data);return;}
  if(result.state==='not_found'){
    message('Ainda não confirmado. Você pode reenviar a mesma solicitação.');
    controls({recover:true,retry:true});return;
  }
  message('Não foi possível consultar. Tente recuperar novamente.');
  controls({recover:true});
});
$('track').addEventListener('click',async()=>{
  if(!receipt||busy)return;
  busy=true;$('track').disabled=true;
  const result=await readCoreTracking(receipt.tracking_token);
  $('tracking').textContent=result.state==='ready'?'Status: '+result.data.status:'Acompanhamento indisponível.';
  busy=false;$('track').disabled=false;
});
void load();
