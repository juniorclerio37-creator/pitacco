// Número que a plataforma exibe para o cliente/lojista, ou B-/D- gerado pelo Pitacco.
// IDs técnicos UUID e IDs internos de 99Food nunca são fallback de interface.
export function publicOrderNumber(order,badge) {
  const receipt=order?.receipt ?? {};
  const source=String(order?.source ?? '').toLowerCase();
  const is99=['99food','99','99_food','99-food'].includes(source);
  const candidates=[
    badge?.public_number,
    receipt.display_number,
    receipt.external_order_number,
    receipt.order_number,
    receipt.display_id,
    ...(is99?[]:[receipt.number]),
  ];
  const value=candidates.map(v=>String(v??'').trim()).find(v=>v &&
    v.length<=24 &&
    !/^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(v) &&
    !(is99 && /^\d{13,}$/.test(v)));
  return value ?? 'Aguardando número';
}
export function validLocalizer(badge) {
  const value=String(badge?.localizer ?? '').replace(/\D/g,'').slice(0,16);
  return value || null;
}

export function orderAddress(value) {
  if(typeof value==='string')return value.trim();
  if(!value||typeof value!=='object')return '';
  const street=value.street||value.street_name||value.logradouro||value.rua||value.line1;
  const number=value.number||value.numero;
  const district=value.neighborhood||value.bairro;
  const city=[value.city||value.cidade,value.state||value.uf].filter(Boolean).join('/');
  const address=[street,number].filter(Boolean).join(', ');
  return [address,value.complement||value.complemento||value.line2,district,city]
    .filter(part=>typeof part==='string'&&part.trim()).join(' · ');
}

// A masked source value is not a customer name or a usable phone number.
// Historical marketplace contacts must not be recovered from restricted contact storage.
export function historyCustomer(order,delivery){
 const receipt=order?.receipt??{};
 const name=[receipt.customer,receipt.customer_name,delivery?.customer_name].map(v=>typeof v==='string'?v.trim():'').find(v=>v&&!/^[*•\s]+$/.test(v));
 const phone=order?.source==='ifood'?'':[receipt.phone,receipt.customer_phone,delivery?.customer_phone].map(v=>typeof v==='string'?v.trim():'').find(v=>v&&!/[*•]/.test(v)&&v.replace(/\D/g,'').length>=8)||'';
 return {name:name||'Nome não disponível',phone,phoneLabel:phone||(order?.source==='ifood'?'Contato indisponível no histórico do iFood':'Telefone não informado')};
}
