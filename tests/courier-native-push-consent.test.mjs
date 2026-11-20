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


const manifest=readFileSync(new URL('../entregador/android-app/app/src/main/AndroidManifest.xml',import.meta.url),'utf8');
const gpsService=readFileSync(new URL('../entregador/android-app/app/src/main/java/br/com/pitacco/entregador/CourierLocationService.java',import.meta.url),'utf8');
const gradle=readFileSync(new URL('../entregador/android-app/app/build.gradle',import.meta.url),'utf8');

test('Pitacco Android declares separate opt-in background GPS and preserves one existing app ID',()=>{
 assert.match(manifest,/android\.permission\.ACCESS_BACKGROUND_LOCATION/);
 assert.match(manifest,/android\.permission\.FOREGROUND_SERVICE_LOCATION/);
 assert.match(manifest,/android:foregroundServiceType="location"/);
 assert.match(manifest,/android:stopWithTask="false"/);
 assert.match(gradle,/applicationId 'br\.com\.pitacco\.entregador'/);
 assert.match(gradle,/versionCode 32/);
 assert.match(gradle,/versionName '2\.0\.12'/);
});
test('Android 11+ requests all-the-time permission separately with driver disclosure',()=>{
 assert.match(main,/private void showBackgroundLocationDisclosure\(JavaScriptReplyProxy reply\)/);
 assert.match(main,/Build\.VERSION\.SDK_INT >= 30/);
 assert.match(main,/Settings\.ACTION_APPLICATION_DETAILS_SETTINGS/);
 assert.match(main,/Manifest\.permission\.ACCESS_BACKGROUND_LOCATION/);
 assert.match(main,/backgroundPermissionState\(\)/);
 assert.match(main,/background_status/);
 assert.match(main,/background_request/);
 assert.match(main,/"granted"\.equals\(locationPermissionState\(\)\)/);
 assert.match(main,/A permissão é opcional e não ativa o plantão automaticamente/);
 assert.match(panel,/id="requestBackgroundGps" hidden/);
 assert.match(panel,/Permitir localização o tempo todo no Android/);
 assert.match(panel,/postMessage\("background_request"\)/);
 assert.match(panel,/postMessage\("background_status"\)/);
});
test('Native GPS status relies on recent successful upload, not only service running',()=>{
 assert.match(gpsService,/static String trackingState\(\)/);
 assert.match(gpsService,/lastConfirmedUploadElapsedMs/);
 assert.match(gpsService,/result\.status >= 200 && result\.status < 300/);
 assert.match(gpsService,/return "stale"/);
 assert.match(gpsService,/return START_NOT_STICKY/);
 assert.match(main,/CourierLocationService\.trackingState\(\)/);
 assert.match(panel,/Serviço Android ativo\. Aguardando confirmação/);
 assert.match(panel,/servidor não confirma localização recente/);
 assert.match(panel,/id="verifyGpsUpload" hidden/);
});
test('Location service stays user-stoppable and shift-scoped',()=>{
 assert.match(gpsService,/setOngoing\(true\)/);
 assert.match(gpsService,/"Parar rastreamento"/);
 assert.match(gpsService,/private void submitPosition/);
 assert.match(panel,/pitacco_courier_background_gps_start/);
 assert.match(panel,/pitacco_courier_background_gps_revoke/);
 assert.match(panel,/if\(!nextOnline\)\{await stopNativeGpsTracking\(\)/);
});
