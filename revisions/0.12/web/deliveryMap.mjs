
// Illustrated storefront marker shared by the shop picker, delivery coverage
// and fleet map. The bottom of the pin is the actual latitude/longitude.
export function illustratedShopIcon(L) {
  const html = `<svg xmlns="http://www.w3.org/2000/svg" width="58" height="68"
    viewBox="0 0 58 68" aria-hidden="true" focusable="false">
    <defs><filter id="pitacco-shop-shadow" x="-30%" y="-25%" width="160%" height="170%">
      <feDropShadow dx="0" dy="2" stdDeviation="2" flood-opacity=".23"/>
    </filter></defs>
    <path filter="url(#pitacco-shop-shadow)"
      d="M29 2C14.5 2 3 13.4 3 28c0 18.5 20.3 30.8 26 38
      5.7-7.2 26-19.5 26-38C55 13.4 43.5 2 29 2Z"
      fill="#ea580c" stroke="#fff" stroke-width="2.5" stroke-linejoin="round"/>
    <circle cx="29" cy="27.5" r="21.5" fill="#fff7ed"/>
    <rect x="15" y="25" width="28" height="18" rx="2" fill="#fff" stroke="#9a3412" stroke-width="1.5"/>
    <rect x="16" y="23" width="26" height="4" rx="1" fill="#fed7aa"/>
    <path d="M15 23.2h28l-3.6-8.8H18.6L15 23.2Z" fill="#fb923c" stroke="#c2410c" stroke-width="1.2"/>
    <path d="M18.6 14.4h4.1L21.8 23H15l3.6-8.6ZM27.1 14.4h4l1.1 8.6h-6l.9-8.6ZM35.3 14.4h4.1L43 23h-6.8l-.9-8.6Z" fill="#fff"/>
    <path d="M15 23c0 3.3 4.7 3.3 4.7 0s4.7 3.3 4.7 0 4.7 3.3 4.7 0 4.7 3.3 4.7 0 4.7 3.3 4.7 0 4.5 3.3 4.5 0"
      fill="none" stroke="#c2410c" stroke-width="1.2" stroke-linecap="round"/>
    <rect x="19.2" y="30" width="8" height="7.5" rx="1" fill="#bae6fd" stroke="#0e7490" stroke-width="1.1"/>
    <path d="M23.2 30v7.5" stroke="#0e7490" stroke-width=".8"/>
    <rect x="31.2" y="29.5" width="8" height="13.5" rx="1" fill="#fed7aa" stroke="#9a3412" stroke-width="1.2"/>
    <circle cx="37" cy="36.5" r="1" fill="#c2410c"/>
    <rect x="13" y="42" width="32" height="2" rx="1" fill="#9a3412"/>
  </svg>`;
  return L.divIcon({
    className:'pitacco-illustrated-shop-pin',
    html, iconSize:[58,68], iconAnchor:[29,65], popupAnchor:[0,-58],
  });
}

let leafletPromise;
function leaflet() {
  if (!leafletPromise) {
    const base = 'https://unpkg.com/leaflet@1.9.4/dist/';
    leafletPromise = Promise.all([
      ['link', 'href', 'leaflet.css', 'sha256-p4NxAoJBhIIN+hmNHrzRCf9tD/miZyoHS5obTRR9BMY='],
      ['script', 'src', 'leaflet.js', 'sha256-20nQCchB9co0qIjJZRGuk2/Z9VM+kNiyxNV1lvTlZBo='],
    ].map(([tag, source, file, integrity]) => new Promise((resolve, reject) => {
      const element = document.createElement(tag);
      if (tag === 'link') element.rel = 'stylesheet';
      element.crossOrigin = 'anonymous';
      element.integrity = integrity;
      element[source] = base + file;
      element.onload = resolve;
      element.onerror = () => { element.remove(); reject(new Error('Não foi possível abrir o mapa.')); };
      document.head.append(element);
    }))).then(() => window.L).catch(error => {
      leafletPromise = undefined;
      throw error;
    });
  }
  return leafletPromise;
}

