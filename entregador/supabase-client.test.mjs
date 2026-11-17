import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeBrazilPhone,createDriverAuth,isMissingSessionError} from './supabase-client.mjs';
import {courierEmailAlias} from './identity.mjs';
import {readFileSync} from 'node:fs';
test('normalizes Brazilian phone',()=>{
 assert.equal(normalizeBrazilPhone('(21) 99999-1234'),'+5521999991234');
 assert.equal(normalizeBrazilPhone('+55 21 99999-1234'),'+5521999991234');
 assert.throws(()=>normalizeBrazilPhone('1234'));
});
test('uses internal email alias and password, never public signup or SMS',async()=>{
 let params;
 const db={auth:{
  signInWithPassword:async p=>(params=p,{data:{user:{id:'u1'}},error:null}),
  getUser:async()=>({data:{user:{id:'u1'}},error:null}),
  signOut:async()=>({error:null})
 },from:(table)=>({
  select:()=>({eq:()=>({eq:async()=>({data:[{id:'c1'}],error:null})}),in:()=>({in:async()=>({data:[{id:'d1'}],error:null})})})
 })};
 const client=createDriverAuth(db);
 await client.signIn('(21) 99999-1234','secret');
 assert.deepEqual(params,{email:await courierEmailAlias('+5521999991234'),password:'secret'});
 assert.deepEqual(await client.myCourierRecords(),[{id:'c1'}]);
 assert.deepEqual(await client.myDeliveries(['c1']),[{id:'d1'}]);
 assert.deepEqual(await client.myDeliveries([]),[]);
});
test('rejects invalid credentials without exposing provider details',async()=>{
 const client=createDriverAuth({auth:{signInWithPassword:async()=>({error:new Error('provider details')})}});
 await assert.rejects(()=>client.signIn('21999991234','bad'),/Celular ou senha inválidos/);
});


test('alias stays stable across phone formats and does not expose number',async()=>{
 const a=await courierEmailAlias('(21) 99999-1234');
 const b=await courierEmailAlias('+55 21 99999-1234');
 assert.equal(a,b);
 assert.match(a,/^c[a-f0-9]{64}@login\.pitacco\.com\.br$/);
 assert.ok(!a.includes('99999'));
});
test('server and browser produce the same technical login alias',()=>{
 const a=readFileSync(new URL('./identity.mjs',import.meta.url),'utf8');
 const b=readFileSync(new URL('../supabase/functions/pitacco-courier-access/identity.mjs',import.meta.url),'utf8');
 assert.equal(a,b);
});
test('backend creates email-confirmed courier identity and converts reset users',()=>{
 const edge=readFileSync(new URL('../supabase/functions/pitacco-courier-access/index.ts',import.meta.url),'utf8');
 assert.match(edge,/email_confirm: true/);
 assert.match(edge,/password,email,email_confirm:true/);
 assert.match(edge,/email:user\.email,password:current/);
 assert.doesNotMatch(edge,/phone:user\.phone,password:current/);
});

test('missing session is a normal signed-out state on first visit',async()=>{
 let getUserCalls=0;
 const client=createDriverAuth({auth:{
  signInWithPassword:async()=>({data:{user:{id:'u1'}},error:null}),
  getSession:async()=>({data:{session:null},error:null}),
  getUser:async()=>{getUserCalls++;throw Error('Auth session missing!');}
 }});
 assert.equal(await client.currentUser(),null);
 assert.equal(getUserCalls,0);
});
test('revoked session after password change returns to login',async()=>{
 const client=createDriverAuth({auth:{
  signInWithPassword:async()=>({data:{user:{id:'u1'}},error:null}),
  getSession:async()=>({data:{session:{access_token:'revoked'}},error:null}),
  getUser:async()=>({data:{user:null},error:{name:'AuthSessionMissingError',message:'Auth session missing!'}}),
  signOut:async({scope})=>{assert.equal(scope,'local');return {error:{code:'session_not_found',message:'Session not found'}}}
 }});
 assert.equal(await client.currentUser(),null);
 await assert.doesNotReject(()=>client.signOut());
});
test('unknown session and other network errors are distinguished',async()=>{
 assert.ok(isMissingSessionError(new Error('Auth session missing!')));
 assert.ok(isMissingSessionError({code:'session_not_found'}));
 assert.equal(isMissingSessionError(new Error('Network error')),false);
 const client=createDriverAuth({auth:{
  signInWithPassword:async()=>({data:{user:{}},error:null}),
  signOut:async()=>({error:new Error('Network error')})
 }});
 await assert.rejects(()=>client.signOut(),/Network error/);
});
