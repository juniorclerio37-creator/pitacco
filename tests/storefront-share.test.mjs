import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../cloudflare/storefront.mjs';
import {shareSlug,isShareCrawler,shareMetadata,injectShareMetadata,serveSharePreview} from '../cloudflare/storefront-share.mjs';
const base='https://fixture.supabase.co',key='public-test-key';
const env={PITACCO_SUPABASE_URL:base,PITACCO_SUPABASE_PUBLISHABLE_KEY:key};
const slug='acai-loja',logo='stores/92000000-0000-0000-0000-000000000001/93000000-0000-0000-0000-000000000001.png';
const request=(url,ua='WhatsApp/2.26')=>new Request(url,{headers:{'User-Agent':ua,'If-None-Match':'"old"'}});
const fixture='<html><head><title>Cardápio</title><style>'+('x'.repeat(70000))+'</style></head><body>menu</body></html>';
const reserved=new Set(['app','cardapio','admin']);
function rpcFixture(data,calls){
 return async(url,opts)=>{
  assert.equal(opts.headers.apikey,key);assert.deepEqual(JSON.parse(opts.body),{p_slug:slug});
  assert.equal(opts.redirect,'error');assert.ok(opts.signal);
  const rpc=url.split('/').pop();calls.push(rpc);
  return Response.json(data[rpc]??null);
 };
}
test('recognizes share clients and public store links; excludes preview and administrative links',()=>{
 for(const ua of ['WhatsApp/2.26','facebookexternalhit/1.1','Twitterbot/1.0','TelegramBot','meta-externalfetcher/1.0'])assert.ok(isShareCrawler(request('https://pitacco.com.br/'+slug,ua)));
 assert.equal(isShareCrawler(request('https://pitacco.com.br/'+slug,'Mozilla/5.0')),false);
 for(const url of ['https://pitacco.com.br/acai-loja','https://www.pitacco.com.br/acai-loja/?ref=x','https://pitacco.com.br/cardapio/?loja=acai-loja','https://pitacco.com.br/cardapio/acai-loja'])assert.equal(shareSlug(new URL(url),reserved),slug);
 for(const url of ['https://pitacco.com.br/admin','https://pitacco.com.br/cardapio/?loja=../admin','https://pitacco.com.br/acai-loja?pitacco_studio_preview=x','https://pitacco.com.br/acai-loja?pagbank_preview=x'])assert.equal(shareSlug(new URL(url),reserved),null);
});
test('uses official logo first, canonical URL, and escaped name without exposing administrative fields',async()=>{
 const calls=[];
 const meta=await shareMetadata(env,slug,rpcFixture({pitacco_public_menu_identity:{name:'Açaí & "Linho" <script>',slug,profile_logo_path:logo,logo_url:'https://old.example/logo.png',whatsapp:'21999999999'}},calls));
 assert.deepEqual(calls,['pitacco_public_menu_identity']);
 assert.equal(meta.image,base+'/storage/v1/object/public/pitacco-media/'+logo);
 assert.equal(meta.url,'https://pitacco.com.br/'+slug);
 const html=injectShareMetadata(fixture,meta);
 assert.match(html,/og:title" content="Açaí &amp; &quot;Linho&quot; &lt;script&gt;/);
 assert.ok(html.indexOf('og:image')<html.indexOf('<style>'));
 assert.doesNotMatch(html,/21999999999|<script>/);
 assert.match(html,/og:url" content="https:\/\/pitacco.com.br\/acai-loja"/);
});
test('fallback uses published banner only if no logo exists; no cross-tenant or unsafe image fallback',async()=>{
 const calls=[];
 const meta=await shareMetadata(env,slug,rpcFixture({pitacco_public_menu_identity:{name:'Loja',slug,logo_url:'javascript:alert(1)'},get_public_menu:{store:{banner_url:'https://example.com/banner.jpg'}}},calls));
 assert.deepEqual(calls,['pitacco_public_menu_identity','get_public_menu']);
 assert.equal(meta.image,'https://example.com/banner.jpg');
 assert.equal(await shareMetadata(env,slug,rpcFixture({pitacco_public_menu_identity:{name:'Outra loja',slug:'outra-loja'}},[])),null);
 assert.equal(await shareMetadata(env,slug,async()=>{throw Error('offline')}),null);
});
test('social preview strips conditional cache headers and does not cache personalized shared HTML',async()=>{
 const calls=[];
 const assetEnv={...env,ASSETS:{fetch:r=>{
  assert.equal(new URL(r.url).pathname,'/cardapio/');assert.equal(new URL(r.url).search,'');
  assert.equal(r.headers.has('if-none-match'),false);
  return new Response(fixture,{headers:{'content-type':'text/html','etag':'"shared"','content-length':String(fixture.length)}});
 }}};
 const result=await serveSharePreview(request('https://pitacco.com.br/acai-loja?ref=123'),assetEnv,slug,rpcFixture({pitacco_public_menu_identity:{name:'Loja A',slug,profile_logo_path:logo}},calls));
 assert.match(await result.text(),/og:title" content="Loja A/);assert.equal(result.headers.get('cache-control'),'private, no-store');
 assert.equal(result.headers.has('etag'),false);assert.equal(result.headers.has('content-length'),false);
 assert.match(result.headers.get('vary'),/User-Agent/i);
 const fallback=await serveSharePreview(request('https://pitacco.com.br/'+slug),assetEnv,slug,async()=>Response.json(null));
 assert.equal(await fallback.text(),fixture);
});
test('normal customer visits stay on static assets without backend lookups',()=>{
 const fake={ASSETS:{fetch:r=>new URL(r.url).pathname}};
 assert.equal(worker.fetch(request('https://pitacco.com.br/acai-loja','Mozilla/5.0'),fake),'/cardapio/');
 assert.equal(worker.fetch(request('https://app.pitacco.com.br/assets/x.js','WhatsApp'),fake),'/assets/x.js');
});
