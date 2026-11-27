import {handleSalesCoach} from './sales-coach.mjs';
const storefrontHosts = new Set(['pitacco.com.br', 'www.pitacco.com.br']);
const reserved = new Set([
  'www', 'app', 'entregador', 'pitacco', 'admin', 'api', 'mail', 'cadastro',
  'privacidade', 'termos', 'sistema', 'configuracao', 'produtos', 'complementos',
  'cardapio', 'pedidos', 'aceite', 'acompanhar', 'identidade', 'assets',
]);

export default {
  fetch(request, env) {
    const {ASSETS}=env;
    if(new URL(request.url).pathname==='/api/intelligence/sales')return handleSalesCoach(request,env);
    const url = new URL(request.url);
    const slug = url.pathname.match(/^\/([a-z0-9][a-z0-9-]{2,59})\/?$/)?.[1];
    if (storefrontHosts.has(url.hostname) && slug && !reserved.has(slug) &&
        (request.method === 'GET' || request.method === 'HEAD')) {
      url.pathname = '/cardapio/';
      return ASSETS.fetch(new Request(url, request));
    }
    // Only the merchant HTML entry must revalidate on navigation. Content-hashed
    // JS/CSS, images and public menus retain their existing caching policy.
    if(url.hostname==='app.pitacco.com.br'&&['/','/app','/app/','/app/index.html'].includes(url.pathname)&&
       (request.method==='GET'||request.method==='HEAD')){
      const headers=new Headers(request.headers);
      headers.delete('if-none-match');headers.delete('if-modified-since');
      return Promise.resolve(ASSETS.fetch(new Request(request,{headers}))).then(response=>{
        if(!(response.headers.get('content-type')||'').includes('text/html'))return response;
        const freshHeaders=new Headers(response.headers);
        freshHeaders.set('Cache-Control','no-cache, no-store, must-revalidate');
        return new Response(response.body,{status:response.status,statusText:response.statusText,headers:freshHeaders});
      });
    }
    return ASSETS.fetch(request);
  },
};
