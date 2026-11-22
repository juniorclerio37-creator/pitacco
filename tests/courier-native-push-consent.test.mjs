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
 assert.ok(handler.indexOf('isPushOptedIn(this)')<handler.indexOf('showAssignment(this,eventId)'));
 assert.match(handler,/if\(eventId==null\|\|!eventId\.matches\(UUID_PATTERN\)\)return;/);
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
 assert.match(gradle,/versionCode 35/);
 assert.match(gradle,/versionName '2\.0\.15'/);
});
test('Android 11+ requests all-the-time permission separately with driver disclosure',()=>{
 assert.match(main,/private void showBackgroundLocationDisclosure\(\)/);
 assert.match(main,/Build\.VERSION\.SDK_INT >= 30/);
 assert.match(main,/Settings\.ACTION_APPLICATION_DETAILS_SETTINGS/);
 assert.match(main,/Manifest\.permission\.ACCESS_BACKGROUND_LOCATION/);
 assert.match(main,/backgroundPermissionState\(\)/);
 assert.match(main,/startActivityForResult\(settings, BACKGROUND_LOCATION_SETTINGS\)/);
 assert.match(main,/requestSetupPermissions\(BACKGROUND_LOCATION_PERMISSION,/);
 assert.match(main,/Essa autorização não ativa o plantão/);
 assert.doesNotMatch(panel,/id="requestBackgroundGps"|postMessage\("background_request"\)/);
 assert.match(main,/"granted"\.equals\(locationPermissionState\(\)\)/);
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

test('courier push readiness reports scheduler and Vault presence without exposing secrets',()=>{
 const sql=readFileSync(new URL('../supabase/migrations/20261121004500_courier_push_readiness_scheduler.sql',import.meta.url),'utf8');
 assert.match(sql,/pitacco_courier_session_ready\(\)/);
 assert.match(sql,/dispatch_scheduled/);
 assert.match(sql,/cron_credential_present/);
 assert.match(sql,/device_registered/);
 assert.match(sql,/server_enabled/);
 assert.match(sql,/grant execute on function public\.pitacco_courier_push_readiness/);
 assert.doesNotMatch(sql,/decrypted_secret/);
 assert.match(panel,/data\.dispatch_scheduled!==true/);
 assert.match(panel,/data\.cron_credential_present/);
 assert.doesNotMatch(panel,/não testa uma mensagem Firebase/);
 assert.match(panel,/class="courier-push-check panel-white courier-tech-internal"/);
});
test('Firebase OAuth preflight never claims or consumes queued orders',()=>{
 const script=sender;
 const start=script.indexOf("if(mode==='preflight')");
 const claim=script.indexOf("pitacco_claim_courier_push");
 assert.ok(start>=0);
 assert.ok(claim>start,'FCM OAuth preflight must return before claiming orders');
 assert.match(script,/const token=await googleToken\(\)/);
 assert.match(script,/!account\?\.private_key/);
 assert.match(script,/return Response\.json\(\{ready:true,phase:'firebase_oauth',dispatched:false\}/);
 assert.match(script,/status:503/);
});

test('Physical Activity is an opt-in Android runtime permission and never a GPS prerequisite',()=>{
 const permission='android.permission.ACTIVITY_RECOGNITION';
 assert.ok(manifest.includes(permission));
 assert.match(main,/ACTIVITY_RECOGNITION_PERMISSION = 98/);
 assert.match(main,/Build\.VERSION\.SDK_INT < 29/);
 assert.match(main,/requestSetupPermissions\(ACTIVITY_RECOGNITION_PERMISSION, Manifest\.permission\.ACTIVITY_RECOGNITION\)/);
 assert.match(main,/ACTIVITY_RECOGNITION_PERMISSION\) continuePermissionSetup\(4\)/);
 assert.doesNotMatch(panel,/id="requestPhysicalActivity"|postMessage\("activity_request"\)/);
 assert.match(gpsService,/requestActivityUpdates/);
 assert.match(gpsService,/MOTION_MAX_AGE_MS/);
 assert.match(gpsService,/physicalActivityConfidence/);
 assert.match(gpsService,/classifyMotion/);
 assert.match(gpsService,/gps_update_motion/);
 assert.match(gpsService,/gps_update",basic/);
 assert.match(readFileSync(new URL('../entregador/android-app/app/src/main/java/br/com/pitacco/entregador/CourierMotionReceiver.java',import.meta.url),'utf8'),/ActivityRecognitionResult/);
});
test('Native GPS diagnostics separate Android OS, WebView site and server-reported position',()=>{
 assert.match(main,/\"site_status\"\.equals\(action\)/);
 assert.match(main,/\"site_reset\"\.equals\(action\)/);
 assert.match(main,/callback\.invoke\(origin, true, true\)/);
 assert.match(panel,/function renderGpsPermissionDiagnostic/);
 assert.match(panel,/browserGpsDenied/);
 assert.match(panel,/async function verifyGpsUploadOnServer/);
 assert.match(panel,/select\("observed_at,accuracy_m"\)/);
});

test('motion classification is optional, shift-scoped and never treats stopped as offline',()=>{
 const main=readFileSync(new URL('../entregador/android-app/app/src/main/java/br/com/pitacco/entregador/MainActivity.java',import.meta.url),'utf8');
 const manifest=readFileSync(new URL('../entregador/android-app/app/src/main/AndroidManifest.xml',import.meta.url),'utf8');
 const fleet=readFileSync(new URL('../revisions/0.12/web/FleetTracking.jsx',import.meta.url),'utf8');
 const sql=readFileSync(new URL('../supabase/migrations/20261121013000_courier_motion_telemetry.sql',import.meta.url),'utf8');
 assert.match(manifest,/CourierMotionReceiver/);
 assert.match(manifest,/android:exported="false"/);
 assert.match(main,/ACTION_REFRESH_MOTION/);
 assert.match(main,/\"motion_status\"/);
 assert.match(panel,/id="courierMotionStatus"/);
 assert.match(panel,/postMessage\("motion_status"\)/);
 assert.match(fleet,/rpc\('pitacco_store_courier_motion'/);
 assert.match(fleet,/motionResult\.error\?\[\]/);
 assert.match(sql,/pitacco_courier_background_gps_update_motion/);
 assert.match(sql,/public\.pitacco_courier_background_gps_update\(/);
 assert.match(sql,/pitacco_can_manage_courier_store/);
});
