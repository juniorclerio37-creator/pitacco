// Contato por entrega. Somente um número real abre WhatsApp.
// O 0800 do iFood pode vir com localizador após a vírgula; no Android,
// o discador geralmente interpreta vírgula como pausa antes dos dígitos DTMF.
// O comportamento final depende do discador; o código segue visível e copiável.
export function resolveCustomerContact(contact, now = Date.now()) {
  const raw = String(contact?.number ?? '').trim().slice(0, 128);
  const [rawPhone, ...rest] = raw.split(',');
  const rawDigits = rawPhone.replace(/\D/g, '');
  const digits = rawDigits.startsWith('550800') ? rawDigits.slice(2) : rawDigits;
  const expiry = contact?.expires_at ? Date.parse(String(contact.expires_at)) : NaN;
  if (contact?.kind === 'expired' || (Number.isFinite(expiry) && now > expiry)) {
    return {type:'expired',label:'Contato expirado',href:null,localizer:null,number:null};
  }
  const explicitCode = String(contact?.localizer ?? '').replace(/\D/g, '').slice(0,16);
  const inlineCode = rest.join(',').replace(/\D/g, '').slice(0,16);
  const localizer = explicitCode || inlineCode || null;
  if (/^0(?:800|300|303|900)\d{6,9}$/.test(digits)) {
    return {
      type:'intermediary', label:'Ligar pelo número intermediário',
      // Vírgula = pausa DTMF em discadores compatíveis; não aciona a chamada sozinho.
      href:'tel:' + digits + (localizer ? ',' + localizer : ''),
      number:rawPhone.trim(), localizer,
    };
  }
  const national=rawDigits.startsWith('55')&&(rawDigits.length===12||rawDigits.length===13)?
    rawDigits.slice(2):rawDigits;
  // Número intermediário desconhecido, ou telefone misturado com texto/código, nunca vira WhatsApp.
  const real=/^[1-9]\d(?:9\d{8}|[2-9]\d{7})$/.test(national);
  if(real && contact?.kind!=='intermediary' && rest.length===0){
    return {
      type:'real',label:'Conversar no WhatsApp',
      href:'https://wa.me/55'+national,
      callHref:'tel:+55'+national,
      number:rawPhone.trim(),localizer:null,
    };
  }
  return {type:'unavailable',label:'Telefone não disponível',href:null,
    localizer:null,number:null};
}
