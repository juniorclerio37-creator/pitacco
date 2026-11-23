// Leitor genérico de cardápios públicos. Não executa scripts nem depende de um provedor.
const decodeEntities=s=>String(s||'').replace(/&quot;|&#34;/g,'"').replace(/&apos;|&#39;/g,"'").replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>');
const clean=s=>decodeEntities(String(s??'').replace(/<[^>]*>/g,' ')).replace(/\s+/g,' ').trim();
const asArray=v=>Array.isArray(v)?v:v&&typeof v==='object'?Object.values(v).filter(x=>Array.isArray(x)).flat():[];
const first=(o,keys)=>keys.map(k=>o?.[k]).find(v=>v!==undefined&&v!==null&&v!=='');
function price(value,cents=false){
 if(value===null||value===undefined||value==='')return null;
 if(typeof value==='object')return price(first(value,['price','value','amount','currentPrice']),cents);
 if(typeof value==='number')return Number.isFinite(value)?(cents?Math.round(value)/100:Math.round(value*100)/100):null;
 let str=String(value).trim().replace(/R\$|\s|BRL/gi,'');
 if(!str)return null;
 if(str.includes(','))str=str.replace(/\./g,'').replace(',','.');
 else if((str.match(/\./g)||[]).length>1)str=str.replace(/\./g,'');
 const n=Number(str);return Number.isFinite(n)?(cents?Math.round(n)/100:Math.round(n*100)/100):null;
}
function imgUrl(src,origin){
 if(src&&typeof src==='object')src=first(src,['url','src','original','image','path']);
 if(Array.isArray(src))src=src[0];
 if(typeof src!=='string'||src.length>2048)return '';
 try{const u=new URL(decodeEntities(src),origin);return u.protocol==='https:'&&u.username===''&&u.password===''?u.toString():''}
 catch{return ''}
}
function groupsFrom(record){
 let raw=first(record,['groups','customs','modifiers','option_groups','optionGroups','complement_groups','addons','extras']);
 if(!raw) return [];
 const groups=[];
 for(const [i,g] of asArray(raw).entries()){
  if(!g||typeof g!=='object'||g.active===false||g.missing===true)continue;
  const optionsRaw=first(g,['options','choices','items','values','modifiers']);
  const options=[];
  for(const [j,o] of asArray(optionsRaw).entries()){
   if(!o||typeof o!=='object')continue;
   const name=clean(first(o,['name','title','label','description'])).slice(0,100);
   const p=price(first(o,['additional_price','extraPrice','price','amount','additionalPrice'])??0,
    o.extraPrice!==undefined||o.extra_price_cents!==undefined);
   if(!name||p===null||p<0)continue;
   options.push({name,price:p,available:o.available!==false&&o.active!==false&&o.missing!==true,sort_order:j});
  }
  if(!options.length)continue;
  const min=Number(first(g,['min','min_select','minChoices','minimum'])??(g.required?1:0));
  const max=Number(first(g,['max','max_select','maxChoices','maximum'])??(g.type==='unique'?1:options.length));
  if(!Number.isInteger(min)||!Number.isInteger(max)||min<0||min>max||max>100)continue;
  const name=clean(first(g,['name','title','label'])).slice(0,100)||'Escolhas';
  groups.push({name,min,max,options,sort_order:i});
 }
 return groups;
}
function productFrom(record,category,origin,forcedCents=false){
 if(!record||typeof record!=='object')return null;
 const name=clean(first(record,['name','title','productName','label'])).slice(0,120);
 const desc=clean(first(record,['description','details','summary','subtitle'])).slice(0,1000);
 const cat=clean(first(record,['category','categoryName','category_name'])||category||'Outros').slice(0,80);
 let cents=forcedCents||record.priceCents!==undefined||record.currentPriceCents!==undefined;
 let raw=first(record,['currentPriceCents','priceCents','currentPrice','salePrice','price','basePrice','valor','preco','amount']);
 if(raw===undefined)raw=first(record.offers,['price','lowPrice','priceSpecification']);
 let value=price(raw,cents);
 const groups=groupsFrom(record);
 // Cardápios com preço definido pelo tamanho obrigatório.
 if((value===0||value===null)&&groups.length){
  const size=groups.find(g=>g.min===1&&g.max===1&&/tamanho|volume|size|porção/i.test(g.name));
  if(size){
   const available=size.options.filter(o=>o.available);
   const min=Math.min(...available.map(o=>o.price));
   if(Number.isFinite(min)&&min>0){
    value=min;
    size.options=size.options.map(o=>({...o,price:Math.max(0,Math.round((o.price-min)*100)/100)}));
   }
  }
 }
 if(!name||!Number.isFinite(value)||value<=0||value>100000)return null;
 const image=imgUrl(first(record,['image_url','imageUrl','image','photo','picture','thumbnail','foto']),origin);
 const active=record.active!==false&&record.missing!==true&&record.available!==false&&record.isAvailable!==false;
 return {name,category:cat,description:desc,price:value,active,image_url:image,groups};
}
function parseAttrs(tag){
 const o={};const re=/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g;
 let m;while((m=re.exec(tag)))o[m[1].toLowerCase()]=decodeEntities(m[2]??m[3]??m[4]);
 return o;
}
function imagesByAlt(html,origin){
 const map=new Map();
 for(const match of html.matchAll(/<img\b[^>]{0,1700}>/gi)){
  const a=parseAttrs(match[0]);const name=clean(a.alt).toLowerCase();
  const src=imgUrl(a.src||a['data-src']||a['data-original']||a['data-lazy-src'],origin);
  if(name&&src)map.set(name,src);
 }
 return map;
}
function nuxtExpand(blob){
 if(!Array.isArray(blob)||blob.length<2||blob.length>140000)return null;
 const root=blob[1],cache=new Map(),stack=new Set();
 function read(v,depth){
  if(typeof v!=='number')return v;
  if(v<0||v>=blob.length)return null;
  if(depth>45||stack.has(v))return null;
  if(cache.has(v))return cache.get(v);
  stack.add(v);const item=blob[v];
  let result;
  if(Array.isArray(item)){
   const special=typeof item[0]==='string'&&['Reactive','ShallowReactive','Ref','ShallowRef','Set','Map','Date'].includes(item[0]);
   result=special?(item[0]==='Reactive'||item[0]==='ShallowReactive'||item[0]==='Ref'||item[0]==='ShallowRef'?read(item[1],depth+1):item.slice(1).map(x=>read(x,depth+1))):item.map(x=>read(x,depth+1));
  }else if(item&&typeof item==='object'){result={};cache.set(v,result);for(const [k,x] of Object.entries(item))result[k]=read(x,depth+1);}
  else result=item;
  stack.delete(v);cache.set(v,result);return result;
 }
 if(typeof root==='number')return read(root,0);
 if(root&&typeof root==='object'&&!Array.isArray(root)){const obj={};for(const [k,v] of Object.entries(root))obj[k]=read(v,1);return obj;}
 return null;
}
function scanObject(root,origin,alt,limit=300){
 const products=[];let visited=0;
 const seen=new Set();
 const add=(r,cat='',cents=false)=>{
  const p=productFrom(r,cat,origin,cents);
  if(!p)return;
  if(!p.image_url)p.image_url=alt.get(p.name.toLowerCase())||'';
  const signature=(p.category+'|'+p.name).toLowerCase();
  if(!seen.has(signature)){seen.add(signature);products.push(p);}
 };
 function visit(node,category='',depth=0){
  if(products.length>=limit||visited++>15000||depth>24||!node||typeof node!=='object')return;
  if(Array.isArray(node)){for(const v of node.slice(0,450))visit(v,category,depth+1);return;}
  if(node.productsByCategory&&typeof node.productsByCategory==='object'){
   const cats=asArray(node.categories);
   const byId=new Map(cats.map(x=>[String(x.id),clean(first(x,['name','title','label']))]));
   for(const [k,arr] of Object.entries(node.productsByCategory)){
    for(const p of asArray(arr))add(p,byId.get(k)||category,true);
   }
  }
  const type=String(first(node,['@type','type'])||'').toLowerCase();
  if(type.includes('product')||type.includes('menuitem')) add(node,category,false);
  for(const [key,value] of Object.entries(node)){
   if(products.length>=limit)break;
   if(['choices','options','customs','modifiers','option_groups','complement_groups','extras','addons','image','images','offers','seller','address'].includes(key))continue;
   if(['products','items','menuitems','dishes','entries','catalog','productlist'].includes(key.toLowerCase()) && Array.isArray(value)){
    for(const p of value){
     if(p&&typeof p==='object'&&first(p,['price','currentPrice','salePrice','basePrice','priceCents'])!==undefined)
      add(p,clean(first(node,['name','title','category']))||category,key.toLowerCase()==='products'&&node.productsByCategory!==undefined);
     else visit(p,category,depth+1);
    }
   }else if(value&&typeof value==='object') visit(value,category,depth+1);
  }
 }
 visit(root);return products;
}
export function parsePublicMenu(body,origin,contentType='text/html'){
 const warnings=[],sources=[];
 let parsed=null;
 if(contentType.includes('json')||/^\s*[\[{]/.test(body.slice(0,100))){
  try{parsed=JSON.parse(body)}catch{}
 }
 const images=imagesByAlt(body,origin);
 let products=[];
 if(parsed){
  products=scanObject(parsed,origin,images);
  if(!products.length&&Array.isArray(parsed))products=parsed.map(p=>productFrom(p,'Outros',origin)).filter(Boolean);
  if(products.length)sources.push('dados estruturados');
 }
 if(!products.length){
  for(const script of body.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)){
   const attrs=parseAttrs(script[1]),content=script[2]?.trim();
   if(!content||content.length>1800000)continue;
   if(attrs.type?.includes('ld+json')||attrs.id==='__NEXT_DATA__'||attrs.id==='__NUXT_DATA__'||
     attrs.type==='application/json'){
     try{
      const json=JSON.parse(content);
      const source=attrs.id==='__NUXT_DATA__'?nuxtExpand(json):json;
      const items=scanObject(source,origin,images);
      if(items.length){products.push(...items);sources.push(attrs.id||'dados estruturados');}
     }catch{}
   }
  }
 }
 if(!products.length){
  // Páginas HTML com cards e dados estáticos, sem depender de uma plataforma.
  const fragments=body.match(/<(?:article|li|div)\b[^>]*(?:class\s*=\s*["'][^"']*(?:product|menu-item|dish|cardapio-item)[^"']*["']|data-product)[^>]*>[\s\S]{0,4200}?<\/(?:article|li|div)>/gi)||[];
  for(const fragment of fragments.slice(0,450)){
   const title=fragment.match(/<(?:h[2-5]|strong)\b[^>]*>([\s\S]{1,230}?)<\/(?:h[2-5]|strong)>/i)?.[1];
   const amount=clean(fragment).match(/R\$\s*([0-9][0-9.,]*)/i)?.[1];
   if(!title||!amount)continue;
   const image=fragment.match(/<img\b[^>]*>/i)?.[0]||'';
   const parsedImage=parseAttrs(image);
   const p=productFrom({name:clean(title),price:amount,image:parsedImage.src||parsedImage['data-src']},'Outros',origin);
   if(p)products.push(p);
  }
  if(products.length)sources.push('itens HTML');
 }
 const unique=new Map();
 for(const p of products){
  const key=(p.category+'|'+p.name).toLowerCase();
  if(!unique.has(key))unique.set(key,p);
  else if(!unique.get(key).image_url&&p.image_url)unique.get(key).image_url=p.image_url;
 }
 const result=[...unique.values()].slice(0,300);
 if(!result.length)warnings.push('Não foi possível identificar produtos estruturados nesta página. Experimente exportar o cardápio como CSV ou JSON.');
 const withoutPhotos=result.filter(p=>!p.image_url).length;
 if(withoutPhotos)warnings.push(withoutPhotos+' produto(s) sem foto acessível na página.');
 const withGroups=result.filter(p=>p.groups.length).length;
 if(result.length&&!withGroups)warnings.push('Nenhum grupo de complementos foi identificado. Verifique se o site disponibiliza os adicionais publicamente.');
 return {products:result,warnings,method:sources[0]||'não identificado',counts:{products:result.length,groups:result.reduce((n,p)=>n+p.groups.length,0),options:result.reduce((n,p)=>n+p.groups.reduce((j,g)=>j+g.options.length,0),0),withPhotos:result.length-withoutPhotos}};
}
