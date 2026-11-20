/* Shared OpenStreetMap tiles and the merchant's exact orange shop illustration. */
const SHOP_SVG="<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"58\" height=\"68\"\n    viewBox=\"0 0 58 68\" aria-hidden=\"true\" focusable=\"false\">\n    <defs><filter id=\"pitacco-shop-shadow\" x=\"-30%\" y=\"-25%\" width=\"160%\" height=\"170%\">\n      <feDropShadow dx=\"0\" dy=\"2\" stdDeviation=\"2\" flood-opacity=\".23\"/>\n    </filter></defs>\n    <path filter=\"url(#pitacco-shop-shadow)\"\n      d=\"M29 2C14.5 2 3 13.4 3 28c0 18.5 20.3 30.8 26 38\n      5.7-7.2 26-19.5 26-38C55 13.4 43.5 2 29 2Z\"\n      fill=\"#ea580c\" stroke=\"#fff\" stroke-width=\"2.5\" stroke-linejoin=\"round\"/>\n    <circle cx=\"29\" cy=\"27.5\" r=\"21.5\" fill=\"#fff7ed\"/>\n    <rect x=\"15\" y=\"25\" width=\"28\" height=\"18\" rx=\"2\" fill=\"#fff\" stroke=\"#9a3412\" stroke-width=\"1.5\"/>\n    <rect x=\"16\" y=\"23\" width=\"26\" height=\"4\" rx=\"1\" fill=\"#fed7aa\"/>\n    <path d=\"M15 23.2h28l-3.6-8.8H18.6L15 23.2Z\" fill=\"#fb923c\" stroke=\"#c2410c\" stroke-width=\"1.2\"/>\n    <path d=\"M18.6 14.4h4.1L21.8 23H15l3.6-8.6ZM27.1 14.4h4l1.1 8.6h-6l.9-8.6ZM35.3 14.4h4.1L43 23h-6.8l-.9-8.6Z\" fill=\"#fff\"/>\n    <path d=\"M15 23c0 3.3 4.7 3.3 4.7 0s4.7 3.3 4.7 0 4.7 3.3 4.7 0 4.7 3.3 4.7 0 4.7 3.3 4.7 0 4.5 3.3 4.5 0\"\n      fill=\"none\" stroke=\"#c2410c\" stroke-width=\"1.2\" stroke-linecap=\"round\"/>\n    <rect x=\"19.2\" y=\"30\" width=\"8\" height=\"7.5\" rx=\"1\" fill=\"#bae6fd\" stroke=\"#0e7490\" stroke-width=\"1.1\"/>\n    <path d=\"M23.2 30v7.5\" stroke=\"#0e7490\" stroke-width=\".8\"/>\n    <rect x=\"31.2\" y=\"29.5\" width=\"8\" height=\"13.5\" rx=\"1\" fill=\"#fed7aa\" stroke=\"#9a3412\" stroke-width=\"1.2\"/>\n    <circle cx=\"37\" cy=\"36.5\" r=\"1\" fill=\"#c2410c\"/>\n    <rect x=\"13\" y=\"42\" width=\"32\" height=\"2\" rx=\"1\" fill=\"#9a3412\"/>\n  </svg>";