export async function mountDeliveryMap(container, { center, radius, onSelect, mode='circle', polygon=[] }) {
  const L = await leaflet();
  if (!container.isConnected) return;
  const map = L.map(container, { scrollWheelZoom: false }).setView(center || [-14.24, -51.93], center ? 14 : 4);
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
  }).addTo(map);
  const style = { color: '#c2410c', fillOpacity: 0.14, interactive: false };
  let shape, marker;
  function setArea(point, meters, focus = false) {
    shape?.remove();
    if (!point) return;
    // Show exactly the geographical boundary the merchant saved.
    if (mode==='polygon' && Array.isArray(polygon) && polygon.length>=3) {
      shape=L.polygon(polygon,{...style,color:'#ea580c',weight:3}).addTo(map);
    }else if(meters) {
      shape=L.circle(point,{...style,color:'#ea580c',weight:3,radius:meters}).addTo(map);
    }
    if (focus && shape) map.fitBounds(shape.getBounds(), {padding:[18,18],maxZoom:16});
  }
  function setPoint(point) {
    marker?.remove();
    marker = L.circleMarker(point, { ...style, radius: 7, fillOpacity: 0.85 }).addTo(map);
  }
  setArea(center, radius, true);
  map.on('click', ({ latlng }) => {
    const point = [Number(latlng.lat.toFixed(6)), Number(latlng.wrap().lng.toFixed(6))];
    onSelect(point);
  });
  return {
    setArea, setPoint,
    clearPoint() { marker?.remove(); },
    showPoint(point) { setPoint(point); map.panTo(point); },
    resize() { map.invalidateSize(); },
    remove() { map.remove(); },
  };
}


/**
 * Editable store pin in Dados da loja. All coordinates are internal:
 * the merchant sees a draggable shop marker, never numeric coordinates.
 */
export async function mountStorePointPicker(container,{center,viewCenter,onSelect}){
 const L=await leaflet();
 if(!container.isConnected)throw Error('Mapa fechado.');
 const map=L.map(container,{scrollWheelZoom:false}).setView(
  center||viewCenter||[-14.24,-51.93],center?17:viewCenter?13:4);
 L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',{
  maxZoom:19,attribution:'&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
 }).addTo(map);
 const icon=illustratedShopIcon(L);
 let marker;
 const set=(point,notify=false)=>{
  if(!Array.isArray(point)||point.length!==2)return;
  const lat=Number(point[0]),lng=Number(point[1]);
  if(!Number.isFinite(lat)||!Number.isFinite(lng)||Math.abs(lat)>90||Math.abs(lng)>180)return;
  const rounded=[Number(lat.toFixed(6)),Number(lng.toFixed(6))];
  if(!marker){
   marker=L.marker(rounded,{icon,draggable:true,title:'Arraste para marcar a entrada da loja'})
    .bindPopup('Entrada da sua loja').addTo(map);
   marker.on('dragend',()=>{
    const next=marker.getLatLng();
    set([next.lat,next.lng],true);
   });
  }else marker.setLatLng(rounded);
  map.panTo(rounded);
  if(notify)onSelect?.(rounded);
 };
 map.on('click',({latlng})=>set([latlng.lat,latlng.lng],true));
 if(center)set(center,false);
 map.invalidateSize();
 return{
  setPoint(point,focus=true){set(point,false);if(focus)map.setView(point,17)},
  focus(point,zoom=14){if(Array.isArray(point)&&point.length===2)map.setView(point,zoom)},
  resize(){map.invalidateSize()},
  remove(){map.remove()}
 };
}

export function currentDeviceLocation() {
  return new Promise((resolve,reject)=>{
    // Browser Geolocation works on Android, iOS and desktops that expose
    // OS-provided position; computers may return Wi-Fi/IP-level estimates.
    if(typeof navigator==='undefined'||!navigator.geolocation)
      return reject(new Error('Este dispositivo ou navegador não oferece localização.'));
    navigator.geolocation.getCurrentPosition(({coords})=>{
      const lat=Number(coords.latitude),lng=Number(coords.longitude);
      const accuracy=Number(coords.accuracy);
      if(!Number.isFinite(lat)||!Number.isFinite(lng)||
         lat < -90||lat > 90||lng < -180||lng > 180)
        return reject(new Error('O dispositivo retornou uma posição inválida.'));
      resolve({point:[Number(lat.toFixed(6)),Number(lng.toFixed(6))],
        accuracyMeters:Number.isFinite(accuracy)&&accuracy>0?Math.ceil(accuracy):null});
    },error=>{
      const detail=error?.code===1?'Permissão de localização negada no navegador ou sistema.'
        :error?.code===2?'O sistema não conseguiu determinar a posição.'
        :error?.code===3?'A localização demorou demais.'
        :'Não foi possível obter a localização.';
      reject(new Error(detail));
    },{enableHighAccuracy:true,timeout:15000,maximumAge:0});
  });
}
export async function currentLocation(){
  return (await currentDeviceLocation()).point;
}

