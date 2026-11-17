// Identidade técnica usada apenas pelo Supabase Auth.
// No aplicativo, entregadores sempre digitam telefone + senha; não existe cadastro por e-mail.
// O hash evita expor o número de telefone no identificador interno.
export function normalizeBrazilPhone(value) {
  const digits=String(value??'').replace(/\D/g,'');
  const national=digits.startsWith('55')&&digits.length===13?digits.slice(2):digits;
  if (!/^[1-9][0-9]9[0-9]{8}$/.test(national)) throw new Error('Informe celular com DDD válido');
  return '+55'+national;
}

export async function courierEmailAlias(phone) {
  const normalized=normalizeBrazilPhone(phone);
  const input=new TextEncoder().encode('pitacco-courier-auth-v1:'+normalized);
  const hash=await crypto.subtle.digest('SHA-256',input);
  const hex=Array.from(new Uint8Array(hash),x=>x.toString(16).padStart(2,'0')).join('');
  // Não enviar e-mails de confirmação ou redefinição para este endereço:
  // as senhas são fornecidas/redefinidas apenas pelo estabelecimento autorizado.
  return 'c'+hex+'@login.pitacco.com.br';
}
