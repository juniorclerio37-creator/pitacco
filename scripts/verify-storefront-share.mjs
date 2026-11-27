// Run against production after deploying, using the real network and public HTML.
// Do not accept a generic 200 or a browser-side title as proof of Open Graph.
import assert from 'node:assert/strict';
const slugs=['acaidolinho','acai-do-linho-demo'];
const agents=['WhatsApp/2.26','facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)'];
const values=new Map();
for(const slug of slugs){
 for(const agent of agents){
  const url='https://pitacco.com.br/'+slug;
  const r=await fetch(url+'?preview_check='+Date.now(),{headers:{'user-agent':agent,'cache-control':'no-cache'},signal:AbortSignal.timeout(15000),redirect:'follow'});
  assert.equal(r.status,200,'Expected live menu for '+slug);
  const html=await r.text();
  const head=html.slice(0,html.indexOf('</head>'));
  const get=key=>head.match(new RegExp('<meta\\s+property="'+key+'"\\s+content="([^"]+)"','i'))?.[1];
  const title=get('og:title'),description=get('og:description'),image=get('og:image');
  assert.ok(title&&title!=='Cardápio','Missing store title for '+slug+' ('+agent+')');
  assert.ok(description,'Missing description for '+slug);
  assert.equal(get('og:url'),url);
  assert.ok(image&&image.startsWith('https://'),'Missing public image for '+slug);
  assert.ok(head.indexOf('og:title')<head.indexOf('<style>'),'Preview metadata must precede large CSS');
  const picture=await fetch(image.replaceAll('&amp;','&'),{headers:{'user-agent':agent},signal:AbortSignal.timeout(15000)});
  assert.ok(picture.ok,'Public logo not accessible for '+slug);
  assert.match(picture.headers.get('content-type')||'',/^image\//i);
  await picture.body?.cancel();
  if(values.has(slug))assert.equal(title,values.get(slug));else values.set(slug,title);
  console.log('Public preview OK:',slug,agent.split('/')[0],title);
 }
}
assert.notEqual(values.get(slugs[0]),values.get(slugs[1]),'Store identities must not be shared');
