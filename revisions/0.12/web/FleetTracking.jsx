import React, {useEffect, useMemo, useRef, useState} from 'react';
import {Bike, MapPin, Navigation, Route, Store, WifiOff} from 'lucide-react';
import {mountFleetMap} from './deliveryMap.mjs';
import './fleet-tracking.css';

const CLOSED = new Set(['entregue', 'cancelada', 'cancelado', 'completed', 'delivered']);
const GPS_FRESH_MS = 120000;
export function validPoint(row) {
  if (!row || row.latitude === null || row.longitude === null ||
      row.latitude === undefined || row.longitude === undefined) return false;
  const lat = Number(row.latitude), lng = Number(row.longitude);
  return Number.isFinite(lat) && Number.isFinite(lng) && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180;
}
export function gpsStatus(courier, position, now = Date.now()) {
  if (!courier.active || !courier.available) return 'offline';
  const observed = Date.parse(position?.observed_at || '');
  if (!validPoint(position) || !Number.isFinite(observed) || observed > now + 30000 || now - observed > GPS_FRESH_MS) return 'stale';
  return 'online';
}
export function mapsStopUrl(stop) {
  if (!validPoint(stop)) return null;
  return 'https://www.google.com/maps/dir/?api=1&destination=' +
    encodeURIComponent(Number(stop.latitude) + ',' + Number(stop.longitude)) + '&travelmode=driving';
}
export function activeOwnDeliveries(rows) {
  return (rows || []).filter(d => d.logistics_provider === 'loja' && !CLOSED.has(String(d.status || '').toLowerCase()));
}
function ago(value) {
  const millis = Date.parse(value || '');
  if (!Number.isFinite(millis)) return 'sem localização';
  const minutes = Math.max(0, Math.floor((Date.now() - millis) / 60000));
  return minutes < 1 ? 'agora' : minutes < 60 ? 'há ' + minutes + ' min' : 'há ' + Math.floor(minutes / 60) + ' h';
}
function groupRoutes(deliveries) {
  const routes = new Map();
  for (const d of deliveries) {
    const key = d.batch_id || 'avulsa:' + d.id;
    if (!routes.has(key)) routes.set(key, {id: key, courierId: d.courier_id, stops: []});
    routes.get(key).stops.push(d);
  }
  return [...routes.values()].sort((a, b) => {
    const aa = a.stops[0]?.created_at || '', bb = b.stops[0]?.created_at || '';
    return bb.localeCompare(aa);
  });
}

