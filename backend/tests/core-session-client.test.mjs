import test from 'node:test';
import assert from 'node:assert/strict';
import {createCoreSession} from '../clients/core-session.mjs';
const A='20000000-0000-4000-8000-000000000001',B='20000000-0000-4000-8000-000000000002',U='10000000-0000-4000-8000-000000000001',token='a'.repeat(64);
const shops=[{store_id:A,name:'A',role:'owner'},{store_id:B,name:'B',role:'operator'}];
const ok=data=>({ok:true,status:200,json:async()=>data});
function fixture(){
 let clock=1000,stores=shops,revoked=false;const calls=[];
 const session=createCoreSession({now:()=>clock,fetcher:async(path,o)=>{
  calls.push(path);
  if(path.endsWith('/auth/login')){assert.equal(o.credentials,'omit');assert.equal(o.headers.Authorization,undefined);return ok({access_token:token,token_type:'Bearer',expires_at:new Date(60000).toISOString()});}
  if(path.endsWith('/auth/logout')){assert.equal(o.headers.Authorization,'Bearer '+token);revoked=true;return ok({status:'revoked'});}
  assert.equal(new Headers(o.headers).get('Authorization'),'Bearer '+token);
  if(revoked)return {ok:false,status:401};
  if(path.endsWith('/auth/me'))return ok({id:U,email:'fixture@example.test',stores});
  if(path.endsWith('/context'))return ok({data:shops.find(s=>path.includes(s.store_id))});
  return ok({data:[]});
 }});return {session,calls,expire:()=>{clock=61000},revokeMembership:()=>{stores=[shops[1]]}};
}
test('same session for web/windows, scoped store switching stops old service',async()=>{
 const {session,calls}=fixture();
 await session.login('fixture@example.test','fixture-password');
 assert.equal(JSON.stringify(session.snapshot()).includes(token),false);
 await session.selectStore(A);let stopped=0;session.attach({stop(){stopped++}});
 const web=session.scopedFetch();await web('/api/v1/stores/'+A+'/map-point');
 await assert.rejects(web('/api/v1/stores/'+B+'/map-point'),/Destino/);
 await assert.rejects(web('/api/v1/stores/'+A+'/../'+B+'/map-point'),/Destino/);
 await session.selectStore(B);assert.equal(stopped,1);
 await assert.rejects(web('/api/v1/stores/'+A+'/map-point'),/encerrada/);
 await session.scopedFetch()('/api/v1/stores/'+B+'/map-point');
 assert.equal((await session.logout()).revoked,true);
 assert.equal(session.snapshot().identity,null);
 assert.equal(calls.filter(p=>p.endsWith('/auth/login')).length,1);
});
test('refresh removes revoked store; expiration clears resources',async()=>{
 const {session,revokeMembership,expire}=fixture();await session.login('fixture@example.test','pw');
 await session.selectStore(A);let stopped=0;session.attach({stop(){stopped++}});
 revokeMembership();await session.refresh();assert.equal(stopped,1);assert.equal(session.snapshot().selected,null);
 await assert.rejects(session.selectStore(A),/não autorizada/);
 await session.selectStore(B);session.attach({stop(){stopped++}});expire();
 assert.equal(session.snapshot().identity,null);assert.equal(stopped,2);
});
test('late store response after logout cannot restore selection',async()=>{
 let resolve;const session=createCoreSession({fetcher:async path=>{
  if(path.endsWith('/auth/login'))return ok({access_token:token,token_type:'Bearer',expires_at:new Date(Date.now()+60000).toISOString()});
  if(path.endsWith('/auth/me'))return ok({id:U,email:'fixture@example.test',stores:shops});
  if(path.endsWith('/auth/logout'))return ok({status:'revoked'});
  return new Promise(r=>{resolve=r});
 }});
 await session.login('fixture@example.test','pw');
 const selection=session.selectStore(A);await session.logout();resolve(ok({data:shops[0]}));
 await assert.rejects(selection,/encerrada/);assert.equal(session.snapshot().selected,null);
});
