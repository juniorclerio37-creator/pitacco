import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeBrazilPhone,createDriverAuth} from './supabase-client.mjs';
test('normalizes Brazilian phone',()=>{
 assert.equal(normalizeBrazilPhone('(21) 99999-1234'),'+5521999991234');
 assert.equal(normalizeBrazilPhone('+55 21 99999-1234'),'+5521999991234');
 assert.throws(()=>normalizeBrazilPhone('1234'));
});
test('uses phone and password, never public signup',async()=>{
 let params;
 const db={auth:{
  signInWithPassword:async p=>(params=p,{data:{user:{id:'u1'}},error:null}),
  getUser:async()=>({data:{user:{id:'u1'}},error:null}),
  signOut:async()=>({error:null})
 },from:(table)=>({
  select:()=>({eq:()=>({eq:async()=>({data:[{id:'c1'}],error:null})}),in:async()=>({data:[{id:'d1'}],error:null})})
 })};
 const client=createDriverAuth(db);
 await client.signIn('(21) 99999-1234','secret');
 assert.deepEqual(params,{phone:'+5521999991234',password:'secret'});
 assert.deepEqual(await client.myCourierRecords(),[{id:'c1'}]);
 assert.deepEqual(await client.myDeliveries(['c1']),[{id:'d1'}]);
 assert.deepEqual(await client.myDeliveries([]),[]);
});
test('rejects invalid credentials without exposing provider details',async()=>{
 const client=createDriverAuth({auth:{signInWithPassword:async()=>({error:new Error('provider details')})}});
 await assert.rejects(()=>client.signIn('21999991234','bad'),/Telefone ou senha inválidos/);
});
