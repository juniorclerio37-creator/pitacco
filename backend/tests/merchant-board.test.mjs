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

test('own actions are scoped, server confirmed, no marketplace mutation or automatic retry',async()=>{
 const calls=[];let state='pending',fail=false;
 const board=createMerchantBoard({store,scopedFetch:async(path,opts)=>{
  const route=path.split('/'+store+'/')[1].split('?')[0];
  if(opts.method==='POST'){
   calls.push({route,body:JSON.parse(opts.body)});
   if(fail)return {ok:false,status:503};
   state='accepted';return {ok:true,status:200,json:async()=>({data:{id:id(1),store_id:store,status:state,preparation_status:'preparing'}})};
  }
  const rows={'orders/own-board':[{...order(1,'proprio'),status:state,preparation_status:'preparing'}],'orders/ifood-board':[order(2,'ifood')],'own-logistics/deliveries':[],'own-logistics/ifood-deliveries':[],'own-logistics/couriers':[]};
  return {ok:true,status:200,json:async()=>route==='operation-settings'?{data:{store_id:store,dispatch_mode:'manual',acceptance_settings:[],print_sectors:[]}}:{data:rows[route],limit:100,offset:0}};
 }});
 await board.read();await assert.rejects(board.act(id(2),'accept'),/não autorizado/);
 await assert.rejects(board.act(id(1),'cancel'),/não suportada/);
 await assert.rejects(board.act(id(1),'reject','x'),/motivo/);
 fail=true;await assert.rejects(board.act(id(1),'accept'),/não confirmado/);
 assert.equal(calls.length,1);
 await assert.rejects(board.act(id(1),'accept'),/não autorizado/);
 await board.read();fail=false;await board.act(id(1),'accept');
 assert.equal(calls.length,2);assert.deepEqual(calls[1].body,{action:'accept'});
 assert.equal((await board.read()).orders.find(o=>o.id===id(1)).status,'accepted');
});
