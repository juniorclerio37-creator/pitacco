import test from 'node:test';
import assert from 'node:assert/strict';
import {buildNavigationUrl,routeTarget,routeDestination} from './navigation.mjs';

const first={id:'pedido-A',address:'Rua das Acácias, 123, Nova Iguaçu, RJ, Brasil',
  latitude:-22.75,longitude:-43.45};
const second={id:'pedido-B',address:'Avenida Central, 900, Rio de Janeiro, RJ, Brasil',
  latitude:-22.91,longitude:-43.17};

test('Google Maps gets the exact destination of the tapped delivery',()=>{
 const a=new URL(buildNavigationUrl(first,'google','address'));
 const b=new URL(buildNavigationUrl(second,'google','address'));
 assert.equal(a.searchParams.get('destination'),first.address);
 assert.equal(b.searchParams.get('destination'),second.address);
 assert.notEqual(a.href,b.href);
 assert.equal(a.searchParams.get('dir_action'),'navigate');
});
test('Waze gets the selected delivery address via universal link',()=>{
 const a=new URL(buildNavigationUrl(first,'waze','address'));
 const b=new URL(buildNavigationUrl(second,'waze','address'));
 assert.equal(a.hostname,'waze.com');
 assert.equal(a.searchParams.get('q'),first.address);
 assert.equal(b.searchParams.get('q'),second.address);
 assert.equal(a.searchParams.get('navigate'),'yes');
});
test('Waze navigation uses verified coordinates when selected',()=>{
 const a=new URL(buildNavigationUrl(first,'waze','coords'));
 assert.equal(a.searchParams.get('ll'),'-22.75,-43.45');
 assert.equal(a.searchParams.get('q'),null);
 assert.equal(routeDestination(first,'coords'),'-22.75,-43.45');
});
test('route falls back to real order address, never 0,0 or empty coordinates',()=>{
 const d={id:'pedido-C',address:'Rua Nova, 25, Nova Iguaçu, RJ',latitude:0,longitude:0};
 assert.equal(routeTarget(d,'coords').value,d.address);
 assert.equal(new URL(buildNavigationUrl(d,'waze','coords')).searchParams.get('q'),d.address);
 assert.equal(buildNavigationUrl({id:'empty',address:''},'google'),null);
 assert.equal(buildNavigationUrl(first,'unsupported'),null);
});
test('malformed coordinate values fall back to the exact address',()=>{
 for(const latitude of [' ',true,Infinity,91]){
  const delivery={...first,latitude};
  assert.equal(routeTarget(delivery,'coords').value,first.address);
 }
});
test('a delivery with coordinates only can open the selected navigation provider',()=>{
 const delivery={id:'coords-only',latitude:second.latitude,longitude:second.longitude};
 const google=new URL(buildNavigationUrl(delivery,'google','address'));
 const waze=new URL(buildNavigationUrl(delivery,'waze','address'));
 assert.equal(google.searchParams.get('destination'),'-22.91,-43.17');
 assert.equal(waze.searchParams.get('ll'),'-22.91,-43.17');
});
