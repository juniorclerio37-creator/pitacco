// Links universais oficiais: abrem Maps/Waze instalados ou o navegador como fallback.
// Um link é criado a partir dos dados da entrega específica; nunca reusa rota anterior.
export function routeDestination(delivery, mode = 'address') {
  if (!delivery || typeof delivery !== 'object') return null;
  const address = String(delivery.address ?? '').trim().slice(0, 1000);
  const latRaw = delivery.latitude;
  const longRaw = delivery.longitude;
  const lat = Number(latRaw), long = Number(longRaw);
  const coordinatesValid = latRaw !== null && latRaw !== undefined && latRaw !== '' &&
    longRaw !== null && longRaw !== undefined && longRaw !== '' &&
    Number.isFinite(lat) && Number.isFinite(long) &&
    lat >= -90 && lat <= 90 && long >= -180 && long <= 180 &&
    !(lat === 0 && long === 0);
  const coordinates = coordinatesValid ? lat + ',' + long : null;
  if (mode === 'coords') return coordinates || address || null;
  return address || coordinates;
}
export function buildNavigationUrl(delivery, provider = 'google', mode = 'address') {
  const destination = routeDestination(delivery, mode);
  if (!destination) return null;
  if (provider === 'waze') {
    const isCoords = destination === routeDestination(delivery, 'coords') &&
      destination.includes(',') && Number.isFinite(Number(destination.split(',')[0])) &&
      Number.isFinite(Number(destination.split(',')[1]));
    const param = isCoords ? 'll' : 'q';
    return 'https://waze.com/ul?' + param + '=' +
      encodeURIComponent(destination) + '&navigate=yes';
  }
  if (provider !== 'google') return null;
  return 'https://www.google.com/maps/dir/?api=1&destination=' +
    encodeURIComponent(destination) + '&travelmode=driving&dir_action=navigate';
}
