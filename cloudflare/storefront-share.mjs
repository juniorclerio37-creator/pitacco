// Public link previews for WhatsApp, Facebook and other social crawlers.
// Never use private credentials or fetch external image URLs from the Worker.
const slugPattern=/^[a-z0-9][a-z0-9-]{2,59}$/;
export const isShareCrawler=request=>/(?:whatsapp|facebookexternalhit|facebot|meta-externalagent|meta-externalfetcher|twitterbot|linkedinbot|telegrambot|discordbot|slackbot|skypeuripreview)/i.test(request.headers.get('user-agent')||'');
export function shareSlug(url,reserved){
 if(url.searchParams.has('pitacco_studio_preview')||url.searchParams.has('pagbank_preview'))return null;
 const path=url.pathname.match(/^\/([a-z0-9][a-z0-9-]{2,59})\/?$/)?.[1];
 const legacy=url.pathname.match(/^\/cardapio(?:\/([a-z0-9][a-z0-9-]{2,59}))?\/?$/);
 const slug=legacy?(url.searchParams.get('loja')||legacy[1]||''):path;
 return slugPattern.test(slug||'')&&!reserved.has(slug)?slug:null;
}
const escape=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const clean=(value,max)=>typeof value==='string'?Array.from(value.replace(/[\u0000-\u001f\u007f]/g,' ').replace(/\s+/g,' ').trim()).slice(0,max).join(''):'';
const httpsImage=value=>{
 if(typeof value!=='string'||value.length>2048)return '';
 try{
  const url=new URL(value);
  return url.protocol==='https:'&&!url.username&&!url.password?url.href:'';
 }catch{return ''}
};
const storageImage=(base,path)=>{
 if(typeof path!=='string'||!/^stores\/[0-9a-f-]{36}\/[0-9a-f-]{36}\.(png|jpg|webp)$/.test(path))return '';
 return httpsImage(base+'/storage/v1/object/public/pitacco-media/'+path);
};
async function publicRpc(env,name,slug,fetcher,signal){
 try{
  const base=String(env.PITACCO_SUPABASE_URL||'').replace(/\/$/,'');
  const key=env.PITACCO_SUPABASE_PUBLISHABLE_KEY;
  if(!base.startsWith('https://')||!key)return null;
  // Workers do not implement redirect:'error'. Manual mode keeps the public key
  // on the configured Supabase origin; the existing r.ok check rejects all 3xx.
  const r=await fetcher(base+'/rest/v1/rpc/'+name,{method:'POST',headers:{apikey:key,'content-type':'application/json',accept:'application/json'},body:JSON.stringify({p_slug:slug}),signal,redirect:'manual'});
  return r.ok?await r.json():null;
 }catch{return null}
}
export async function shareMetadata(env,slug,fetcher=fetch){
 const base=String(env.PITACCO_SUPABASE_URL||'').replace(/\/$/,'');
 // One shared deadline for both requests. If the database is slow, return the
 // ordinary menu instead of blocking delivery of a link.
 const signal=AbortSignal.timeout(2400);
 const identity=await publicRpc(env,'pitacco_public_menu_identity',slug,fetcher,signal);
 const name=clean(identity?.name,90);
 if(!name||identity.slug!==slug)return null;
 let image=storageImage(base,identity.profile_logo_path)||httpsImage(identity.logo_url);
 if(!image&&!signal.aborted){
  // Legacy published appearance and banner are only needed if no official
  // logo is available. Read public menu only on this exceptional crawler path.
  const menu=await publicRpc(env,'get_public_menu',slug,fetcher,signal);
  const shop=menu?.store;
  image=storageImage(base,shop?.profile_logo_path)||storageImage(base,shop?.appearance?.logo_path)||httpsImage(shop?.logo_url)||
   storageImage(base,shop?.appearance?.cover_path)||httpsImage(shop?.banner_url);
 }
 return {title:name+' | Cardápio Digital',description:'Confira o cardápio de '+name+', escolha seus favoritos e faça seu pedido online!',url:'https://pitacco.com.br/'+slug,image};
}
export function injectShareMetadata(html,meta){
 const property=(key,value)=>'<meta property="'+key+'" content="'+escape(value)+'">';
 const name=(key,value)=>'<meta name="'+key+'" content="'+escape(value)+'">';
 const tags=[
  '<title>'+escape(meta.title)+'</title>',
  name('description',meta.description),
  property('og:type','website'),property('og:locale','pt_BR'),
  property('og:title',meta.title),property('og:description',meta.description),property('og:url',meta.url),
  name('twitter:card','summary'),name('twitter:title',meta.title),name('twitter:description',meta.description)
 ];
 if(meta.image)tags.push(property('og:image',meta.image),property('og:image:secure_url',meta.image),property('og:image:alt',meta.title),name('twitter:image',meta.image));
 // Insert before the large inline stylesheet so even limited crawlers see it.
 return html.replace(/<title>[\s\S]*?<\/title>/i,()=>tags.join('\n'));
}
export async function serveSharePreview(request,env,slug,fetcher=fetch){
 const url=new URL(request.url);
 url.pathname='/cardapio/';url.search='';
 const headers=new Headers(request.headers);
 headers.delete('if-none-match');headers.delete('if-modified-since');
 const [asset,meta]=await Promise.all([
  env.ASSETS.fetch(new Request(url,{method:'GET',headers})),
  shareMetadata(env,slug,fetcher).catch(()=>null)
 ]);
 if(!asset.ok||!meta||!asset.headers.get('content-type')?.includes('text/html'))return asset;
 const html=injectShareMetadata(await asset.text(),meta);
 const out=new Headers(asset.headers);
 for(const key of ['content-length','content-encoding','etag','last-modified'])out.delete(key);
 // A crawler response belongs to this store, never to the shared /cardapio/ asset.
 out.set('cache-control','private, no-store');
 out.append('vary','User-Agent');
 return new Response(html,{status:asset.status,headers:out});
}
