import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {runInNewContext} from 'node:vm';

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
 assert.match(gradle,/versionCode 33/);
 assert.match(gradle,/versionName '2\.0\.13'/);
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
 assert.match(panel,/id="openAndroidPermissions"/);
 assert.match(panel,/localização o tempo todo/);
 assert.match(panel,/postMessage\("settings"\)/);
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
 assert.doesNotMatch(panel,/id="verifyGpsUpload"/);
});
test('Location service stays user-stoppable and shift-scoped',()=>{
 assert.match(gpsService,/setOngoing\(true\)/);
 assert.match(gpsService,/"Parar rastreamento"/);
 assert.match(gpsService,/private void submitPosition/);
 assert.match(panel,/pitacco_courier_background_gps_start/);
 assert.match(panel,/pitacco_courier_background_gps_revoke/);
 assert.match(panel,/else\{\s*stopGpsSharing\(\);\s*await stopNativeGpsTracking\(\)/);
});


test('physical activity permission remains opt-in and never controls whether GPS may run',()=>{
 const manifest=readFileSync(new URL('../entregador/android-app/app/src/main/AndroidManifest.xml',import.meta.url),'utf8');
 const service=readFileSync(new URL('../entregador/android-app/app/src/main/java/br/com/pitacco/entregador/CourierLocationService.java',import.meta.url),'utf8');
 const receiver=readFileSync(new URL('../entregador/android-app/app/src/main/java/br/com/pitacco/entregador/CourierMotionReceiver.java',import.meta.url),'utf8');
 assert.match(manifest,/android.permission.ACTIVITY_RECOGNITION/);
 assert.match(manifest,/CourierMotionReceiver" android:exported="false"/);
 assert.match(main,/motion_permission_request/);
 assert.match(main,/ACTIVITY_PERMISSION = 98/);
 assert.match(main,/showMotionPermissionDisclosure\(JavaScriptReplyProxy reply\)/);
 assert.match(main,/O tipo de movimento não é enviado à loja nem ao cliente/);
 assert.match(service,/!motionPermissionGranted\(\)/);
 assert.match(service,/return INTERVAL_MS/);
 assert.match(service,/STILL_INTERVAL_MS = 45_000L/);
 assert.match(service,/requestActivityTransitionUpdates\(/);
 assert.match(service,/removeActivityTransitionUpdates\(/);
 assert.match(receiver,/!CourierLocationService.isRunning\(\)/);
 assert.match(panel,/postMessage\("settings"\)/);
});


test('offline cleanup handles a real PostgrestBuilder-like thenable without .catch()', async()=>{
 const begin=panel.indexOf('async function stopNativeGpsTracking(){');
 const end=panel.indexOf('\nfunction stopGpsSharing(){',begin);
 assert.ok(begin>0&&end>begin);
 const code=panel.slice(begin,end);
 for(const networkError of [null,{message:'Sem rede'}]){
  const events=[],messages=[];
  const context={
   window:{PitaccoGps:{postMessage:msg=>events.push(msg)}},
   sb:{rpc:name=>{
     events.push(name);
     // Supabase PostgrestBuilder has a .then() method, but NO .catch().
     return {then(resolve){resolve({data:null,error:networkError})}};
   }},
   console:{warn:msg=>messages.push(msg)}
  };
  await runInNewContext('let nativeGpsRunning=true,gpsShiftEpoch=0,nativeGpsLastAttempt=10;\n'+code+'\nstopNativeGpsTracking()',context);
  assert.deepEqual(events,['stop','pitacco_courier_background_gps_revoke']);
  assert.equal(messages.length,networkError?1:0);
 }
});


test('all courier Supabase RPC fallbacks use real Promises, not .catch on builders',()=>{
 assert.match(panel,/Promise\.resolve\(sb\.rpc\("pitacco_courier_push_readiness"\)\)\.catch/);
 assert.match(panel,/Promise\.resolve\(sb\.rpc\(nativeProtocol\?/);
 assert.match(panel,/Promise\.resolve\(sb\.rpc\("pitacco_unregister_courier_push"\)\)\.catch/);
 assert.doesNotMatch(panel,/sb\.rpc\("pitacco_courier_push_readiness"\)\.catch/);
 assert.doesNotMatch(panel,/sb\.rpc\("pitacco_unregister_courier_push"\)\.catch/);
});


test('general permissions screen replaces separate GPS and activity controls',()=>{
 assert.match(panel,/id="openAndroidPermissions"/);
 assert.doesNotMatch(panel,/id="startNativeGps"/);
 assert.doesNotMatch(panel,/id="stopNativeGps"/);
 assert.doesNotMatch(panel,/id="requestBackgroundGps"/);
 assert.doesNotMatch(panel,/id="requestMotionPermission"/);
 assert.match(panel,/void reconcileShiftGps\(\)/);
 assert.match(panel,/void reconcileShiftGps\(\{force:true\}\)/);
 assert.match(panel,/if\(epoch!==gpsShiftEpoch\|\|!courier\?\.available\)return/);
 assert.match(panel,/courierAdvancedDiagnostics/);
});


test('returning from Android permission settings refreshes opted-in Firebase token',()=>{
 const resume=main.slice(main.indexOf('@Override protected void onResume()'),main.indexOf('@Override protected void onNewIntent('));
 assert.match(resume,/postMessage\\?\\.\\('refresh'\\)/);
 assert.match(resume,/postMessage\\?\\.\\('status'\\)/);
 assert.match(resume,/postMessage\\?\\.\\('motion_permission_status'\\)/);
 // The native bridge never sends service-role credentials or device push
 // tokens to pages outside the authenticated courier origin.
 assert.match(main,/Collections\\.singleton\\("https:\\/\\/" \\+ HOST\\)/);
 assert.match(main,/if \\(!mainFrame \\|\\| !isHttps\\(origin\\)/);
});