// Map for the merchant's live fleet. Reuses the same pinned Leaflet dependency
// and tile layer as the existing delivery-area map; does not alter dispatch logic.
export async function mountFleetMap(container) {
  const L = await leaflet();
  if (!container.isConnected) throw new Error('A tela do mapa foi fechada.');
  const map = L.map(container, {scrollWheelZoom: false, preferCanvas: true}).setView([-14.24, -51.93], 4);
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
  }).addTo(map);
  const markers = L.layerGroup().addTo(map);
  let fitted = false, fittedShop = false, lastOnlineIds = '';
  let lastSelectedCourier = '';
  const valid = item => item && item.latitude != null && item.longitude != null &&
    Number.isFinite(Number(item.latitude)) && Number.isFinite(Number(item.longitude)) &&
    Number(item.latitude) >= -90 && Number(item.latitude) <= 90 &&
    Number(item.longitude) >= -180 && Number(item.longitude) <= 180;
  const point = item => [Number(item.latitude), Number(item.longitude)];
  function popup(label, details) {
    const node = document.createElement('div');
    const title = document.createElement('strong');
    title.textContent = label;
    const description = document.createElement('div');
    description.textContent = details;
    node.append(title, description);
    return node;
  }
  function icon(kind, active) {
    if(kind==='store')return illustratedShopIcon(L);
    const html = '<span>🛵</span>';
    return L.divIcon({
      html,
      className: 'fleet-map-pin fleet-map-pin-' + kind + (active ? ' fleet-map-pin-active' : ''),
      iconSize: [38, 38], iconAnchor: [19, 19],
    });
  }
  function update({store, couriers = [], deliveries = [], selectedRoute = '', selectedCourier = ''} = {}) {
    markers.clearLayers();
    const bounds = [];
    if (valid(store)) {
      L.marker(point(store), {icon: icon('store', false)}).bindPopup(popup(store.name || 'Loja', 'Ponto de saída')).addTo(markers);
      bounds.push(point(store));
    }
    for (const courier of couriers) {
      if (!valid(courier.position)) continue;
      const coords = point(courier.position);
      const fresh = courier.signal === 'online';
      const focused = courier.id === selectedCourier;
      const marker = L.marker(coords, {icon: icon(fresh ? 'online' : 'stale', focused)})
        .bindPopup(popup(courier.name || 'Motoboy',
          (fresh ? 'GPS atualizado' : 'Última localização (sem sinal atual)') + ' · ' + (courier.phase || ''))).addTo(markers);
      if (focused) marker.openPopup();
      bounds.push(coords);
      if (fresh && Number(courier.position.accuracy_m) > 0 && Number(courier.position.accuracy_m) < 500) {
        L.circle(coords, {radius: Number(courier.position.accuracy_m), color: '#f97316',
          fillOpacity: .05, weight: 1, interactive: false}).addTo(markers);
      }
    }
    const routePoints = [];
    for (const delivery of deliveries) {
      if (!valid(delivery)) continue;
      const focused = Boolean(selectedRoute && (delivery.batch_id || 'avulsa:' + delivery.id) === selectedRoute);
      const isDim = Boolean(selectedRoute && !focused);
      const coords = point(delivery);
      L.circleMarker(coords, {radius: focused ? 10 : 8, color: isDim ? '#aeb5c0' : '#f97316',
        weight: 3, fillColor: isDim ? '#cbd5e1' : '#fff7ed', fillOpacity: .95})
        .bindPopup(popup(delivery.customer_name || 'Ponto de entrega', delivery.address || 'Endereço não informado')).addTo(markers);
      if (!isDim) bounds.push(coords);
      if (focused) routePoints.push(coords);
    }
    if (selectedRoute && routePoints.length && valid(store)) {
      L.polyline([point(store), ...routePoints], {
        color: '#f97316', weight: 3, opacity: .7, dashArray: '7 9', interactive: false,
      }).addTo(markers);
    }
    // Initial view ALWAYS prioritizes the shop. If a shared courier comes
    // online later, refit once to include the shop and all online riders.
    // Ordinary 10-second GPS updates never pull the map away from the user.
    const visibleOnline = couriers.filter(c => c.signal === 'online' && valid(c.position));
    const onlineIds = visibleOnline.map(c => c.id).sort().join(',');
    const storeIsReady = valid(store);
    if (storeIsReady && (!fittedShop ||
        (onlineIds !== lastOnlineIds && visibleOnline.length > 0))) {
      fittedShop = true;
      fitted = true;
      const shopBounds = [point(store),...visibleOnline.map(c => point(c.position))];
      if (shopBounds.length === 1) map.setView(shopBounds[0], 16);
      else map.fitBounds(shopBounds, {padding:[40,40],maxZoom:16});
    } else if (!fitted && bounds.length) {
      fitted = true;
      if (bounds.length === 1) map.setView(bounds[0], 15);
      else map.fitBounds(bounds, {padding:[35,35],maxZoom:15});
    }
    if (selectedCourier && selectedCourier !== lastSelectedCourier) {
      const selected = couriers.find(c=>c.id===selectedCourier&&valid(c.position));
      if (selected) map.panTo(point(selected.position));
    }
    lastSelectedCourier = selectedCourier;
    lastOnlineIds = onlineIds;
    map.invalidateSize();
  }
  return {
    update,
    resize() {map.invalidateSize();},
    remove() {map.remove();},
  };
}


