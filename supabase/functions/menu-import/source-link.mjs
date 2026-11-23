// Detecta links de vitrines públicas do iFood; não acessa dados privados.
export function ifoodMerchantFromUrl(link){
 const domain=link.hostname.toLowerCase();
 if(domain!=="www.ifood.com.br"&&domain!=="ifood.com.br")return null;
 const match=link.pathname.match(/^\/delivery\/[^/]+\/[^/]+\/([a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12})(?:\/|$)/i);
 return match?match[1].toLowerCase():null;
}
