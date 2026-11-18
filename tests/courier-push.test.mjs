import test from 'node:test';
import assert from 'node:assert/strict';
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
