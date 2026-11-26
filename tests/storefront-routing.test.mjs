import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../cloudflare/storefront.mjs';
import {storefrontLink} from '../revisions/0.12/web/storefrontLink.mjs';

function assetPath(url, method='GET'){
 return worker.fetch(new Request(url,{method}),{ASSETS:{fetch:request=>new URL(request.url).pathname+new URL(request.url).search}});
}

test('store slugs are served at the public domain without redirecting the browser',()=>{
 assert.equal(assetPath('https://pitacco.com.br/acaidolinho'),'/cardapio/');
 assert.equal(assetPath('https://www.pitacco.com.br/loja-dois/?utm_source=qr','HEAD'),'/cardapio/?utm_source=qr');
 assert.equal(storefrontLink('acaidolinho'),'https://pitacco.com.br/acaidolinho');
 assert.equal(storefrontLink('loja-dois','https://homologacao.pitacco.test/'),'https://homologacao.pitacco.test/loja-dois');
 assert.equal(storefrontLink('../admin'),'');
});

test('marketing, legacy menu, assets and the application keep their existing routes',()=>{
 for(const path of ['/', '/cadastro/', '/produtos', '/cardapio/?loja=acaidolinho', '/assets/file.js','/acompanhar/?token=fixture']){
  assert.equal(assetPath('https://pitacco.com.br'+path),path);
 }
 assert.equal(assetPath('https://app.pitacco.com.br/app/?aba=Produtos'),'/app/?aba=Produtos');
 assert.equal(assetPath('https://app.pitacco.com.br/acaidolinho'),'/acaidolinho');
 assert.equal(assetPath('https://pitacco.com.br/acaidolinho','POST'),'/acaidolinho');
});

 test('merchant and public storefront cannot access intelligence endpoint',async()=>{ const result=await worker.fetch(new Request('https://app.pitacco.com.br/api/intelligence/sales',{method:'POST'}),{ASSETS:{fetch:()=>{throw Error('unexpected asset fallback')}}});assert.equal(result.status,404);});
