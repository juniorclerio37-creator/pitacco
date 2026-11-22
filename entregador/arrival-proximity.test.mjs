import test from "node:test";
import assert from "node:assert/strict";
import {distanceMeters,arrivalProximity} from "./arrival-proximity.mjs";
const ref={id:"order-1",status:"retirada",logistics_provider:"loja",address:"Rua das Flores, 10",latitude:-22.76000,longitude:-43.45000};
const gps=(lat,lon,time,accuracy=15)=>({latitude:lat,longitude:lon,accuracy_m:accuracy,observed_at:new Date(time).toISOString()});
test("arrival hints need two independent, recent, precise GPS fixes",()=>{
 const now=Date.parse("2026-11-22T14:00:40Z"),seen=new Map();
 const first=gps(-22.76011,-43.45006,now-22000);
 assert.equal(arrivalProximity([ref],first,seen,now),null);
 assert.equal(arrivalProximity([ref],first,seen,now),null,"repeated sample cannot satisfy confirmation");
 const second=gps(-22.76010,-43.45003,now-10000);
 const result=arrivalProximity([ref],second,seen,now);
 assert.equal(result.deliveryId,ref.id);
 assert.ok(result.distanceMeters<75);
 assert.equal(seen.get(ref.id).count,2);
});
test("missing coordinates, remote/old GPS and poor accuracy never trigger arrival",()=>{
 const now=Date.parse("2026-11-22T14:00:40Z");
 for(const d of [{...ref,latitude:null},{...ref,status:"atribuida"},{...ref,arrived_at:"done"},{...ref,logistics_provider:"marketplace"},{...ref,address:""}]){
  assert.equal(arrivalProximity([d],gps(-22.76,-43.45,now-10000),new Map(),now),null);
 }
 for(const p of [gps(-22.8,-43.45,now-10000),gps(-22.76,-43.45,now-200000),gps(-22.76,-43.45,now-10000,70)]){
  assert.equal(arrivalProximity([ref],p,new Map(),now),null);
 }
});
test("geofence prompt disappears after moving away, and does not register arrival on server",()=>{
 const now=Date.parse("2026-11-22T14:00:40Z"),seen=new Map();
 arrivalProximity([ref],gps(-22.76,-43.45,now-23000),seen,now);
 assert.ok(arrivalProximity([ref],gps(-22.76,-43.45,now-10000),seen,now));
 assert.equal(arrivalProximity([ref],gps(-22.767,-43.45,now-1000),seen,now),null);
 assert.equal(seen.size,0);
 assert.ok(distanceMeters({latitude:-22.76,longitude:-43.45},{latitude:-22.767,longitude:-43.45})>75);
});
