import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const main = readFileSync(new URL('../entregador/android-app/app/src/main/java/br/com/pitacco/entregador/MainActivity.java',import.meta.url),'utf8');
const receiver = readFileSync(new URL('../entregador/android-app/app/src/main/java/br/com/pitacco/entregador/AssignmentMessagingService.java',import.meta.url),'utf8');
const panel = readFileSync(new URL('../entregador/painel.html',import.meta.url),'utf8');
const sender = readFileSync(new URL('../supabase/functions/courier-push/handler.mjs',import.meta.url),'utf8');

test('consent is persisted consistently for Activity and background Firebase service',()=>{
 assert.match(main,/getPreferences\(MODE_PRIVATE\)\.edit\(\)\.putBoolean\("push_enabled",\s*true\)/);
 assert.match(main,/getPreferences\(MODE_PRIVATE\)\.edit\(\)\.putBoolean\("push_enabled",\s*false\)/);
 assert.match(main,/getSharedPreferences\(MainActivity\.class\.getSimpleName\(\),\s*MODE_PRIVATE\)\.getBoolean\("push_enabled",\s*false\)/);
 assert.match(main,/private boolean pushEnabled\(\) \{\s*return isPushOptedIn\(this\)/);
});
test('background FCM receiver enforces consent BEFORE showing an assignment',()=>{
 const handler=receiver.slice(receiver.indexOf('@Override public void onMessageReceived(RemoteMessage'));
 assert.match(handler,/if \(!MainActivity\.isPushOptedIn\(this\)\) return;/);
 assert.ok(handler.indexOf('isPushOptedIn(this)')<handler.indexOf('showAssignment(this, eventId)'));
 assert.match(handler,/if \(eventId == null \|\| !eventId\.matches\(UUID_PATTERN\)\) return;/);
});
test('logout revokes server registration and disables native opt-in',()=>{
 const logout=panel.slice(panel.indexOf('async function logout(){'));
 assert.match(logout,/sb\.rpc\("pitacco_unregister_courier_push"\)/);
 assert.match(logout,/window\.PitaccoPush\.postMessage\("disable"\)/);
 assert.ok(logout.indexOf('pitacco_unregister_courier_push')<logout.indexOf('postMessage("disable")'));
});
test('production data-only FCM is received by native handler, not a background WebView',()=>{
 assert.match(sender,/event\.protocol==='data_only'/);
 assert.match(receiver,/extends FirebaseMessagingService/);
 assert.match(receiver,/void onMessageReceived\(RemoteMessage message\)/);
});
