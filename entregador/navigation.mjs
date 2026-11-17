// Links universais oficiais para abrir app instalado ou fallback web.
// A rota é construída SOMENTE com os dados da entrega escolhida.
export function routeTarget(delivery, mode = 'address') {
  if (!delivery || typeof delivery !== 'object') return null;
  const address = String(delivery.address ?? '').trim().slice(0, 1000);
  const rawLat = delivery.latitude, rawLong = delivery.longitude;
  const lat = Number(rawLat), long = Number(rawLong);
  const hasCoords = rawLat !== null && rawLat !== undefined && rawLat !== '' &&
    rawLong !== null && rawLong !== undefined && rawLong !== '' &&
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
