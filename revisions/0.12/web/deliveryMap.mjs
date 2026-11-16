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

export async function mountDeliveryMap(container, { center, radius, onSelect }) {
  const L = await leaflet();
  if (!container.isConnected) return;
  const map = L.map(container, { scrollWheelZoom: false }).setView(center || [-14.24, -51.93], center ? 14 : 4);
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
  }).addTo(map);
  const style = { color: '#c2410c', fillOpacity: 0.14, interactive: false };
  let circle, marker;
  function setArea(point, meters, focus = false) {
    circle?.remove();
    if (!point || !meters) return;
    circle = L.circle(point, { ...style, radius: meters }).addTo(map);
    if (focus) map.fitBounds(circle.getBounds(), { padding: [18, 18], maxZoom: 16 });
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

export function currentLocation() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) return reject(new Error('Este dispositivo não fornece localização.'));
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => resolve([Number(coords.latitude.toFixed(6)), Number(coords.longitude.toFixed(6))]),
      () => reject(new Error('Não foi possível obter sua localização. Confira a permissão do dispositivo.')),
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 },
    );
  });
}
