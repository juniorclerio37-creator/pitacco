import test from 'node:test';
import assert from 'node:assert/strict';
import {suggestedBatchRoutes} from './route-sequence.mjs';

const store='a',batch='batch-1';
const entry=(id,latitude,longitude,status='retirada',batch_id=batch,store_id=store)=>({
  id,latitude,longitude,status,batch_id,store_id,logistics_provider:'loja'
});
test('ordenar lote por proximidade da loja preserva pedidos distintos',()=>{
 const origins=new Map([[store,{latitude:-22.75,longitude:-43.45}]]);
 const plans=suggestedBatchRoutes([
   entry('longe',-22.90,-43.45),entry('perto',-22.752,-43.45),entry('meio',-22.80,-43.45)
 ],origins);
 assert.equal(plans.length,1);
 assert.equal(plans[0].estimated,true);
 assert.deepEqual(plans[0].stops.map(x=>x.delivery.id),['perto','meio','longe']);
 assert.ok(plans[0].stops[0].distance<plans[0].stops[2].distance);
});
test('não agrupar entregas de lojas/lotes distintos',()=>{
 const input=[entry('a',-22.76,-43.45),entry('b',-22.77,-43.45),
   entry('c',-22.70,-43.45,'retirada','batch-2'),
   entry('d',-22.70,-43.45,'retirada','batch-2','store-2')];
 const plans=suggestedBatchRoutes(input,new Map());
 assert.equal(plans.length,1);assert.equal(plans[0].stops.length,2);
});
test('sem coordenadas válidas, manter ordem e não anunciar otimização viária',()=>{
 const origins=new Map([[store,{latitude:-22.75,longitude:-43.45}]]);
 const plans=suggestedBatchRoutes([entry('primeiro',null,null),entry('segundo',-22.76,-43.45)],origins);
 assert.equal(plans[0].estimated,false);
 assert.deepEqual(plans[0].stops.map(x=>x.delivery.id),['primeiro','segundo']);
});
test('entregas concluídas ou sem lote não aparecem na lista',()=>{
 assert.deepEqual(suggestedBatchRoutes([
   entry('a',-22.75,-43.45,'entregue'),entry('b',-22.76,-43.45,'retirada',null)
 ],new Map()),[]);
});

test('vizinho mais próximo evita voltar à loja entre as entregas',()=>{
 const origins=new Map([[store,{latitude:-22.75,longitude:-43.45}]]);
 const plans=suggestedBatchRoutes([
   entry('perto-norte',-22.749,-43.45),
   entry('sul',-22.7512,-43.45),
   entry('norte-leste',-22.749,-43.449)
 ],origins);
 assert.deepEqual(plans[0].stops.map(x=>x.delivery.id),
   ['perto-norte','norte-leste','sul']);
 assert.equal(plans[0].anchor,'store');
});
test('partida muda para o último ponto confirmado do próprio lote',()=>{
 const origins=new Map([[store,{latitude:-22.75,longitude:-43.45}]]);
 const lastStops=new Map([[store+':'+batch,{latitude:-22.751,longitude:-43.45}]]);
 const plans=suggestedBatchRoutes([
   entry('norte',-22.748,-43.45),entry('sul',-22.7508,-43.45)
 ],origins,lastStops);
 assert.equal(plans[0].anchor,'last-stop');
 assert.equal(plans[0].stops[0].delivery.id,'sul');
});
test('chegada registrada deve permanecer primeira até confirmação do código',()=>{
 const origins=new Map([[store,{latitude:-22.75,longitude:-43.45}]]);
 const arrived={...entry('cheguei',-22.78,-43.45),arrived_at:'2026-11-18T12:00:00Z'};
 const plans=suggestedBatchRoutes([
   entry('outro',-22.751,-43.45),arrived
 ],origins);
 assert.equal(plans[0].anchor,'arrival');
 assert.equal(plans[0].stops[0].delivery.id,'cheguei');
 assert.equal(plans[0].stops[1].delivery.id,'outro');
});
test('sem dados viáveis não estima caminho nem mistura lotes de lojas diferentes',()=>{
 const lastStops=new Map([[store+':'+batch,{latitude:0,longitude:0}]]);
 const plans=suggestedBatchRoutes([
   entry('a',null,-43.45),entry('b',-22.78,-43.45)
 ],new Map(),lastStops);
 assert.equal(plans[0].estimated,false);
 assert.equal(plans[0].anchor,'unsorted');
 assert.deepEqual(plans[0].stops.map(x=>x.delivery.id),['a','b']);
});