/**
 * Customer-facing approximate courier location.
 * Use ONLY the coordinates from pitacco_track_public_order(token), which
 * returns a rounded, 90-second-fresh point for the current own delivery.
 * This map never reads courier_positions or other orders from the browser.
 */
export async function mountCustomerTrackingMap(container) {
  const L = await leaflet();
  if (!container.isConnected) throw new Error('O acompanhamento foi fechado.');
  const map = L.map(container, {scrollWheelZoom: false, preferCanvas: true, zoomControl: true})
    .setView([-14.24, -51.93], 4);
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
  }).addTo(map);
  const markerIcon = L.divIcon({
    className: 'pitacco-customer-courier-pin',
    html: '<span aria-hidden="true">🛵</span>',
    iconSize: [42, 42],
    iconAnchor: [21, 21],
  });
  let marker = null, uncertainty = null, firstPoint = true;
  const validPoint = p => p && p.latitude != null && p.longitude != null &&
    Number.isFinite(Number(p.latitude)) && Number.isFinite(Number(p.longitude)) &&
    Number(p.latitude) >= -90 && Number(p.latitude) <= 90 &&
    Number(p.longitude) >= -180 && Number(p.longitude) <= 180;
  return {
    update(position) {
      if (!validPoint(position)) return false;
      const next = L.latLng(Number(position.latitude), Number(position.longitude));
      if (!marker) {
        marker = L.marker(next, {icon: markerIcon, title: 'Posição aproximada do entregador'}).addTo(map);
        marker.bindPopup('Posição aproximada do entregador');
        uncertainty = L.circle(next, {
          radius: 140, color: '#ea580c', weight: 1.5, fillColor: '#fdba74',
          fillOpacity: 0.12, interactive: false,
        }).addTo(map);
      } else {
        marker.setLatLng(next);
        uncertainty.setLatLng(next);
      }
      map.invalidateSize();
      if (firstPoint) {
        map.setView(next, 15);
        firstPoint = false;
      } else if (!map.getBounds().contains(next)) {
        map.panTo(next);
      }
      return true;
    },
    resize() { map.invalidateSize(); },
    remove() { map.remove(); },
  };
}


/**
 * Reuses the map for configuring the shop's delivery coverage.
 * Circle uses the geographical line-of-sight radius (NOT driving distance).
 * In polygon mode, click to add vertices, drag a vertex to correct it, then
 * click Save in the merchant portal. Coordinates remain internal to the UI.
 */
