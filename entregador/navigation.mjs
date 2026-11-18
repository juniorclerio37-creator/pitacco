// Links universais oficiais para abrir app instalado ou fallback web.
// A rota é construída SOMENTE com os dados da entrega escolhida.
export function routeTarget(delivery, mode = 'address') {
  if (!delivery || typeof delivery !== 'object') return null;
  const address = String(delivery.address ?? '').trim().slice(0, 1000);
  const rawLat = delivery.latitude, rawLong = delivery.longitude;
  const meaningful = value => (typeof value === 'number' || typeof value === 'string') && String(value).trim() !== '';
  const lat = Number(rawLat), long = Number(rawLong);
  const hasCoords = meaningful(rawLat) && meaningful(rawLong) &&
    Number.isFinite(lat) && Number.isFinite(long) &&
    lat >= -90 && lat <= 90 && long >= -180 && long <= 180 &&
    !(lat === 0 && long === 0);
  const coords = hasCoords ? {value: lat + ',' + long, kind: 'coords'} : null;
  const addr = address ? {value: address, kind: 'address'} : null;
  return mode === 'coords' ? coords || addr : addr || coords;
}
export function routeDestination(delivery, mode = 'address') {
  return routeTarget(delivery, mode)?.value ?? null;
}
export function buildNavigationUrl(delivery, provider = 'google', mode = 'address') {
  const target = routeTarget(delivery, mode);
  if (!target) return null;
  const encoded = encodeURIComponent(target.value);
  if (provider === 'waze') {
    return 'https://waze.com/ul?' + (target.kind === 'coords' ? 'll=' : 'q=') +
      encoded + '&navigate=yes';
  }
  if (provider === 'google') {
    return 'https://www.google.com/maps/dir/?api=1&destination=' +
      encoded + '&travelmode=driving&dir_action=navigate';
  }
  return null;
}

/**
 * Abre o percurso com paradas na ordem já SUGERIDA, sem reotimização.
 * Google Maps URLs suporta no máximo 3 waypoints intermediários em
 * navegadores móveis. Waze Deep Links aceita apenas um destino por link.
 */
export function buildBatchNavigationUrl(deliveries,provider='google',mode='address') {
  if(provider!=='google'||!Array.isArray(deliveries)||
     deliveries.length<2||deliveries.length>4)return null;
  const targets=deliveries.map(delivery=>routeTarget(delivery,mode));
  if(targets.some(target=>!target))return null;
  const destination=encodeURIComponent(targets[targets.length-1].value);
  const waypoints=encodeURIComponent(targets.slice(0,-1).map(target=>target.value).join('|'));
  return 'https://www.google.com/maps/dir/?api=1&destination='+
    destination+'&waypoints='+waypoints+'&travelmode=driving&dir_action=navigate';
}