let leafletPromise;
export function pointOf(lat,lng){
 if(lat==null||lng==null||String(lat).trim()===''||String(lng).trim()==='')return null;
 const a=Number(lat),b=Number(lng);
 if(!Number.isFinite(a)||!Number.isFinite(b)||Math.abs(a)>90||Math.abs(b)>180||(!a&&!b))return null;
 return [a,b];
}
export function freshGps(p,now=Date.now()){
 if(!pointOf(p?.latitude,p?.longitude))return false;
 const t=Date.parse(p?.observed_at||p?.timestamp||'');
 const acc=Number(p?.accuracy_m??p?.accuracy);
 return Number.isFinite(t)&&t<=now+30000&&now-t<=120000&&Number.isFinite(acc)&&acc>=0&&acc<=2000;
}
async function leaflet(){
 if(globalThis.L?.map)return globalThis.L;
 if(!leafletPromise)leafletPromise=new Promise((resolve,reject)=>{
  const base='https://unpkg.com/leaflet@1.9.4/dist/';
  if(!document.querySelector('[data-pitacco-leaflet-css]')){
   const css=document.createElement('link');css.rel='stylesheet';
   css.href=base+'leaflet.css';
   css.integrity='sha256-p4NxAoJBhIIN+hmNHrzRCf9tD/miZyoHS5obTRR9BMY=';
   css.crossOrigin='anonymous';css.dataset.pitaccoLeafletCss='1';
   document.head.append(css);
  }
  const script=document.createElement('script');
  script.src=base+'leaflet.js';script.crossOrigin='anonymous';
  script.integrity='sha256-20nQCchB9co0qIjJZRGuk2/Z9VM+kNiyxNV1lvTlZBo=';
  script.onload=()=>globalThis.L?.map?resolve(globalThis.L):reject(new Error('Mapa indisponível.'));
  script.onerror=()=>reject(new Error('Falha ao carregar mapa. Confira a conexão.'));
  document.head.append(script);
 }).catch(err=>{leafletPromise=null;throw err;});
 return leafletPromise;
}
function el(parent,tag,text,css=''){
 const e=document.createElement(tag);e.textContent=String(text??'');
 if(css)e.className=css;
 parent.append(e);return e;
}
function dropIcon(L,n){
 const span=document.createElement('span');
 span.className='courier-map-number';
 span.textContent=String(n).slice(0,3);
 return L.divIcon({className:'courier-map-destination',
  html:span.outerHTML,iconSize:[36,43],iconAnchor:[18,42],popupAnchor:[0,-33]});
}
export async function mountCourierSharedMap(container,{onOpenOrder,onNavigate}={}){
 const L=await leaflet();
 if(!container.isConnected)throw new Error('O mapa foi fechado.');
 const map=L.map(container,{scrollWheelZoom:false,zoomControl:true}).setView([-14.24,-51.93],4);
 L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',{
  maxZoom:19,attribution:'&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
 }).addTo(map);
 const layers=L.featureGroup().addTo(map),gpsLayer=L.layerGroup().addTo(map);
 const shopIcon=L.divIcon({className:'courier-map-shop-pin',html:SHOP_SVG,
  iconSize:[58,68],iconAnchor:[29,65],popupAnchor:[0,-55]});
 const motoIcon=L.divIcon({className:'courier-map-moto',
  html:'<span aria-hidden="true">🛵</span>',iconSize:[44,44],iconAnchor:[22,22]});
 let signature='',bounds=[],rider=null,accuracyCircle=null,gpsPoint=null,stats={stores:0,deliveries:0,missing:0};
 function fitAll(){
  const pts=[...bounds,...(gpsPoint?[gpsPoint]:[])];
  if(!pts.length)return false;
  if(pts.length===1)map.setView(pts[0],15);
  else map.fitBounds(L.latLngBounds(pts),{padding:[34,34],maxZoom:16});
  return true;
 }
 function setData({origins=[],deliveries=[],numbers={}}={}){
  const shops=(Array.isArray(origins)?origins:[])
   .map(s=>({...s,point:pointOf(s.latitude,s.longitude)})).filter(s=>s.point);
  const drops=(Array.isArray(deliveries)?deliveries:[])
   .map((d,i)=>({d,point:pointOf(d.latitude,d.longitude),index:i+1,
     number:String(numbers[d.id]||i+1)}));
  stats={stores:shops.length,deliveries:drops.filter(x=>x.point).length,
   missing:drops.filter(x=>!x.point).length};
  const next=JSON.stringify([shops.map(s=>[s.store_id,s.point,s.name]),
   drops.map(x=>[x.d.id,x.point,x.d.status,x.number,x.d.address])]);
  if(next===signature)return stats;
  const first=!signature;signature=next;
  layers.clearLayers();bounds=[];
  for(const shop of shops){
   const marker=L.marker(shop.point,{icon:shopIcon,title:'Sua loja: '+(shop.name||'Origem')}).addTo(layers);
   const popup=document.createElement('div');
   el(popup,'strong',shop.name||'Sua loja');
   el(popup,'p','Ponto de partida cadastrado pela loja.');
   marker.bindPopup(popup);bounds.push(shop.point);
  }
  for(const {d,point,number} of drops){
   if(!point)continue;
   const marker=L.marker(point,{icon:dropIcon(L,number),title:'Entrega '+number}).addTo(layers);
   const popup=document.createElement('div');el(popup,'strong','Entrega '+number);
   el(popup,'p',d.address||'Endereço da entrega');
   const actions=el(popup,'div','', 'courier-map-popup-actions');
   const url=onNavigate?.(d);
   if(typeof url==='string'&&url.startsWith('https://')){
    const link=el(actions,'a','Ir');link.href=url;link.rel='noopener noreferrer';
    link.addEventListener('click',()=>{const latest=onNavigate?.(d);
     if(typeof latest==='string'&&latest.startsWith('https://'))link.href=latest;});
   }
   if(onOpenOrder){const btn=el(actions,'button','Ver pedido');btn.type='button';
    btn.addEventListener('click',()=>onOpenOrder(d));}
   marker.bindPopup(popup);bounds.push(point);
  }
  if(first||map.getZoom()===4)fitAll();
  return stats;
 }
 function setGps(position){
  if(!freshGps(position))return false;
  const point=pointOf(position.latitude,position.longitude);
  const accuracy=Number(position.accuracy_m??position.accuracy);
  gpsPoint=point;
  if(!rider){
   rider=L.marker(point,{icon:motoIcon,title:'Sua localização pelo GPS'}).addTo(gpsLayer);
   const popup=document.createElement('div');el(popup,'strong','Você está aqui');
   el(popup,'p','Posição obtida pelo GPS do dispositivo.');
   rider.bindPopup(popup);
  }else rider.setLatLng(point);
  if(accuracyCircle){accuracyCircle.setLatLng(point);accuracyCircle.setRadius(Math.max(1,accuracy));}
  else accuracyCircle=L.circle(point,{radius:Math.max(1,accuracy),color:'#2563eb',
   weight:1,fillColor:'#60a5fa',fillOpacity:.06,interactive:false}).addTo(gpsLayer);
  return true;
 }
 function clearGps(){
  if(rider){gpsLayer.removeLayer(rider);rider=null;}
  if(accuracyCircle){gpsLayer.removeLayer(accuracyCircle);accuracyCircle=null;}
  gpsPoint=null;
 }
 return {setData,setGps,clearGps,fitAll,stats:()=>stats,
  focusGps(){if(!gpsPoint)return false;map.setView(gpsPoint,16);return true;},
  resize(){map.invalidateSize();},destroy(){map.remove()}};
}
