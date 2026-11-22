import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {isMerchantIfoodDelivery,ifoodDispatchTargets,ifoodDispatchOutcome,
 recordDepartureAndDispatch} from "./ifood-departure.mjs";

const own=(id,batch="batch",extra={})=>({
 id,batch_id:batch,courier_id:"courier",store_id:"store",
 source:"ifood",logistics_provider:"loja",status:"aceita",
 collected_at:"2026-11-22T17:00:00-03:00",...extra
});
test("coleta local não despacha ao iFood; saída está no botão próprio",()=>{
 const page=readFileSync(new URL("./painel.html",import.meta.url),"utf8");
 const collect=page.slice(page.indexOf("async function collectCourierOrder(d){"),
   page.indexOf("async function sendIfoodDispatch(d){"));
 assert.match(collect,/pitacco_driver_collect/);
 assert.doesNotMatch(collect,/ifoodDriverAction/);
 assert.doesNotMatch(collect,/sendIfoodDispatch/);
 assert.match(page,/createAction\("Sair para entrega","primary",\(\)=>departCourierRoute\(d\)\)/);
 assert.match(page,/recordDepartureAndDispatch\(/);
 assert.match(page,/sendIfoodArrival\(d\)/);
 assert.match(page,/ifoodDriverAction\(d\.id,"verify",digits\)/);
});
test("lote despacha somente pedidos iFood da própria frota, uma vez cada",()=>{
 const selected=own("a");
 const deliveries=[selected,own("b"),own("a"),
  own("partner","batch",{logistics_provider:"marketplace"}),
  own("own","batch",{source:"proprio"}),
  own("otherCourier","batch",{courier_id:"other"}),
  own("otherStore","batch",{store_id:"other"}),
  own("anotherRoute","other"),
  own("notCollected","batch",{collected_at:null}),
  own("cancelled","batch",{status:"cancelada"})
 ];
 assert.equal(isMerchantIfoodDelivery(deliveries[3]),false);
 assert.deepEqual(ifoodDispatchTargets(deliveries,selected).map(x=>x.id),["a","b"]);
 assert.deepEqual(ifoodDispatchTargets(deliveries,own("single",null)).map(x=>x.id),["single"]);
});
test("falha na saída impede qualquer envio ao provedor",async()=>{
 let sent=0;
 await assert.rejects(recordDepartureAndDispatch({
  selected:own("a"),deliveries:[own("a")],
  depart:async()=>{throw Error("Saída não confirmada");},
  dispatch:async()=>{sent++;return {provider_state:"submitted"};}
 }),/Saída não confirmada/);
 assert.equal(sent,0);
});
test("só depois da saída registrada há despacho; rede indisponível não apaga a saída",async()=>{
 const events=[];
 const result=await recordDepartureAndDispatch({
  selected:own("a"),deliveries:[own("a"),own("b")],
  depart:async()=>{events.push("pitacco_departed");},
  dispatch:async d=>{
   events.push("dispatch:"+d.id);
   if(d.id==="b")throw Error("iFood indisponível");
   return {provider_state:"submitted"};
  }
 });
 assert.deepEqual(events,["pitacco_departed","dispatch:a","dispatch:b"]);
 assert.equal(result.submitted,1);
 assert.equal(result.problems.length,1);
 assert.equal(result.confirmed,0);
 assert.equal(result.targets.length,2);
 assert.equal(ifoodDispatchOutcome({provider_state:"confirmed"}),"confirmed");
 assert.equal(ifoodDispatchOutcome({provider_state:"pending"}),"pending");
});
test("backend impede despacho antes da saída; sem entrega automática nem ação em parceiros",()=>{
 const sql=readFileSync(new URL("../supabase/migrations/20261122213000_ifood_dispatch_requires_departed.sql",import.meta.url),"utf8");
 const html=readFileSync(new URL("./painel.html",import.meta.url),"utf8");
 assert.match(sql,/d\.status<>'retirada'/);
 assert.match(sql,/d\.collected_at is null/);
 assert.match(sql,/src\.logistics_provider='loja' and src\.source='ifood'/);
 assert.match(sql,/ifood_dispatch_claimed_after_departure/);
 assert.doesNotMatch(sql,/d\.status not in \('aceita','retirada'\)/);
 assert.match(html,/if\(\(stage==="arrive"\|\|stage==="code"\)&&isMerchantIfoodDelivery\(d\)\)/);
 assert.match(html,/Sincronizar despacho com iFood/);
 assert.match(html,/pitacco_driver_depart_single/);
});