export async function mountDeliveryCoverageMap(container,{
 center,mode='circle',radiusKm=5,vertices=[],regions=[],activeRegionId=null,
 onVerticesChange,onSelectRegion
}={}){
 const L=await leaflet();
 if(!container.isConnected)throw Error('O mapa foi fechado.');
 const hasOrigin=Array.isArray(center)&&center.length===2&&center.every(x=>Number.isFinite(Number(x)));
 const point=hasOrigin?center:[-14.24,-51.93];
 const map=L.map(container,{scrollWheelZoom:false,zoomControl:true})
  .setView(point,hasOrigin?14:4);
 L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',{
  maxZoom:19,attribution:'&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
 }).addTo(map);
 const shopIcon=illustratedShopIcon(L);
 if(hasOrigin)L.marker(point,{icon:shopIcon,interactive:true,
  title:'Sua loja — centro da área de entrega'})
  .bindPopup('Sua loja: ponto de partida das entregas').addTo(map);
 const coverage=L.layerGroup().addTo(map);
 const palette=['#ea580c','#2563eb','#059669','#9333ea','#d97706',
  '#db2777','#0e7490','#be123c','#64748b','#0d9488','#7c3aed','#ca8a04'];
 const valid=v=>Array.isArray(v)&&v.length===2&&Number.isFinite(Number(v[0]))&&Number.isFinite(Number(v[1]))&&
  Number(v[0])>=-90&&Number(v[0])<=90&&Number(v[1])>=-180&&Number(v[1])<=180;
 const copyVertices=vertices=>(Array.isArray(vertices)?vertices:[])
  .filter(valid).map(v=>[Number(v[0]),Number(v[1])]);
 const cloneRegions=items=>(Array.isArray(items)?items:[]).map((item,i)=>({
  id:String(item.id||i),name:String(item.name||'Região '+(i+1)),
  vertices:copyVertices(item.vertices),fee:Number(item.fee||0)
 }));
 let selectedMode=mode,km=radiusKm;
 let polygonRegions=cloneRegions(regions);
 let selectedId=activeRegionId;
 if(!polygonRegions.length&&vertices.length){
  polygonRegions=[{id:'legacy',name:'Região 1',vertices:copyVertices(vertices),fee:0}];
  selectedId='legacy';
 }
 const selected=()=>polygonRegions.find(region=>region.id===selectedId)||null;
 function render(focus=false){
  coverage.clearLayers();
  if(selectedMode==='circle'){
   if(hasOrigin){
    const circle=L.circle(point,{radius:km*1000,color:'#ea580c',weight:3,opacity:.95,
     fillColor:'#fb923c',fillOpacity:.12}).addTo(coverage);
    if(focus)map.fitBounds(circle.getBounds(),{padding:[22,22],maxZoom:16});
   }
  }else{
   polygonRegions.forEach((region,index)=>{
    const color=palette[index%palette.length];
    const active=region.id===selectedId;
    const pts=region.vertices;
    let geometry;
    if(pts.length>=3)geometry=L.polygon(pts,{
     color,weight:active?4:2.5,
     fillColor:color,fillOpacity:active?.22:.09,
     interactive:!active
    }).addTo(coverage);
    else if(pts.length>=2)geometry=L.polyline(pts,{
     color,weight:active?4:2.5,dashArray:'6 5',interactive:!active
    }).addTo(coverage);
    if(geometry){
     geometry.bindTooltip(region.name+' — R$ '+Number(region.fee||0).toFixed(2).replace('.',','),{
      direction:'top',sticky:true
     });
     if(!active){
      geometry.on('click',e=>{
       if(e.originalEvent)L.DomEvent.stopPropagation(e.originalEvent);
       selectedId=region.id;
       onSelectRegion?.(region.id);
       render(false);
      });
     }
    }
    if(!active)return;
    pts.forEach((vertex,vertexIndex)=>{
     const handle=L.marker(vertex,{
      icon:L.divIcon({className:'pitacco-polygon-handle',
       html:'<span aria-hidden="true">'+(vertexIndex+1)+'</span>',
       iconSize:[30,30],iconAnchor:[15,15]}),
      draggable:true,title:'Arraste o ponto '+(vertexIndex+1)
     }).addTo(coverage);
     handle.bindTooltip('Arraste o ponto '+(vertexIndex+1),{direction:'top'});
     handle.on('dragend',()=>{
      const p=handle.getLatLng();
      region.vertices[vertexIndex]=[Number(p.lat.toFixed(6)),Number(p.lng.toFixed(6))];
      render(false);
      onVerticesChange?.(region.vertices.map(v=>[...v]),region.id);
     });
    });
   });
   const current=selected();
   if(focus&&current?.vertices.length)map.fitBounds(current.vertices,{
    padding:[24,24],maxZoom:16
   });
  }
  map.invalidateSize();
 }
 map.on('click',({latlng})=>{
  if(selectedMode!=='polygon')return;
  const region=selected();
  if(!region||region.vertices.length>=30)return;
  region.vertices.push([Number(latlng.lat.toFixed(6)),Number(latlng.lng.toFixed(6))]);
  render(false);
  onVerticesChange?.(region.vertices.map(v=>[...v]),region.id);
 });
 render(true);
 return{
  setMode(next){selectedMode=next;render(true)},
  setRadius(next){km=Number(next);render(true)},
  setRegions(next,nextActiveId){
   polygonRegions=cloneRegions(next);
   selectedId=nextActiveId;
   render(false);
  },
  // Compatible with the original one-polygon editor.
  setVertices(next){
   const region=selected();
   if(region){region.vertices=copyVertices(next);render(false);}
  },
  focusRegion(id){
   const region=polygonRegions.find(r=>r.id===id);
   if(region?.vertices.length)map.fitBounds(region.vertices,{padding:[24,24],maxZoom:16});
  },
  resize(){map.invalidateSize()},
  remove(){map.remove()}
 };
}
