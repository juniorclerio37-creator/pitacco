import test from 'node:test';
import assert from 'node:assert/strict';
import {firebaseMessage, completionStatus, createCourierPush} from '../supabase/functions/courier-push/handler.mjs';

test('FCM notification uses the Android channel and carries no delivery information',()=>{
 const output=firebaseMessage({token:'device',event_id:'event-id',address:'Rua Particular',phone:'000000000'});
 assert.equal(output.message.android.notification.channel_id,'pitacco_new_assignment_v1');
 assert.equal(output.message.android.priority,'HIGH');
 assert.equal(output.message.notification.title,'Pitacco Entregador');
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