export default function FleetTracking({client, storeId, onBack}) {
  const [state, setState] = useState({store: null, couriers: [], deliveries: [], positions: []});
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [updatedAt, setUpdatedAt] = useState(null);
  const [selectedRoute, setSelectedRoute] = useState('');
  const [selectedCourier, setSelectedCourier] = useState('');
  const [panel, setPanel] = useState('routes');
  const [originStatus, setOriginStatus] = useState('idle');
  const [originAttempt, setOriginAttempt] = useState(0);
  const requestedOrigin = useRef(null);
  const mapContainer = useRef(null), mapInstance = useRef(null), snapshot = useRef(null);

  useEffect(() => {
    let alive = true, running = false;
    async function refresh() {
      if (running) return;
      running = true;
      try {
        const [storeResult, couriersResult, deliveriesResult] = await Promise.all([
          client.from('stores')
            .select('id,name,latitude,longitude,address,address_number,neighborhood,city,state,postal_code')
            .eq('id', storeId).single(),
          // This RPC returns couriers assigned directly AND authorized shared
          // couriers. Filtering couriers.store_id hid the test-store rider.
          client.rpc('pitacco_store_couriers', {p_store: storeId}),
          client.from('deliveries')
            .select('id,order_id,store_id,courier_id,status,logistics_provider,latitude,longitude,batch_id,address,customer_name,created_at')
            .eq('store_id', storeId).order('created_at', {ascending: false}).limit(200),
        ]);
        const failure = storeResult.error || couriersResult.error || deliveriesResult.error;
        if (failure) throw failure;
        const couriers = couriersResult.data || [];
        const ids = couriers.map(c => c.id);
        const positionsResult = ids.length
          ? await client.from('courier_positions')
              .select('courier_id,latitude,longitude,observed_at,accuracy_m').in('courier_id', ids)
          : {data: [], error: null};
        if (positionsResult.error) throw positionsResult.error;
        if (alive) {
          setState({store: storeResult.data, couriers, deliveries: deliveriesResult.data || [], positions: positionsResult.data || []});
          setUpdatedAt(new Date());
          setError('');
        }
      } catch (err) {
        if (alive) setError('Não foi possível atualizar o mapa: ' + (err.message || String(err)));
      } finally {
        running = false;
        if (alive) setLoading(false);
      }
    }
    void refresh();
    const timer = window.setInterval(() => {
      if (document.visibilityState !== 'hidden') void refresh();
    }, 10000);
    return () => {alive = false; window.clearInterval(timer);};
  }, [client, storeId]);

  // Existing saved street address is translated to a map point server-side.
  // The merchant never sees or types latitude and longitude.
  const storeHasAddress = Boolean(state.store?.address?.trim() &&
    state.store?.city?.trim() && state.store?.state?.trim());
  useEffect(() => {
    if (!state.store || state.store.id !== storeId) return;
    if (validPoint(state.store)) {setOriginStatus('ready');return;}
    if (!storeHasAddress) {setOriginStatus('missing-address');return;}
    const key = storeId + ':' + originAttempt;
    if (requestedOrigin.current === key) return;
    requestedOrigin.current = key;
    let alive = true;
    setOriginStatus('loading');
    (async () => {
      try {
        const {data, error} = await client.functions.invoke('delivery-quote', {
          body: {action:'store-origin', store_id:storeId},
        });
        if (error) throw error;
        if (!validPoint(data)) throw Error(data?.error || 'Endereço não localizado');
        if (!alive) return;
        setState(previous => previous.store?.id !== storeId ? previous : ({
          ...previous, store: {...previous.store,
            latitude:Number(data.latitude), longitude:Number(data.longitude)},
        }));
        setOriginStatus('ready');
      } catch {
        if (alive) setOriginStatus('error');
      }
    })();
    return () => {alive=false;};
  }, [client,storeId,state.store?.id,state.store?.latitude,state.store?.longitude,
      state.store?.address,state.store?.city,state.store?.state,storeHasAddress,originAttempt]);

  const active = useMemo(() => activeOwnDeliveries(state.deliveries), [state.deliveries]);
  const positions = useMemo(() => new Map(state.positions.map(p => [p.courier_id, p])), [state.positions]);
  const routes = useMemo(() => groupRoutes(active), [active]);
  const couriers = useMemo(() => state.couriers.map(c => {
    const position = positions.get(c.id);
    const signal = gpsStatus(c, position);
    const jobs = active.filter(d => d.courier_id === c.id);
    const phase = jobs.some(d => d.status === 'retirada') ? 'Em entrega' : jobs.length ? 'Em coleta' : 'Disponível';
    return {...c, position, signal, phase, jobCount: jobs.length};
  }), [state.couriers, positions, active]);
  const hasPoints = validPoint(state.store) || active.some(validPoint) || couriers.some(c => validPoint(c.position));
  const visibleRoutes = selectedRoute ? routes.filter(r => r.id === selectedRoute) : routes;
  snapshot.current = {store: state.store, couriers, deliveries: active, selectedRoute, selectedCourier};
  useEffect(() => {
    if (!hasPoints || !mapContainer.current) return;
    let cancelled = false;
    mountFleetMap(mapContainer.current).then(instance => {
      if (cancelled) {instance.remove(); return;}
      mapInstance.current = instance;
      instance.update(snapshot.current);
    }).catch(err => {if (!cancelled) setError('O mapa não abriu: ' + (err.message || String(err)));});
    return () => {cancelled = true; mapInstance.current?.remove(); mapInstance.current = null;};
  }, [hasPoints, storeId]);
  useEffect(() => {mapInstance.current?.update(snapshot.current);}, [state, couriers, active, selectedCourier, selectedRoute]);

  const pending = active.filter(d => !d.courier_id).length;
  const online = couriers.filter(c => c.signal === 'online').length;
  return <section className="pitacco-fleet" aria-label="Roteirização e mapa das entregas">
    <div className="fleet-heading">
      <div><h3><Route size={20}/> Roteirização e mapa</h3>
        <p>GPS dos entregadores e pontos de entrega da sua loja. Atualização automática a cada 10 segundos.</p></div>
      <div className="fleet-heading-actions">
        <button type="button" className="secondary" onClick={onBack}>Voltar às colunas</button>
      </div>
    </div>
    <div className="fleet-stats">
      <span><Store size={16}/> {state.store?.name || 'Sua loja'}</span>
      <span><Bike size={16}/> {online} com GPS ativo / {couriers.length} motoboys</span>
      <span><MapPin size={16}/> {active.length} entregas ativas</span>
      <span>{pending} sem motoboy</span>
    </div>
    {error && <p className="fleet-error" role="alert">{error}</p>}
    {loading && <p role="status">Carregando localização da loja e entregadores…</p>}
    <div className="fleet-grid">
      <div className="fleet-map-column">
        {hasPoints ? <div ref={mapContainer} className="fleet-map" aria-label="Mapa interativo de entregadores e entregas"/> :
          <div className="fleet-map fleet-empty"><MapPin size={32}/>
            <strong>{loading||originStatus==='loading'?'Localizando sua loja no mapa…':'Localização da loja indisponível'}</strong>
            <p>{originStatus==='missing-address'
              ? 'Cadastre o endereço da loja em Administrar Loja → Dados e identidade.'
              : 'O Pitacco utiliza o endereço cadastrado para encontrar sua loja automaticamente. Confira os dados do endereço se necessário.'}</p>
            {!loading&&originStatus==='error'&&<button type="button" className="secondary"
              onClick={()=>{requestedOrigin.current=null;setOriginAttempt(n=>n+1);}}>Tentar localizar novamente</button>}
          </div>}
        <div className="fleet-legend">
          <span><i className="fleet-dot" data-kind="store"/> Loja</span>
          <span><i className="fleet-dot" data-kind="online"/> GPS atualizado</span>
          <span><i className="fleet-dot" data-kind="stale"/> Sem sinal / offline</span>
          <span><i className="fleet-dot" data-kind="delivery"/> Entrega</span>
        </div>
        <p className="fleet-hint">As linhas tracejadas representam agrupamentos, não trajetos pelas ruas. A navegação real abre no Google Maps.</p>
        <small>{updatedAt ? 'Última atualização: ' + updatedAt.toLocaleTimeString('pt-BR') : 'Aguardando atualização'}</small>
      </div>
      <aside className="fleet-side">
        <div className="fleet-side-tabs" role="group" aria-label="Exibir listas">
          <button type="button" aria-pressed={panel === 'routes'} className={panel === 'routes' ? 'active' : ''} onClick={() => setPanel('routes')}>Rotas ({routes.length})</button>
          <button type="button" aria-pressed={panel === 'couriers'} className={panel === 'couriers' ? 'active' : ''} onClick={() => setPanel('couriers')}>Motoboys ({couriers.length})</button>
        </div>
        {panel === 'couriers' ? <div className="fleet-list">
          {couriers.map(c => <button key={c.id} type="button" className={'fleet-list-row' + (selectedCourier === c.id ? ' selected' : '')}
            onClick={() => {setSelectedCourier(selectedCourier === c.id ? '' : c.id); setSelectedRoute('');}}>
            <span><strong>{c.name}</strong><small>{c.jobCount ? c.phase + ' · ' + c.jobCount + ' pedido(s)' : c.phase}</small></span>
            <span className={'fleet-signal ' + c.signal}>{c.signal === 'online' ? 'GPS ativo' : c.signal === 'offline' ? 'Offline' : 'Sem sinal'}<small>{ago(c.position?.observed_at)}</small></span>
          </button>)}
          {!couriers.length && <p>Nenhum entregador cadastrado nesta loja.</p>}
        </div> : <div className="fleet-list">
          <button type="button" className="fleet-list-row" onClick={() => {setSelectedRoute('');setSelectedCourier('');}} aria-pressed={!selectedRoute}><strong>Todas as rotas</strong><span>{routes.length}</span></button>
          {visibleRoutes.map(route => {
            const courier = couriers.find(c => c.id === route.courierId);
            return <article key={route.id} className="fleet-route-card">
              <button type="button" className="fleet-route-title" aria-pressed={selectedRoute === route.id}
                onClick={() => {setSelectedRoute(selectedRoute === route.id ? '' : route.id); setSelectedCourier('');}}>
                <Route size={17}/><span><strong>{route.id.startsWith('avulsa:') ? 'Entrega avulsa' : 'Rota ' + route.id.slice(0, 8)}</strong>
                  <small>{courier?.name || 'Sem motoboy'} · {route.stops.length} parada(s)</small></span>
              </button>
              {route.stops.map(d => <div className="fleet-stop" key={d.id}>
                <span><strong>{d.customer_name || 'Entrega'}</strong><small>{d.address || 'Endereço não informado'} · {d.status}</small></span>
                {mapsStopUrl(d) ? <a href={mapsStopUrl(d)} target="_blank" rel="noopener noreferrer" aria-label={'Ir para entrega ' + (d.customer_name || '')}><Navigation size={17}/> Ir</a>
                  : <small title="É necessário cadastrar coordenadas da entrega">Sem GPS</small>}
              </div>)}
            </article>;
          })}
          {!routes.length && <p>Não há entregas próprias em andamento.</p>}
        </div>}
        {panel === 'routes' && selectedRoute && <button className="secondary" type="button" onClick={() => setSelectedRoute('')}>Mostrar todas as rotas</button>}
      </aside>
    </div>
    <p className="fleet-hint"><WifiOff size={15}/> Motoboys sem sinal permanecem identificados, mas a última posição não é tratada como localização atual. A distribuição de pedidos continua obedecendo às regras existentes.</p>
  </section>;
}
