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
