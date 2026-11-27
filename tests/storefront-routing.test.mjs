import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../cloudflare/storefront.mjs';
import {storefrontLink} from '../revisions/0.12/web/storefrontLink.mjs';

function assetPath(url, method='GET'){
 return worker.fetch(new Request(url,{method}),{ASSETS:{fetch:request=>{
  const u=new URL(request.url),value=u.pathname+u.search;
  return u.hostname==='app.pitacco.com.br'&&['/','/app','/app/','/app/index.html'].includes(u.pathname)
   ?new Response(value,{headers:{'Content-Type':'text/html'}}):value;
 }} });
}

test('store slugs are served at the public domain without redirecting the browser',()=>{
 assert.equal(assetPath('https://pitacco.com.br/acaidolinho'),'/cardapio/');
 assert.equal(assetPath('https://www.pitacco.com.br/loja-dois/?utm_source=qr','HEAD'),'/cardapio/?utm_source=qr');
 assert.equal(storefrontLink('acaidolinho'),'https://pitacco.com.br/acaidolinho');
 assert.equal(storefrontLink('loja-dois','https://homologacao.pitacco.test/'),'https://homologacao.pitacco.test/loja-dois');
 assert.equal(storefrontLink('../admin'),'');
});

test('marketing, legacy menu, assets and the application keep their existing routes',async()=>{
 for(const path of ['/', '/cadastro/', '/produtos', '/cardapio/?loja=acaidolinho', '/assets/file.js','/acompanhar/?token=fixture']){
  assert.equal(assetPath('https://pitacco.com.br'+path),path);
 }
 assert.equal(await (await assetPath('https://app.pitacco.com.br/app/?aba=Produtos')).text(),'/app/?aba=Produtos');
 assert.equal(assetPath('https://app.pitacco.com.br/acaidolinho'),'/acaidolinho');
 assert.equal(assetPath('https://pitacco.com.br/acaidolinho','POST'),'/acaidolinho');
});

test('merchant entry always requests current HTML while hashed assets retain cache policy',async()=>{
 const env={ASSETS:{fetch:request=>{
  const path=new URL(request.url).pathname;
  if(path.startsWith('/assets/'))return new Response('bundle',{headers:{'Cache-Control':'public,max-age=31536000,immutable','Content-Type':'application/javascript'}});
  assert.equal(request.headers.has('if-none-match'),false);
  assert.equal(request.headers.has('if-modified-since'),false);
  return new Response('<html>new release</html>',{headers:{'Content-Type':'text/html','Cache-Control':'public,max-age=86400'}});
 }}};
 for(const path of ['/','/app','/app/','/app/index.html']){
  const response=await worker.fetch(new Request('https://app.pitacco.com.br'+path+'?aba=Aparencia',{headers:{'If-None-Match':'"old"','If-Modified-Since':'Wed, 21 Oct 2015 07:28:00 GMT'}}),env);
  assert.equal(response.headers.get('cache-control'),'no-cache, no-store, must-revalidate');
  assert.equal(await response.text(),'<html>new release</html>');
 }
 const asset=await worker.fetch(new Request('https://app.pitacco.com.br/assets/index-abc.js'),env);
 assert.equal(asset.headers.get('cache-control'),'public,max-age=31536000,immutable');
});
