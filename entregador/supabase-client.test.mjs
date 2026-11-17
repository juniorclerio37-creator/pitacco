import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeBrazilPhone,createDriverAuth} from './supabase-client.mjs';
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
  select:()=>({eq:()=>({eq:async()=>({data:[{id:'c1'}],error:null})}),in:async()=>({data:[{id:'d1'}],error:null})})
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
