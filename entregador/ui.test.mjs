import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

function read(relative) {
  return readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8");
}
function syntaxCheck(source) {
  const folder=mkdtempSync(join(tmpdir(),"pitacco-syntax-"));
  try {
    const file=join(folder,"module.mjs");
    writeFileSync(file,source);
    const result=spawnSync(process.execPath,["--check",file],{encoding:"utf8"});
    assert.equal(result.status,0,result.stderr);
  } finally {rmSync(folder,{recursive:true,force:true});}
}
test("browser modules for driver login and delivery panel parse",()=>{
  for(const page of ["acesso.html","painel.html"]){
    const html=read(page);
    const match=html.match(/<script type="module">([\s\S]*?)<\/script>/i);
    assert.ok(match,"Missing module in "+page);
    syntaxCheck(match[1]);
  }
});
test("driver controls never implement public registration or accepting / rejecting",()=>{
  const login=read("acesso.html"),panel=read("painel.html");
  assert.match(login,/auth\.signIn/);
  assert.match(login,/change-password/);
  assert.doesNotMatch(login,/auth\.signUp\s*\(/);
  assert.match(panel,/pitacco_driver_collect/);
  assert.match(panel,/pitacco_driver_depart/);
  assert.doesNotMatch(panel,/set_delivery_status/);
  assert.doesNotMatch(panel,/pitacco_driver_accept/);
});
test("merchant management lives in existing Motoboys -> Entregadores tab",()=>{
  const workspace=read("../revisions/0.12/web/CourierWorkspace.jsx");
  const management=read("../revisions/0.12/web/CourierAccessManager.jsx");
  const legacy=read("../revisions/0.12/web/LogisticsHub.jsx");
  const oldPage=read("gestao.html");
  assert.match(workspace,/tab==='Entregadores'/);
  assert.match(workspace,/<CourierAccessManager/);
  assert.match(workspace,/tab==='Pagamentos'/);
  assert.match(workspace,/tab==='Relatórios'/);
  assert.match(workspace,/tab==='Entregas'/);
  assert.doesNotMatch(legacy,/register_courier/);
  assert.doesNotMatch(management,/auth\.signUp\s*\(/);
  assert.match(management,/client\.functions\.invoke\('pitacco-courier-access'/);
  for(const action of ['create','reset','disable','reactivate']){
    assert.ok(management.includes("'"+action+"'"),"Missing store management action "+action);
  }
  assert.match(oldPage,/app\.pitacco\.com\.br/);
  assert.doesNotMatch(oldPage,/type="password"/);
});
test("Edge Function parses and checks caller JWT and store membership",()=>{
  const edge=read("../supabase/functions/pitacco-courier-access/index.ts");
  syntaxCheck(edge);
  assert.match(edge,/admin\.auth\.getUser\(jwt\)/);
  assert.match(edge,/authorizeStore\(actor,/);
  assert.match(edge,/pitacco_courier_auth_state/);
  assert.doesNotMatch(edge,/Deno\.env\.get\("JWT_SECRET"\)/);
});

test("personal courier password accepts six or more characters",()=>{
 const page=read("acesso.html");
 const edge=read("../supabase/functions/pitacco-courier-access/index.ts");
 assert.match(page,/id="new"[^>]*minlength="6"/);
 assert.match(page,/id="confirm"[^>]*minlength="6"/);
 assert.match(page,/id="password"[^>]*minlength="6"/);
 assert.match(page,/next\.length<6\|\|next\.length>128\|\|next===current/);
 assert.match(edge,/next\.length < 6 \|\| next\.length > 128 \|\| current===next/);
 assert.doesNotMatch(edge,/next\.length < 12/);
 assert.doesNotMatch(page,/minlength="12"/);
});

test("login redirects normally when password update already revoked the session",()=>{
 const login=read("acesso.html");
 const panel=read("painel.html");
 assert.match(login,/await auth\.signOut\(\)\.catch\(\(\)=>\{\}\)/);
 assert.match(login,/Senha alterada com sucesso/);
 assert.match(login,/Sua sessão terminou/);
 assert.doesNotMatch(panel,/await sb\.auth\.signOut\(\);/);
});

test("courier app shows all authorized store origins without creating a second login",()=>{
 const panel=read("painel.html"),client=read("supabase-client.mjs"),detail=read("order-details.mjs");
 assert.match(panel,/driver\.myAllowedStores\(\)/);
 assert.match(panel,/permittedStores=new Map/);
 assert.match(panel,/LOJA • /);
 assert.match(panel,/store_name:permittedStores/);
 assert.match(panel,/orderDetails\.open\(d\)/);
 assert.match(client,/rpc\('pitacco_driver_allowed_stores'\)/);
 assert.match(client,/\.in\('courier_id', courierIds\)/);
 assert.match(detail,/delivery\.store_name/);
 assert.match(panel,/records\.length!==1/);
});

test("native courier notifications play a high-importance sound when app is in background",()=>{
 const java=read("android-app/app/src/main/java/br/com/pitacco/entregador/AssignmentMessagingService.java");
 const activity=read("android-app/app/src/main/java/br/com/pitacco/entregador/MainActivity.java");
 const manifest=read("android-app/app/src/main/AndroidManifest.xml");
 const build=read("android-app/app/build.gradle");
 const page=read("painel.html");
 const generator=read("android-app/generate-alert.py");
 assert.ok(manifest.includes('android:name=".AssignmentMessagingService"'));
 assert.ok(manifest.includes('com.google.firebase.MESSAGING_EVENT'));
 assert.ok(java.includes('extends FirebaseMessagingService'));
 assert.ok(java.includes('onMessageReceived(RemoteMessage message)'));
 assert.ok(java.includes('NotificationManager.IMPORTANCE_HIGH'));
 assert.ok(java.includes('AudioAttributes.USAGE_NOTIFICATION_EVENT'));
 assert.ok(java.includes('pitacco_new_assignment_loud_v2'));
 assert.ok(java.includes('PendingIntent.FLAG_IMMUTABLE'));
 assert.ok(activity.includes('FirebaseMessaging.getInstance().setAutoInitEnabled(true)'));
 assert.ok(activity.includes('AssignmentMessagingService.showAssignment'));
 assert.ok(page.includes('nativeNotificationSettings'));
 assert.ok(page.includes('postMessage("test")'));
 assert.ok(build.includes('versionCode 26'));
 assert.ok(build.includes("versionName '2.0.6'"));
 assert.ok(generator.includes('duration = 1.78'));
});

test("courier can check Android push registration without exposing device tokens or secrets",()=>{
 const page=read("painel.html");
 const migration=read("../supabase/migrations/20261118004500_courier_push_readiness.sql");
 assert.match(page,/id="checkNativePush"/);
 assert.match(page,/id="nativePushReadiness"/);
 assert.match(page,/pitacco_courier_push_readiness/);
 assert.match(page,/await checkNativePushStatus\(\)/);
 assert.ok(page.includes('if(!document.hidden)playAssignmentSound()'));
 assert.doesNotMatch(page,/if\(!nativePushRegistered\)playAssignmentSound\(\)/);
 assert.match(migration,/public\.pitacco_courier_session_ready\(\)/);
 assert.match(migration,/d\.session_id::text=v_session/);
 assert.match(migration,/d\.expires_at>now\(\)/);
 assert.match(migration,/revoke all on function public\.pitacco_courier_push_readiness\(\) from public,anon,authenticated/);
 assert.doesNotMatch(migration,/jsonb_build_object\([^;]*token/);
});

test("installed Android app with outdated native bridge falls back to audible web chime",()=>{
 const page=read("painel.html");
 assert.match(page,/nativeTestPending=true/);
 assert.match(page,/await enableAssignmentSound\(\)/);
 assert.match(page,/window\.setTimeout\(\(\)=>\{/);
 assert.match(page,/window\.PitaccoPush\.postMessage\("test"\)/);
 assert.match(page,/playWebSoundWhenNativeFails/);
 assert.match(page,/if\(value==="tested"\)/);
 assert.match(page,/nativeTestPending=false/);
 assert.match(page,/O Android não respondeu ao teste nativo/);
 assert.match(page,/Sem resposta do Android/);
 assert.match(page,/Avisos em segundo plano exigem Firebase ativo/);
});

test("courier continues to show opened deliveries offline without unsafe queued completion",()=>{
 const page=read("painel.html");
 assert.match(page,/id="connectionBanner"/);
 assert.match(page,/window.addEventListener\("offline",updateConnectionBanner\)/);
 assert.match(page,/window.addEventListener\("online"/);
 assert.match(page,/if\(courier\)refresh\(\)/);
 assert.match(page,/\$\("online"\)\.disabled=navigator\.onLine===false/);
 assert.match(page,/confirmações precisam de internet/);
 // No customer/address snapshots in unencrypted browser persistence.
 assert.doesNotMatch(page,/localStorage\.setItem\([^)]*assignedDeliveries/);
});

test("Pitacco Entregador 2.0 responds to native notification restrictions without claiming audible playback",()=>{
 const service=read("android-app/app/src/main/java/br/com/pitacco/entregador/AssignmentMessagingService.java");
 const activity=read("android-app/app/src/main/java/br/com/pitacco/entregador/MainActivity.java");
 const page=read("painel.html");
 assert.ok(service.includes('notificationStatus(Context context)'));
 assert.ok(service.includes('channel_silent'));
 assert.ok(service.includes('channel_disabled'));
 assert.ok(service.includes('NotificationManager.IMPORTANCE_NONE'));
 assert.ok(activity.includes('notification_status:'));
 assert.ok(activity.includes('AssignmentMessagingService.notificationStatus(this)'));
 assert.ok(activity.includes('onNewIntent(Intent intent)'));
 assert.ok(activity.includes('pitacco_assignment_alert'));
 assert.ok(page.includes('native.postMessage("status")'));
 assert.ok(page.includes('canal de novas entregas'.toLowerCase())||page.includes('Canal de novas entregas'));
 assert.ok(page.includes('O teste de sino pela tela foi iniciado'));
 assert.ok(!page.includes('O sino da tela foi reproduzido.'));
});

test("courier notification diagnostics terminate and identify QA APK without Firebase",()=>{
 const page=read("painel.html");
 assert.ok(page.includes('let nativeFirebaseUnavailable=false'));
 assert.ok(page.includes('new Promise(resolve=>{timer=window.setTimeout'));
 assert.ok(page.includes('7000'));
 assert.ok(page.includes('window.clearTimeout(timer)'));
 assert.ok(page.includes('if(requestId!==pushCheckRequestId)return'));
 assert.ok(page.includes('if(value==="unavailable")'));
 assert.ok(page.includes('Este APK de teste não tem Firebase configurado.'));
 assert.ok(page.includes('Não foi possível consultar o servidor em 7 segundos.'));
});

test("parallel Android test asks notification permission even without Firebase",()=>{
 const activity=read("android-app/app/src/main/java/br/com/pitacco/entregador/MainActivity.java");
 const manifest=read("android-app/app/src/main/AndroidManifest.xml");
 const start=activity.indexOf("private void enablePush(JavaScriptReplyProxy reply)");
 const end=activity.indexOf("private void finishPushEnable(", start);
 const enable=activity.slice(start,end);
 assert.ok(enable.includes("requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS}"));
 assert.ok(!enable.includes("FirebaseApp.getApps(this).isEmpty()"));
 const finish=activity.slice(end,activity.indexOf("private void sendToken(",end));
 assert.ok(finish.includes("if (FirebaseApp.getApps(this).isEmpty())"));
 assert.ok(finish.includes('reply.postMessage("unavailable")'));
 assert.ok(activity.includes("Settings.ACTION_APP_NOTIFICATION_SETTINGS"));
 assert.ok(activity.includes("Settings.ACTION_CHANNEL_NOTIFICATION_SETTINGS"));
 assert.ok(manifest.includes('android.permission.POST_NOTIFICATIONS'));
});

test("delivery Shift Sound is opt-in, restores prior alarm volume, and reserves separate courier voice",()=>{
 const page=read("painel.html");
 const activity=read("android-app/app/src/main/java/br/com/pitacco/entregador/MainActivity.java");
 const player=read("android-app/app/src/main/java/br/com/pitacco/entregador/ShiftSoundPlayer.java");
 const service=read("android-app/app/src/main/java/br/com/pitacco/entregador/AssignmentMessagingService.java");
 const manifest=read("android-app/app/src/main/AndroidManifest.xml");
 const generator=read("android-app/generate-alert.py");
 assert.ok(page.includes('id="shiftSoundToggle"'));
 assert.ok(page.includes('window.confirm("Ativar Modo Plantão?'));
 assert.ok(page.includes('native.postMessage("shift_enable")'));
 assert.ok(page.includes('native.postMessage("shift_disable")'));
 assert.ok(page.includes('if(value.startsWith("shift_test:"))'));
 assert.ok(activity.includes('"shift_enable".equals(action)'));
 assert.ok(activity.includes('ShiftSoundPlayer.setEnabled(this, true)'));
 assert.ok(activity.includes('token_native:'));
 assert.ok(player.includes('getBoolean(KEY_ENABLED, false)'));
 assert.ok(player.includes('AudioManager.STREAM_ALARM'));
 assert.ok(player.includes('setStreamVolume(AudioManager.STREAM_ALARM, raised, 0)'));
 assert.ok(player.includes('manager.getStreamVolume(AudioManager.STREAM_ALARM) == temporary'));
 assert.ok(player.includes('getCurrentInterruptionFilter()'));
 assert.ok(player.includes('MediaPlayer instance = new MediaPlayer()'));
 assert.ok(service.includes('SHIFT_CHANNEL_ID'));
 assert.ok(service.includes('ShiftSoundPlayer.play(context)'));
 assert.ok(manifest.includes('android.permission.MODIFY_AUDIO_SETTINGS'));
 assert.ok(generator.includes("assets/voz-entregador.wav"));
 assert.ok(generator.includes('bell + dedicated courier voice'));
 assert.ok(generator.includes('bell only'));
 assert.ok(generator.includes('Do NOT reuse the'));
 assert.ok(!page.includes('automatically changes Do Not Disturb'));
});
test("courier 2.0 registers FCM native payload without removing legacy token registration",()=>{
 const page=read("painel.html");
 const migration=read("../supabase/migrations/20261118040000_pitacco_courier_native_voice_push.sql");
 assert.ok(page.includes('pitacco_register_courier_push_native'));
 assert.ok(page.includes('pitacco_register_courier_push"'));
 assert.ok(migration.includes("push_protocol text not null default 'notification'"));
 assert.ok(migration.includes("push_protocol='data_only'"));
 assert.ok(migration.includes('grant execute on function public.pitacco_courier_push_protocol(text) to service_role'));
});

test("first opening asks for notification permission and offers explicit shift sound opt-in",()=>{
 const activity=read("android-app/app/src/main/java/br/com/pitacco/entregador/MainActivity.java");
 const page=read("painel.html");
 const css=read("painel.css");
 assert.match(activity,/if \(state == null\) showFirstOpenSetup\(\)/);
 assert.match(activity,/FIRST_OPEN_NOTIFICATION_PERMISSION/);
 assert.match(activity,/requestFirstOpenNotifications\(\)/);
 assert.match(activity,/requestPermissions\(new String\[\]\{Manifest\.permission\.POST_NOTIFICATIONS\}/);
 assert.match(activity,/finishFirstOpenNotifications\(\)/);
 assert.match(activity,/setPositiveButton\("Ativar som forte"/);
 assert.match(activity,/ShiftSoundPlayer\.setEnabled\(this, true\)/);
 assert.match(page,/id="shiftSoundState">ATIVAR<\/span>/);
 assert.match(page,/id="shiftSoundUnsupported"/);
 assert.match(page,/window\.clearTimeout\(shiftProbe\)/);
 assert.match(css,/\.settings-row\[hidden\]\{display:none!important\}/);
});

test("cartão mostra Ir ao lado do endereço e PIN após Cheguei sem abrir detalhes",()=>{
 const page=read("painel.html");
 const android=read("android-app/app/src/main/java/br/com/pitacco/entregador/MainActivity.java");
 const css=read("painel.css");
 assert.match(page,/card-address-row/);
 assert.match(page,/element\("a","card-route-link","Ir"\)/);
 assert.match(page,/data-route-delivery/);
 assert.doesNotMatch(page,/createAction\("Abrir rota"/);
 assert.match(page,/Você chegou ao destino/);
 assert.match(page,/Peça o código de confirmação ao cliente/);
 assert.match(page,/element\("a","btn secondary card-ifood-confirm","Abrir confirmação no iFood"\)/);
 assert.match(page,/https:\/\/confirmacao-entrega-propria\.ifood\.com\.br\//);
 assert.match(android,/confirmacao-entrega-propria\.ifood\.com\.br/);
 assert.match(page,/pitacco_driver_reconcile_ifood/);
 assert.match(page,/if\(d\.source==="proprio"\|\|d\.source==="ifood"\)/);
 assert.match(css,/\.card-address-row\{/);
});
test("sequência agrupada aparece somente para lotes válidos e navega por preferência",()=>{
 const page=read("painel.html");
 const source=read("route-sequence.mjs");
 const migration=read("../supabase/migrations/20261118130000_pitacco_driver_route_ifood_reconcile.sql");
 assert.match(page,/id="routeSuggestions"/);
 assert.match(page,/suggestedBatchRoutes\(deliveries,routeOrigins,lastCompletedBatchStops\)/);
 assert.match(page,/pitacco_driver_route_origins/);
 assert.match(page,/data-route-delivery/);
 assert.match(source,/Math\.sin/);
 assert.match(source,/delivery\.batch_id/);
 assert.match(migration,/pitacco_driver_route_origins/);
 assert.match(migration,/pitacco_driver_reconcile_ifood/);
 assert.match(migration,/if v_status is distinct from 'CONCLUDED' or not exists/);
 assert.doesNotMatch(migration,/set delivery_code_verified_at/);
});

test("identidade de motinho laranja aprovada aparece no acesso, painel e ícone nativo",()=>{
 const login=read("acesso.html");
 const panel=read("painel.html");
 const css=read("painel.css");
 const svg=read("logo-entregador.svg");
 const android=read("android-app/app/src/main/res/drawable/ic_pitacco.xml");
 const manifest=read("android-app/app/src/main/AndroidManifest.xml");
 assert.match(login,/src="\.\/logo-entregador\.svg"/);
 assert.match(panel,/src="\.\/logo-entregador\.svg"/);
 assert.match(css,/\.app-logo img/);
 assert.match(svg,/viewBox="0 0 380 370"/);
 assert.match(svg,/fill-rule="evenodd"/);
 assert.match(svg,/#FF850D/);
 assert.match(android,/android:fillColor="#FF7209"/);
 assert.match(android,/android:fillType="evenOdd"/);
 assert.match(manifest,/android:icon="@drawable\/ic_pitacco"/);
});

test("roteiro avança do último ponto apenas quando entrega realmente foi confirmada",()=>{
 const page=read("painel.html");
 const route=read("route-sequence.mjs");
 assert.match(page,/lastCompletedBatchStops=new Map/);
 assert.match(page,/function rememberCompletedBatchStop\(d\)/);
 assert.match(page,/if\(data\?\.confirmed\)\{\s*rememberCompletedBatchStop\(d\)/);
 assert.match(page,/orderDetails\.close\(\);\s*rememberCompletedBatchStop\(d\)/);
 assert.match(page,/suggestedBatchRoutes\(deliveries,routeOrigins,lastCompletedBatchStops\)/);
 assert.match(page,/Confirme esta entrega antes de seguir/);
 assert.match(route,/while\(remaining\.length\)/);
 assert.match(route,/distanceKm\(cursor,point\(remaining\[i\]\)\)/);
 assert.doesNotMatch(page,/localStorage\.setItem\([^)]*lastCompletedBatchStops/);
});

test("múltiplas paradas têm opção de percurso Maps só quando não há chegada pendente",()=>{
 const page=read("painel.html");
 const navigation=read("navigation.mjs");
 assert.match(page,/buildBatchNavigationUrl\(plan\.stops\.map\(stop=>stop\.delivery\),navProvider,navMode\)/);
 assert.match(page,/!plan\.stops\.some\(stop=>stop\.delivery\.arrived_at\)/);
 assert.match(page,/Ver percurso completo no Google Maps/);
 assert.match(page,/renderRouteSuggestions\(assignedDeliveries\)/);
 assert.match(navigation,/deliveries\.length>4/);
 assert.match(navigation,/provider!=='google'/);
});
