// Única fonte de decisão para atalhos de contato do cliente no pedido.
// A plataforma pode fornecer um 0800 + localizador em vez do telefone real.
export function resolveCustomerContact(contact, now = Date.now()) {
  const raw = String(contact?.number ?? '').trim().slice(0, 64);
  const originalDigits = raw.replace(/\D/g, '');
  const digits = originalDigits.startsWith('550800') ? originalDigits.slice(2) : originalDigits;
  const expires = contact?.expires_at ? Date.parse(String(contact.expires_at)) : NaN;
  if (contact?.kind === 'expired' || (Number.isFinite(expires) && now > expires)) {
    return { type: 'expired', label: 'Contato expirado', href: null, localizer: null, number: null };
  }
  const localizer = String(contact?.localizer ?? '').replace(/\D/g, '').slice(0, 16) || null;
  if (/^0(?:800|300|303|900)\d{6,9}$/.test(digits)) {
    return {
      type: 'intermediary',
      label: 'Ligar pelo número intermediário',
      href: 'tel:' + digits,
      number: raw,
      localizer,
    };
  }
  const national = originalDigits.startsWith('55') && (originalDigits.length === 12 || originalDigits.length === 13)
    ? originalDigits.slice(2) : originalDigits;
  // Apenas telefones completos com DDD brasileiro. Jamais converta 0800 em WhatsApp.
  const isReal = /^[1-9]\d(?:9\d{8}|[2-9]\d{7})$/.test(national);
  if (isReal && contact?.kind !== 'intermediary') {
    return {
      type: 'real',
      label: 'Conversar no WhatsApp',
      href: 'https://wa.me/55' + national,
      number: raw,
      localizer: null,
    };
  }
  return {
    type: 'unavailable',
    label: 'Telefone não disponível',
    href: null,
    number: null,
    localizer: null,
  };
}
