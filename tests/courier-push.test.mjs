import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {firebaseMessage, completionStatus, createCourierPush} from '../supabase/functions/courier-push/handler.mjs';

test('FCM notification+data supports installed Android WebView and new native receiver in background',()=>{
 const eventId='550e8400-e29b-41d4-a716-446655440000';
 const output=firebaseMessage({token:'device',event_id:eventId,address:'Rua Particular',phone:'000000000'});
 assert.equal(output.message.android.priority,'HIGH');
 assert.equal(output.message.data.kind,'new_assignment');
 assert.equal(output.message.data.event_id,eventId);
 assert.equal(output.message.android.ttl,'90s');
 assert.deepEqual(output.message.notification,{title:'Pitacco Entregador',body:'Você tem uma nova entrega! Abra o aplicativo para conferir.'});
 assert.equal(output.message.android.notification.tag,eventId);
 // Important: no hardcoded channel. Old APK uses v1; new APK uses v2.
 assert.equal(output.message.android.notification.channel_id,undefined);
 assert.doesNotMatch(JSON.stringify(output),/Rua Particular|000000000/);
});
test('Invalid devices are retired, while service and network errors can be retried',()=>{
 assert.equal(completionStatus(404,[{errorCode:'UNREGISTERED'}]),'invalid');
 assert.equal(completionStatus(400,[{errorCode:'INVALID_ARGUMENT'}]),'rejected');
 assert.equal(completionStatus(503,undefined),'retry');
 assert.equal(completionStatus(200,undefined),'sent');
});
test('Missing Firebase configuration cannot consume pending assignments',async()=>{
 let called=false;
 const handler=createCourierPush({url:'https://fixture.example',serviceKey:'test',cronSecret:'secret',fetcher:async()=>{called=true;}});
 const req=secret=>new Request('https://fixture.example',{method:'POST',headers:{authorization:'Bearer '+secret}});
 assert.equal((await handler(req('bad'))).status,401);
 assert.equal((await handler(req('secret'))).status,503);
 assert.equal(called,false);
});

test('FCM native courier uses data-only background delivery for on-device alarm and voice',()=>{
 const eventId='550e8400-e29b-41d4-a716-446655440000';
 const output=firebaseMessage({token:'device',event_id:eventId,protocol:'data_only',
   address:'Rua Particular',phone:'000000000'});
 assert.equal(output.message.android.priority,'HIGH');
 assert.equal(output.message.data.kind,'new_assignment');
 assert.equal(output.message.data.event_id,eventId);
 assert.equal(output.message.notification,undefined);
 assert.equal(output.message.android.notification,undefined);
 assert.doesNotMatch(JSON.stringify(output),/Rua Particular|000000000/);
});
test('Unknown and old Android APKs retain background tray notifications',()=>{
 const output=firebaseMessage({token:'device',event_id:'550e8400-e29b-41d4-a716-446655440000',protocol:'notification'});
 assert.equal(output.message.notification.title,'Pitacco Entregador');
 assert.equal(output.message.android.priority,'HIGH');
});

test('Supabase Vault cron bearer works without copying a secret to Edge environment',async()=>{
 let seen;
 const handler=createCourierPush({
  url:'https://fixture.example',
  serviceKey:'server-fixture',
  cronSecret:undefined,
  verifyCron:async token=>{seen=token;return token==='valid-vault-token'},
  fetcher:async()=>{throw Error('Should never reach Google without configured service account')}
 });
 const request=token=>new Request('https://fixture.example',{
  method:'POST',headers:{authorization:'Bearer '+token}
 });
 assert.equal((await handler(request('invalid'))).status,401);
 assert.equal(seen,'invalid');
 assert.equal((await handler(request('valid-vault-token'))).status,503);
 assert.equal(seen,'valid-vault-token');
 const thrown=createCourierPush({
  url:'https://fixture.example',serviceKey:'server-fixture',
  verifyCron:async()=>{throw Error('Database temporarily unavailable')}
 });
 assert.equal((await thrown(request('bad'))).status,401);
});

test('the Vault cron authorization migration never publishes the secret to clients',()=>{
 const migration=readFileSync(new URL('../supabase/migrations/20261119003200_vault_cron_secret_for_courier_push.sql',import.meta.url),'utf8');
 const edge=readFileSync(new URL('../supabase/functions/courier-push/index.ts',import.meta.url),'utf8');
 assert.match(migration,/vault\.create_secret\(/);
 assert.match(migration,/extensions\.gen_random_bytes\(32\)/);
 assert.match(migration,/revoke all on function public\.pitacco_verify_courier_push_cron\(text\)/);
 assert.match(migration,/grant execute on function public\.pitacco_verify_courier_push_cron\(text\)\s+to service_role/);
 assert.match(edge,/pitacco_verify_courier_push_cron/);
 assert.doesNotMatch(edge,/console\.(log|warn|error)\(.*token/);
});


test('Firebase OAuth preflight is bearer-protected and never claims or sends assignments',async()=>{
 const keyPair=await crypto.subtle.generateKey({name:'RSASSA-PKCS1-v1_5',modulusLength:2048,
  publicExponent:new Uint8Array([1,0,1]),hash:'SHA-256'},true,['sign','verify']);
 const pemBuffer=Buffer.from(await crypto.subtle.exportKey('pkcs8',keyPair.privateKey));
 const private_key='-----BEGIN PRIVATE KEY-----\\n'+pemBuffer.toString('base64').match(/.{1,64}/g).join('\\n')+'\\n-----END PRIVATE KEY-----\\n';
 const calls=[];
 const sender=createCourierPush({
  url:'https://fixture.example',serviceKey:'server-fixture',
  verifyCron:async s=>s==='valid-vault-token',
  account:{client_email:'test@example.invalid',project_id:'pitacco-test',private_key},
  fetcher:async url=>{
   calls.push(String(url));
   if(String(url).includes('oauth2.googleapis.com'))return Response.json({access_token:'fixture-short-lived-oauth',expires_in:3600});
   throw Error('Preflight must not claim or send any real assignment');
  }
 });
 const request=token=>new Request('https://fixture.example',{method:'POST',
  headers:{authorization:'Bearer '+token,'content-type':'application/json'},
  body:JSON.stringify({action:'preflight'})});
 assert.equal((await sender(request('wrong-token'))).status,401);
 const result=await sender(request('valid-vault-token'));
 assert.equal(result.status,200);
 assert.deepEqual(await result.json(),{ready:true,oauth:'authorized',dispatched:false});
 assert.deepEqual(calls,['https://oauth2.googleapis.com/token']);
});
