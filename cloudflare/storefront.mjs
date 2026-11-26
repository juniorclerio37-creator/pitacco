const storefrontHosts = new Set(['pitacco.com.br', 'www.pitacco.com.br']);
const reserved = new Set([
  'www', 'app', 'entregador', 'pitacco', 'admin', 'api', 'mail', 'cadastro',
  'privacidade', 'termos', 'sistema', 'configuracao', 'produtos', 'complementos',
  'cardapio', 'pedidos', 'aceite', 'acompanhar', 'identidade', 'assets',
]);

export default {
  fetch(request, env) {
    const {ASSETS}=env;
    if(new URL(request.url).pathname.startsWith('/api/intelligence/'))return new Response('Not found',{status:404,headers:{'Cache-Control':'no-store'}});
    const url = new URL(request.url);
    const slug = url.pathname.match(/^\/([a-z0-9][a-z0-9-]{2,59})\/?$/)?.[1];
    if (storefrontHosts.has(url.hostname) && slug && !reserved.has(slug) &&
        (request.method === 'GET' || request.method === 'HEAD')) {
      url.pathname = '/cardapio/';
      return ASSETS.fetch(new Request(url, request));
    }
    return ASSETS.fetch(request);
  },
};
