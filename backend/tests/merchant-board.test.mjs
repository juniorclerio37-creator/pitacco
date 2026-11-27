import test from 'node:test';
import assert from 'node:assert/strict';
import {createMerchantBoard} from '../clients/merchant-board.mjs';
import {orderStage} from '../../core-source/web/orderBoard.mjs';
const store='20000000-0000-4000-8000-000000000001',other='20000000-0000-4000-8000-000000000002';
const id=n=>'40000000-0000-4000-8000-'+String(n).padStart(12,'0');
const order=(n,source)=>({id:id(n),store_id:store,source,status:'accepted',preparation_status:'ready',created_at:'2026-11-27T12:00:00Z',receipt:{logistics:'loja'}});
function setup(foreign=false){
 const requests=[];const board=createMerchantBoard({store,scopedFetch:async path=>{
  requests.push(path);const route=path.split('/'+store+'/')[1].split('?')[0];
  const rows={'orders/own-board':[order(1,'proprio')],'orders/ifood-board':[{...order(2,'ifood'),store_id:foreign?other:store}],
   'own-logistics/deliveries':[{id:id(3),order_id:id(1),store_id:store,source:'proprio',status:'retirada',logistics_provider:'loja'}],
   'own-logistics/ifood-deliveries':[],'own-logistics/couriers':[]};
  return {ok:true,status:200,json:async()=>route==='operation-settings'?{data:{store_id:store,dispatch_mode:'manual',acceptance_settings:[],print_sectors:[]}}:{data:rows[route],limit:100,offset:0}};
 }});return {board,requests};
}
test('original order stage receives both sources and matching local delivery',async()=>{
 const {board,requests}=setup();const a=board.read(),b=board.read();assert.equal(a,b);
 const result=await a;assert.equal(result.orders.length,2);
 assert.equal(orderStage(result.orders.find(o=>o.source==='proprio'),result.deliveries[0]),'delivery');
 assert.equal(orderStage(result.orders.find(o=>o.source==='ifood')),'ready');assert.equal(requests.length,6);
 board.stop();await assert.rejects(board.read(),/encerrada/);
});
test('foreign rows fail closed',async()=>{await assert.rejects(setup(true).board.read(),/escopo/);});
