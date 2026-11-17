import test from 'node:test';
import assert from 'node:assert/strict';
import {createReleaseIntegrity,installerFormat} from '../supabase/functions/app-release-integrity/handler.mjs';

const id='5bf08781-3b56-4723-b1c8-458722276388';
const bytes=new Uint8Array(128);
const header=new DataView(bytes.buffer);
header.setUint16(0,0x5a4d,true);
header.setUint32(60,64,true);
header.setUint32(64,0x4550,true);
const digest=Buffer.from(await crypto.subtle.digest('SHA-256',bytes)).toString('hex');

test('Checks format signatures and rejects renamed or truncated payloads',()=>{
 assert.equal(installerFormat(bytes,'setup.exe'),true);
 assert.equal(installerFormat(bytes,'setup.msi'),false);
 assert.equal(installerFormat(bytes,'setup.apk'),false);
 assert.equal(installerFormat(bytes.slice(0,65),'setup.exe'),false);
});

test('Owner verification precedes private storage and service-only recording',async()=>{
 const calls=[];
 const handle=createReleaseIntegrity({url:'https://example.invalid',publicKey:'public',serviceKey:'private',fetcher:async(url,options)=>{
  calls.push([url.pathname,options.headers.authorization]);
  if(url.pathname.endsWith('/pitacco_is_platform_owner'))return Response.json(options.headers.authorization==='Bearer owner');
  if(url.pathname==='/auth/v1/user')return Response.json({id});
  if(url.pathname==='/rest/v1/pitacco_app_releases')return Response.json([{filename:'setup.exe',sha256:digest,size_bytes:128,state:'draft'}]);
  if(url.pathname.startsWith('/storage/'))return new Response(bytes);
  assert.equal(options.headers.authorization,'Bearer private');
  assert.deepEqual(JSON.parse(options.body),{p_id:id,p_actor:id,p_sha256:digest,p_size:128});
  return Response.json(true);
 }});
 const request=token=>new Request('https://example.invalid',{method:'POST',headers:{authorization:'Bearer '+token},body:JSON.stringify({id})});
 assert.equal((await handle(request('visitor'))).status,403);
 assert.equal(calls.length,1);
 assert.equal((await handle(request('owner'))).status,200);
 assert.equal(calls.length,6);
});

test('A mismatched digest or size never reaches the database record RPC',async()=>{
 for(const size of [128,127,129]){
  const handle=createReleaseIntegrity({url:'https://example.invalid',publicKey:'public',serviceKey:'private',fetcher:async url=>{
   if(url.pathname.endsWith('/pitacco_is_platform_owner'))return Response.json(true);
   if(url.pathname==='/auth/v1/user')return Response.json({id});
   if(url.pathname==='/rest/v1/pitacco_app_releases')return Response.json([{filename:'setup.exe',sha256:'0'.repeat(64),size_bytes:size,state:'draft'}]);
   if(url.pathname.startsWith('/storage/'))return new Response(bytes);
   assert.fail('Unexpected integrity write');
  }});
  const req=new Request('https://example.invalid',{method:'POST',headers:{authorization:'Bearer owner'},body:JSON.stringify({id})});
  assert.equal((await handle(req)).status,422);
 }
});
