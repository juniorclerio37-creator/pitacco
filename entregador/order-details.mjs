import {resolveCustomerContact} from './contact.mjs';

function node(tag, className = '', text) {
  const item = document.createElement(tag);
  if (className) item.className = className;
  if (text !== undefined && text !== null) item.textContent = String(text);
  return item;
}
function section(title) {
  const wrapper = node('section', 'order-detail-section');
  wrapper.append(node('h3', '', title));
  return wrapper;
}
function line(label, value) {
  const wrapper = node('div', 'order-detail-row');
  wrapper.append(node('span', '', label), node('strong', '', value ?? '—'));
  return wrapper;
}
function linkButton(label, href, className) {
  const item = node('a', 'order-contact-button ' + className, label);
  item.href = href;
  if (href.startsWith('https:')) {
    item.target = '_blank';
    item.rel = 'noopener noreferrer';
  }
  return item;
}
function modifiers(item) {
  const opts = Array.isArray(item?.options) ? item.options.slice(0, 30) : [];
  const result = [];
  for (const raw of opts) {
    if (typeof raw === 'string') {
      if (raw.trim()) result.push(raw.trim().slice(0, 150));
    } else if (raw && typeof raw === 'object') {
      const name = String(raw.name ?? raw.title ?? raw.description ?? raw.option?.name ?? '').trim();
      if (!name) continue;
      const amount = Number(raw.quantity ?? 1);
      result.push((Number.isInteger(amount) && amount > 1 ? amount + '× ' : '') + name.slice(0, 150));
    }
  }
  return result;
}
function buildContactBlock(details) {
  const block = section('Contato do cliente');
  const resolved = resolveCustomerContact(details.contact);
  const wrap = node('div', 'order-contact-box');
  if (resolved.type === 'expired') {
    wrap.append(node('p', 'order-contact-explain', 'O contato fornecido pela plataforma expirou. Solicite orientação à loja.'));
  } else if (resolved.type === 'unavailable') {
    wrap.append(node('p', 'order-contact-explain', 'A loja ou plataforma não disponibilizou um telefone válido para esta entrega.'));
  } else {
    wrap.append(node('strong', 'order-contact-number', resolved.number));
    const actions = node('div', 'order-contact-actions');
    if (resolved.type === 'real') {
      actions.append(linkButton('Conversar no WhatsApp', resolved.href, 'whatsapp'));
      const normalized = resolved.href.slice('https://wa.me/'.length);
      actions.append(linkButton('Ligar', resolved.callHref || 'tel:+' + normalized, 'call'));
      wrap.append(node('p', 'order-contact-explain', 'Use este contato somente para assuntos relacionados à entrega.'));
    } else {
      wrap.append(node('p', 'order-contact-explain',
        'Número intermediário: o discador receberá o 0800 e, quando houver localizador, o código após uma vírgula (pausa em discadores compatíveis). Não funciona pelo WhatsApp.'));
      actions.append(linkButton('Ligar para o 0800', resolved.href, 'call'));
      if (resolved.localizer) {
        const box = node('div', 'order-localizer');
        box.append(node('span', '', 'LOCALIZADOR DO CONTATO'), node('strong', '', resolved.localizer));
        const copy = node('button', 'order-copy', 'Copiar código');
        copy.type = 'button';
        copy.addEventListener('click', async () => {
          try { await navigator.clipboard.writeText(resolved.localizer); copy.textContent='Copiado!'; }
          catch { copy.textContent='Selecione o código para copiar'; }
        });
        box.append(copy);
        wrap.append(box);
        wrap.append(node('p', 'order-contact-explain',
          'Se o discador não conservar a vírgula e o código, informe o localizador manualmente durante a ligação.'));
      } else {
        wrap.append(node('p', 'order-contact-warning',
          'O localizador não foi fornecido ao Pitacco. Confira-o com a loja antes de ligar. Se o celular não aceitar a pausa, digite o código manualmente durante a ligação.'));
      }
    }
    wrap.append(actions);
  }
  block.append(wrap);
  return block;
}
function buildItems(details) {
  const block = section('Itens do pedido');
  const list = Array.isArray(details.items) ? details.items.slice(0, 70) : [];
  if (!list.length) {
    block.append(node('p', 'order-detail-muted', 'A integração ainda não forneceu os itens deste pedido.'));
  }
  for (const item of list) {
    const row = node('div', 'order-product');
    const quantity = String(item?.quantity ?? '1').slice(0, 12);
    const name = String(item?.name ?? 'Produto').slice(0, 200);
    row.append(node('b', 'order-product-title', quantity + '× ' + name));
    const optionList = modifiers(item);
    if (optionList.length) {
      const ul = node('ul', 'order-product-options');
      for (const option of optionList) ul.append(node('li', '', option));
      row.append(ul);
    }
    if (item?.notes) row.append(node('p', 'order-product-notes', String(item.notes).slice(0, 450)));
    block.append(row);
  }
  return block;
}
function buildDetails(details, delivery, navigate) {
  const root = document.createDocumentFragment();
  const status = node('div','order-source-row');
  status.append(node('span','order-source-tag',String(details.source ?? delivery.source ?? 'Próprio').toUpperCase()),
                node('span','order-status-tag',String(details.status ?? delivery.status ?? 'Em andamento')));
  root.append(status);

  const customer = section('Cliente e endereço');
  customer.append(node('strong','order-customer-name',details.customer_name ?? delivery.customer_name ?? 'Cliente'));
  customer.append(node('p','order-detail-address',details.address ?? delivery.address ?? 'Endereço não informado'));
  const openRoute = node('button','order-route-button','Abrir rota');
  openRoute.type = 'button';
  openRoute.disabled = !String(details.address ?? delivery.address ?? '').trim();
  openRoute.addEventListener('click',()=>navigate({...delivery,address:details.address ?? delivery.address}));
  customer.append(openRoute);
  root.append(customer,buildContactBlock(details),buildItems(details));

  if (details.notes) {
    const notes = section('Observações');
    notes.append(node('p', 'order-detail-notes', String(details.notes).slice(0, 1500)));
    root.append(notes);
  }
  const payment = section('Pagamento');
  if (details.total != null && Number.isFinite(Number(details.total))) {
    const total = new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(Number(details.total));
    payment.append(line('Valor informado do pedido', total));
  }
  if (details.payment_method) payment.append(line('Forma informada', String(details.payment_method).slice(0, 100)));
  payment.append(node('p','order-detail-muted',
    'O valor do pedido não é o ganho do motoboy. Antes de cobrar qualquer quantia, confirme com a loja se o pedido está pago ou é para receber na entrega.'));
  root.append(payment);
  return root;
}
export function createOrderDetailsController({supabase,navigate}) {
  const overlay = document.getElementById('orderDetailOverlay');
  const title = document.getElementById('orderDetailTitle');
  const content = document.getElementById('orderDetailContent');
  const closeButton = document.getElementById('closeOrderDetail');
  let request = 0;
  let previousFocus = null;
  function close() {
    request++;
    overlay.hidden = true;
    document.body.classList.remove('order-detail-open');
    content.replaceChildren();
    previousFocus?.focus?.();
  }
  closeButton.addEventListener('click',close);
  overlay.addEventListener('click',e=>{if(e.target===overlay)close();});
  document.addEventListener('keydown',e=>{
    if(overlay.hidden)return;
    if(e.key==='Escape'){e.preventDefault();close();return;}
    if(e.key==='Tab'){
      const focusable=[...overlay.querySelectorAll('button:not([disabled]),a[href]')];
      if(!focusable.length){e.preventDefault();return;}
      const first=focusable[0],last=focusable[focusable.length-1];
      if(e.shiftKey && document.activeElement===first){e.preventDefault();last.focus();}
      if(!e.shiftKey && document.activeElement===last){e.preventDefault();first.focus();}
    }
  });
  async function open(delivery) {
    const ticket=++request;
    previousFocus=document.activeElement;
    overlay.hidden=false;
    document.body.classList.add('order-detail-open');
    title.textContent='Detalhes do pedido';
    content.replaceChildren(node('p','order-detail-loading','Carregando informações do pedido...'));
    closeButton.focus();
    try {
      const {data,error}=await supabase.rpc('pitacco_driver_order_detail',{p_delivery:delivery.id});
      if(ticket!==request)return;
      if(error || !data || data.delivery_id!==delivery.id)throw Error('Não foi possível carregar este pedido');
      title.textContent='Pedido • '+String(data.display_number||'Aguardando número').slice(0,40);
      content.replaceChildren(buildDetails(data,delivery,navigate));
    }catch(err){
      if(ticket!==request)return;
      content.replaceChildren(node('p','order-detail-error',
        'Não foi possível carregar os detalhes deste pedido. Verifique sua conexão ou procure a loja.'));
    }
  }
  return {open,close};
}
