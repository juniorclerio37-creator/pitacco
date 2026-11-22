import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {courierActionStage,courierProgress} from "./delivery-flow.mjs";
const page=()=>readFileSync(new URL("./painel.html",import.meta.url),"utf8");
test("every assigned origin follows collection, departure, arrival, code and finish",()=>{
 for(const source of ["proprio","ifood","99food","keeta"]){
  const base={source,logistics_provider:"loja"};
  assert.equal(courierActionStage({...base,status:"atribuida"}),"collect");
  assert.equal(courierActionStage({...base,status:"aceita",collected_at:null}),"collect");
  assert.equal(courierActionStage({...base,status:"aceita",collected_at:"2026-11-22T12:00:00Z"}),"depart");
  assert.equal(courierActionStage({...base,status:"retirada",collected_at:"x"}),"arrive");
  assert.equal(courierActionStage({...base,status:"retirada",arrived_at:"x"}),"code");
  assert.equal(courierActionStage({...base,status:"entregue"}),"terminal");
  assert.equal(courierActionStage({...base,status:"cancelada"}),"terminal");
 }
});
test("progress never marks unverified delivery as completed",()=>{
 const steps=courierProgress({status:"retirada",collected_at:"ok",arrived_at:"ok"});
 assert.deepEqual(steps.map(s=>s.label),["Coleta","Chegada","Código","Finalizar"]);
 assert.deepEqual(steps.map(s=>s.done),[true,true,false,false]);
 assert.deepEqual(steps.map(s=>s.active),[false,false,true,true]);
});
test("courier card only advances by user action and verified code",()=>{
 const html=page();
 assert.doesNotMatch(html,/courierProgress\(d\)/);
 assert.match(html,/courierActionStage\(d\)/);
 assert.match(html,/createAction\("Coletar"/);
 assert.match(html,/collectButton\.setAttribute\("aria-label","Coletar pedido"\)/);
 assert.match(html,/createAction\("Sair para entrega"/);
 assert.match(html,/closeToCustomer\?"Confirmar chegada":"Cheguei na entrega"/);
 assert.match(html,/createAction\("Finalizar entrega"/);
 assert.match(html,/pitacco_driver_collect/);
 assert.match(html,/pitacco_driver_depart/);
 assert.match(html,/pitacco_driver_arrive/);
 assert.match(html,/pitacco_driver_verify_own_code/);
 assert.match(html,/ifoodDriverAction\(d.id,"verify",digits\)/);
 assert.match(html,/validação oficial desta plataforma ainda depende de homologação/);
});

test("single order departs by authorized standalone RPC; batches use existing RPC",()=>{
 const html=page();
 assert.match(html,/pitacco_driver_depart_single/);
 assert.match(html,/pitacco_driver_depart/);
 assert.match(html,/d\.batch_id/);
 assert.doesNotMatch(html,/sem rota vinculada/);
 assert.match(html,/arrivalProximity\(current,mapLastGps,arrivalSignals\)/);
 assert.doesNotMatch(html,/card-delivery-steps/);
 const sql=readFileSync(new URL("../supabase/migrations/20261122143000_pitacco_driver_depart_single.sql",import.meta.url),"utf8");
 assert.match(sql,/public\.pitacco_courier_session_ready\(\)/);
 assert.match(sql,/d\.collected_at is null/);
 assert.match(sql,/d\.batch_id is not null/);
 assert.match(sql,/d\.status='retirada'/);
 assert.match(sql,/c\.user_id=\(select auth\.uid\(\)\)/);
 assert.match(sql,/revoke all on function public\.pitacco_driver_depart_single\(uuid\) from public,anon/);
});
