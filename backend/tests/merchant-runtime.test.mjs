import test from 'node:test';
import assert from 'node:assert/strict';
import {createCoreSession} from '../clients/core-session.mjs';
import {createMerchantRuntime} from '../clients/merchant-runtime.mjs';
const A='20000000-0000-4000-8000-000000000001',B='20000000-0000-4000-8000-000000000002',U='10000000-0000-4000-8000-000000000001',D='30000000-0000-4000-8000-000000000001';
const shops=[{store_id:A,name:'A',role:'owner'},{store_id:B,name:'B',role:'operator'}];
const token='a'.repeat(64),next='b'.repeat(64);
const ok=data=>({ok:true,status:200,json:async()=>data});
test('shared session drives original map and native Windows print, survives rotation and stops on store change',async()=>{
 let current=token,clock=1000;const requests=[],native=[];
 const session=createCoreSession({now:()=>clock,fetcher:async(path,o)=>{
  if(path.endsWith('/auth/login'))return ok({access_token:token,token_type:'Bearer',expires_at:new Date(600000).toISOString()});
  assert.equal(new Headers(o.headers).get('Authorization'),'Bearer '+current);
  if(path.endsWith('/auth/renew')){current=next;return ok({access_token:next,token_type:'Bearer',expires_at:new Date(3600000).toISOString()});}
  if(path.endsWith('/auth/me'))return ok({id:U,email:'fixture@example.test',stores:shops});
  if(path.endsWith('/context'))return ok({data:shops.find(x=>path.includes(x.store_id))});
  const store=path.includes(A)?A:B;requests.push({path,token:current});
  if(path.endsWith('/map-point'))return ok({data:{id:store,name:'Fixture',latitude:-22.85,longitude:-43.45}});
  if(path.endsWith('/print-device/status'))return ok({data:{status:'connected',bound_device_id:D,printer_computer_bound:true,bound_computer_connected:true}});
  if(path.endsWith('/unified-print/claim'))return ok({data:{jobs:[]}});
  throw Error('Unexpected route '+path);
 }});
 await session.login('fixture@example.test','pw');await session.selectStore(A);
 const web=createMerchantRuntime({session});
 const win=createMerchantRuntime({session,windows:{deviceId:D,nativeCall:async(op)=>{native.push(op);return [];}}});
 assert.equal(web.device,null);
 assert.deepEqual(await web.map.readPoint(),await win.map.readPoint());
 await session.renew();await win.device.sync();
 assert.ok(requests.some(x=>x.path.endsWith('/unified-print/claim')&&x.token===next));
 assert.deepEqual(native,['list_jobs']);
 await session.selectStore(B);
 await assert.rejects(web.map.readPoint(),/encerrada/);
 await assert.rejects(win.device.sync(),/encerrada/);
 const newWeb=createMerchantRuntime({session});assert.equal((await newWeb.map.readPoint()).id,B);
 newWeb.stop();
});
