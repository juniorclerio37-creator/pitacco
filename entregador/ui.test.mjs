import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { runInNewContext } from "node:vm";

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
 assert.doesNotMatch(page,/id="nativeNotificationSettings"/);
 assert.ok(page.includes('postMessage("test")'));
 assert.ok(build.includes('versionCode 35'));
 assert.ok(build.includes("versionName '2.0.15'"));
 assert.ok(generator.includes('duration = 1.78'));
});

test("courier can check Android push registration without exposing device tokens or secrets",()=>{
 const page=read("painel.html");
 const migration=read("../supabase/migrations/20261118004500_courier_push_readiness.sql");
 assert.match(page,/id="checkNativePush"/);
 assert.match(page,/id="nativePushReadiness"/);
 assert.match(page,/pitacco_courier_push_readiness/);
 assert.match(page,/await checkNativePushStatus\(\)/);
 assert.match(page,/native\.postMessage\("test"\)/);
 assert.match(page,/if\(document\.hidden\)return/);
 assert.match(page,/native\?\.postMessage/);
 assert.doesNotMatch(page,/if\(!document\.hidden\)playAssignmentSound\(\)/);
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
 assert.match(activity,/requestSetupPermissions\(FIRST_OPEN_NOTIFICATION_PERMISSION, Manifest\.permission\.POST_NOTIFICATIONS\)/);
 assert.doesNotMatch(enable,/requestPermissions/);
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
 assert.doesNotMatch(page,/id="shiftSoundToggle"|postMessage\("shift_(?:enable|disable)"\)/);
 assert.ok(page.includes('if(value.startsWith("shift_test:"))'));
 assert.doesNotMatch(activity,/"shift_(?:enable|disable)"\.equals\(action\)/);
 assert.ok(activity.includes('ShiftSoundPlayer.setEnabled(this, true)'));
 assert.ok(activity.includes('token_admin:'));
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
 assert.match(activity,/if \(!waitingForSystem\) showFirstOpenSetup\(\)/);
 assert.match(activity,/FIRST_OPEN_NOTIFICATION_PERMISSION/);
 assert.match(activity,/setPositiveButton\("Ativar som forte"/);
 assert.match(activity,/ShiftSoundPlayer\.setEnabled\(this, true\)/);
 assert.doesNotMatch(page,/id="shiftSoundState"|id="shiftSoundUnsupported"/);
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
 assert.doesNotMatch(page,/pitacco_driver_reconcile_ifood/);
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
 assert.doesNotMatch(page,/async function reconcileIfoodConfirmation\(d\)/);
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

test("iFood external confirmation opens a browser or offers a copy fallback",()=>{
 const page=read("painel.html"),css=read("painel.css");
 assert.match(page,/external\.target=window\.PitaccoPush\?\.postMessage\?"_self":"_blank"/);
 assert.match(page,/window\.location\.assign\(officialUrl\)/);
 assert.match(page,/navigator\.clipboard\.writeText\(officialUrl\)/);
 assert.doesNotMatch(page,/Já confirmei no iFood • Atualizar/);
 assert.match(css,/\.card-ifood-copy\{/);
});
test("servidor encerra pedidos iFood oficiais e cancelados sem contabilizar ganhos",()=>{
 const sql=read("../supabase/migrations/20261118171000_pitacco_courier_terminal_status_sync.sql");
 const page=read("painel.html");
 assert.match(sql,/after update of done_at on pitacco_private\.ifood_events/);
 assert.match(sql,/where l\.external_id=new\.order_id and l\.merchant_id=new\.merchant_id/);
 assert.match(sql,/e\.code='CONCLUDED' and e\.done_at is not null/);
 assert.match(sql,/external_delivery_status='CONCLUDED'/);
 assert.match(sql,/courier_payment=0/);
 assert.match(sql,/after update of status on public\.orders/);
 assert.match(sql,/new\.source='proprio' and new\.status='cancelled'/);
 assert.match(sql,/d\.status in \('entregue','cancelada'\)/);
 assert.match(sql,/case when d\.status='entregue' then d\.courier_payment else 0 end/);
 assert.match(page,/const canceled=x\.status==="cancelada"/);
 assert.match(page,/canceled\?"R\$ 0,00"/);
 assert.match(page,/\.filter\(d=>!\["entregue","cancelada"\]\.includes\(d\.status\)\)/);
});

test("código incorreto aparece só sob campo, não no topo, e some ao editar",()=>{
 const page=read("painel.html"),css=read("painel.css");
 assert.match(page,/const codeDrafts=new Map\(\)/);
 assert.match(page,/function inlineCodeError\(deliveryId,errorText\)/);
 assert.match(page,/const feedback=element\("p","verify-error",draft\.error\)/);
 assert.match(page,/feedback\.setAttribute\("aria-live","polite"\)/);
 assert.match(page,/fields\.append\(code,feedback\)/);
 assert.match(page,/feedback\.textContent="";feedback\.hidden=true/);
 assert.match(page,/code\.setAttribute\("aria-invalid","false"\)/);
 assert.match(page,/inlineCodeError\(d\.id,"Código incorreto"\)/);
 assert.match(page,/form\.noValidate=true/);
 assert.match(css,/\.verify-error\[hidden\]\{display:none!important\}/);
 const block=page.slice(page.indexOf("async function verifyCode(d,code){"),
     page.indexOf("async function loadSafeHistory(){"));
 assert.doesNotMatch(block,/catch\(error\)\{message\(/);
 assert.doesNotMatch(block,/Tentativas restantes:/);
 assert.match(page,/codeDrafts\.delete\(id\)/);
 assert.doesNotMatch(page,/Aguardando o iFood confirmar a entrega\. Acompanhe a página oficial e tente atualizar novamente\./);
});
test("ganhos de entregas concluídas usam regra individual e valor único para loja e motoboy",()=>{
 const sql=read("../supabase/migrations/20261118174000_pitacco_courier_completion_earnings.sql");
 const manager=read("../revisions/0.12/web/CourierWorkspace.jsx");
 const finances=read("../revisions/0.12/web/CourierFinance.jsx");
 const page=read("painel.html");
 assert.match(sql,/new\.status='cancelada'/);
 assert.match(sql,/new\.courier_payment:=0/);
 assert.match(sql,/r\.store_id=new\.store_id and r\.courier_id=new\.courier_id/);
 assert.match(sql,/v_rule\.include_customer_fee/);
 assert.match(sql,/new\.courier_payment:=v_amount/);
 assert.match(sql,/coalesce\(new\.courier_payment,0\)>0/);
 assert.match(sql,/v_rule\.mode='daily' then return new/);
 assert.match(manager,/d\.status==='entregue'/);
 assert.match(manager,/d\.courier_payment/);
 assert.match(finances,/\.eq\('status','entregue'\)/);
 assert.match(finances,/courier_payment/);
 assert.match(page,/sb\.rpc\("pitacco_driver_earnings"/);
});

test('site público é uma página de instalação e app mantém login interno',()=>{
 const page=read('acesso.html');
 assert.match(page,/id="publicInstaller"/);
 assert.match(page,/id="downloadAndroid"[^>]*Pitacco-Entregador-2\.0\.6[.]apk/);
 assert.match(page,/html:not\([.]pitacco-native\) #nativeAccessPanel\{display:none/);
 assert.match(page,/html[.]pitacco-native #publicInstaller\{display:none/);
 assert.match(page,/window[.]PitaccoPush/);
 assert.match(page,/if\(document[.]documentElement[.]classList[.]contains\('pitacco-native'\)\)routeSession\(\)/);
 assert.match(page,/createClient\(SUPABASE_URL/);
 assert.match(page,/auth[.]signIn\(/);
 assert.match(page,/rpc\("pitacco_public_courier_apk"\)/);
 assert.doesNotMatch(page,/Continuar na versão web/);
});


test("courier GPS requires location consent and server-authenticated reporting",()=>{
 const page=read("painel.html");
 const manifest=read("android-app/app/src/main/AndroidManifest.xml");
 const activity=read("android-app/app/src/main/java/br/com/pitacco/entregador/MainActivity.java");
 assert.match(manifest,/android.permission.ACCESS_FINE_LOCATION/);
 assert.match(manifest,/android.permission.ACCESS_COARSE_LOCATION/);
 assert.match(activity,/onGeolocationPermissionsShowPrompt/);
 assert.match(activity,/LOCATION_PERMISSION/);
 assert.match(activity,/HOST\.equalsIgnoreCase\(requestedOrigin\.getHost\(\)\)/);
 assert.match(page,/navigator\.geolocation\.watchPosition/);
 assert.match(page,/pitacco_courier_report_position/);
 assert.match(page,/syncGpsSharing\(\)/);
 assert.match(page,/accuracy>100/);
 assert.match(page,/stopGpsSharing\(\)/);
});

test("real courier assignment reuses the exact native bell and voice test, without browser chime",()=>{
 const page=read("painel.html");
 const activity=read("android-app/app/src/main/java/br/com/pitacco/entregador/MainActivity.java");
 const native=read("android-app/app/src/main/java/br/com/pitacco/entregador/AssignmentMessagingService.java");
 const audio=read("android-app/app/src/main/java/br/com/pitacco/entregador/ShiftSoundPlayer.java");
 assert.match(page,/function announceAssignments\(deliveries,courier\)/);
 assert.match(page,/native\.postMessage\("test"\)/);
 assert.match(activity,/if \("test"\.equals\(action\)\)/);
 assert.match(activity,/AssignmentMessagingService\.showAssignment/);
 assert.match(native,/ShiftSoundPlayer\.play\(context\)/);
 assert.match(audio,/raw\/pitacco_assignment/);
 assert.match(page,/if\(document\.hidden\)return/);
});

test("Android GPS authorization remains part of the original courier app upgrade",()=>{
 const app=read("android-app/app/build.gradle");
 const activity=read("android-app/app/src/main/java/br/com/pitacco/entregador/MainActivity.java");
 const screen=read("painel.html");
 assert.match(app,/applicationId 'br\.com\.pitacco\.entregador'/);
 assert.match(app,/versionCode 35/);
 assert.match(app,/versionName '2\.0\.15'/);
 assert.match(activity,/registerGpsBridge\(\)/);
 assert.match(activity,/WebViewCompat\.addWebMessageListener\(web, "PitaccoGps"/);
 assert.match(activity,/requestPermissions\(permissions, requestCode\)/);
 assert.match(activity,/ACTION_APPLICATION_DETAILS_SETTINGS/);
 assert.doesNotMatch(screen,/id="retryCourierGps"|id="openAndroidGpsSettings"/);
});

test("Android update preserves GPS permission prompts and registers push after login",()=>{
 const main=read("android-app/app/src/main/java/br/com/pitacco/entregador/MainActivity.java");
 const manifest=read("android-app/app/src/main/AndroidManifest.xml");
 const build=read("android-app/app/build.gradle");
 const workflow=read("../.github/workflows/courier-apk.yml");
 const panel=read("painel.html");
 assert.match(build,/applicationId 'br\.com\.pitacco\.entregador'/);
 assert.match(build,/versionCode 35/);
 assert.match(build,/versionName '2\.0\.15'/);
 for(const name of ["ACCESS_FINE_LOCATION","ACCESS_COARSE_LOCATION","POST_NOTIFICATIONS"])
  assert.ok(manifest.includes("android.permission."+name));
 assert.match(main,/permission_setup_v2_step/);
 assert.match(main,/requestSetupPermissions\(LOCATION_PERMISSION, Manifest\.permission\.ACCESS_FINE_LOCATION/);
 assert.match(main,/LOCATION_PERMISSION\) continuePermissionSetup\(2\)/);
 assert.match(main,/BACKGROUND_LOCATION_PERMISSION\) continuePermissionSetup\(3\)/);
 assert.match(main,/ACTIVITY_RECOGNITION_PERMISSION\) continuePermissionSetup\(4\)/);
 assert.match(workflow,/Conferir permissões e identidade do APK oficial/);
 assert.match(workflow,/dump permissions/);
 assert.doesNotMatch(panel,/id="pushBannerEnable"/);
 assert.match(panel,/showPushBanner\(/);
 assert.match(panel,/pitacco_courier_push_readiness/);
 assert.match(panel,/native\.postMessage\("enable"\)/);
 assert.match(panel,/O Pitacco registra automaticamente este aparelho após o login/);
});

test("Pitacco courier GPS continues in Android background only under a visible location foreground service",()=>{
 const manifest=read("android-app/app/src/main/AndroidManifest.xml");
 const service=read("android-app/app/src/main/java/br/com/pitacco/entregador/CourierLocationService.java");
 const activity=read("android-app/app/src/main/java/br/com/pitacco/entregador/MainActivity.java");
 const page=read("painel.html");
 const migration=read("../supabase/migrations/20261118234500_native_courier_background_gps_capabilities.sql");
 for(const p of ["FOREGROUND_SERVICE","FOREGROUND_SERVICE_LOCATION","ACCESS_FINE_LOCATION"])
  assert.match(manifest,new RegExp("android.permission."+p));
 assert.match(manifest,/android:foregroundServiceType="location"/);
 assert.match(manifest,/CourierLocationService" android:exported="false"/);
 assert.match(manifest,/ACCESS_BACKGROUND_LOCATION/);
 assert.match(activity,/showBackgroundLocationDisclosure/);
 assert.match(activity,/backgroundPermissionState/);
 assert.doesNotMatch(page,/id="requestBackgroundGps"/);
 assert.match(service,/FOREGROUND_SERVICE_TYPE_LOCATION/);
 assert.match(service,/startForeground\(NOTIFICATION_ID/);
 assert.match(service,/LocationManager\.GPS_PROVIDER/);
 assert.match(service,/requestLocationUpdates/);
 assert.match(service,/\.setOngoing\(true\)/);
 assert.match(service,/Parar rastreamento/);
 assert.match(service,/START_NOT_STICKY/);
 assert.match(service,/onDestroy\(\)/);
 assert.doesNotMatch(service,/service.role|SUPABASE_SERVICE_ROLE_KEY|refresh_token|accessToken/i);
 assert.match(activity,/startForegroundService\(tracking\)/);
 assert.match(activity,/if \("tracking_status"\.equals\(action\)\)/);
 assert.doesNotMatch(page,/id="startNativeGps"/);
 assert.doesNotMatch(page,/id="stopNativeGps"/);
 assert.match(page,/pitacco_courier_background_gps_start/);
 assert.match(page,/pitacco_courier_background_gps_revoke/);
 assert.match(page,/if\(!nextOnline\)\{await stopNativeGpsTracking\(\);stopGpsSharing\(\);\}/);
 assert.match(migration,/extensions\.gen_random_bytes\(32\)/);
 assert.match(migration,/extensions\.digest\(v_token,'sha256'\)/);
 assert.match(migration,/interval '12 hours'/);
 assert.match(migration,/c\.active and c\.available/);
 assert.match(migration,/sess\.id=cap\.session_id/);
 assert.match(migration,/expires_at>v_time/);
 assert.match(migration,/pitacco_revoke_offline_background_gps/);
 assert.match(migration,/revoke all on pitacco_private\.courier_gps_capabilities from public,anon,authenticated/);
});

test("courier receives native shift alerts with webview background even when Firebase sender is disabled",()=>{
 const service=read("android-app/app/src/main/java/br/com/pitacco/entregador/CourierLocationService.java");
 const notification=read("android-app/app/src/main/java/br/com/pitacco/entregador/AssignmentMessagingService.java");
 const migration=read("../supabase/migrations/20261119002000_courier_native_shift_assignment_watch.sql");
 const manifest=read("android-app/app/src/main/AndroidManifest.xml");
 assert.match(service,/private final Runnable orderWatch/);
 assert.match(service,/watchHandler\.postDelayed\(this, ORDER_WATCH_MS\)/);
 assert.match(service,/pitacco_courier_background_assignments/);
 assert.match(service,/MainActivity\.isPushOptedIn\(this\)/);
 assert.match(service,/AssignmentMessagingService\.showAssignment\(this, eventId\)/);
 assert.match(service,/watchHandler\.removeCallbacks\(orderWatch\)/);
 assert.match(notification,/firstAlertForEvent\(eventId\)/);
 assert.match(notification,/ShiftSoundPlayer\.play\(context\)/);
 assert.match(notification,/pitacco_assignment/);
 assert.match(manifest,/android:foregroundServiceType="location"/);
 assert.match(migration,/pitacco_private\.courier_gps_capabilities/);
 assert.match(migration,/d\.logistics_provider='loja'/);
 assert.match(migration,/d\.status='atribuida'/);
 assert.match(migration,/c\.active and c\.available/);
 assert.match(migration,/extensions\.digest\(p_token,'sha256'\)/);
 assert.match(migration,/auth\.sessions/);
 assert.doesNotMatch(migration,/customer_name|customer_phone|delivery_address/);
});

test("Firebase registration and readiness accept Supabase RPC thenables without .catch",async()=>{
 const panel=read("painel.html");
 // Supabase PostgrestBuilder is awaitable but not necessarily Promise.catch.
 assert.match(panel,/Promise\.resolve\(sb\.rpc\(rpcName,\{p_token:token\}\)\)/);
 assert.match(panel,/Promise\.resolve\(sb\.rpc\("pitacco_courier_push_readiness"\)\)/);
 assert.doesNotMatch(panel,/await sb\.rpc\(rpcName,\{p_token:token\}\)\.catch/);
 assert.match(panel,/try \{initializeNativePush\(\);\}/);

 const start=panel.indexOf("async function checkNativePushStatus(){");
 const end=panel.indexOf("async function loadAdminInbox(){",start);
 assert.ok(start>=0&&end>start,"Readiness diagnostics must exist");
 const snippet=panel.slice(start,end);
 const view={textContent:""};
 const $=id=>id==="nativePushReadiness"?view:{textContent:""};
 const seen=[];
 const createCheck=(rpc)=>new Function("$","sb","window",
   "showPushBanner","nativeFirebaseUnavailable","pushCheckRequestId",
   snippet+";return checkNativePushStatus;")(
   $,{rpc},{setTimeout,clearTimeout,PitaccoPush:{postMessage(){}}},
   (message)=>seen.push(message),false,0);
 const success={data:{device_registered:true,server_enabled:true,
   cron_credential_present:true,dispatch_scheduled:true},error:null};
 const thenable={
  then(onFulfilled,onRejected){return Promise.resolve(success).then(onFulfilled,onRejected);}
 };
 assert.equal(thenable.catch,undefined);
 await createCheck(()=>thenable)();
 assert.match(view.textContent,/Aparelho registrado e agendamento ativo/);
 assert.equal(seen.at(-1),"");
 const rejected={
  then(onFulfilled,onRejected){return Promise.reject(new Error("offline")).then(onFulfilled,onRejected);}
 };
 await createCheck(()=>rejected)();
 assert.match(view.textContent,/Não foi possível conferir o registro/);
});

test("Firebase courier device automatically retries session-scoped enrollment and stops after logout",()=>{
 const panel=read("painel.html");
 assert.match(panel,/nativePushRetryAttempts=0/);
 assert.match(panel,/nativePushRegistrationInFlight=true/);
 assert.match(panel,/nativePushRetryAttempts<5/);
 assert.match(panel,/\[2000,5000,12000,30000,60000\]/);
 assert.match(panel,/pitacco_register_courier_push_native/);
 assert.ok(panel.includes('window.PitaccoPush?.postMessage?.("refresh")'));
 const logout=panel.slice(panel.indexOf('async function logout(){'));
 assert.match(logout,/window\.clearTimeout\(nativePushRetryTimer\)/);
 assert.match(logout,/pitacco_unregister_courier_push/);
});


test("native shift waits for precise GPS authorization and stops without a late native start",async()=>{
 const page=read("./painel.html");
 const begin=page.indexOf("function startNativeGpsTracking()");
 const end=page.indexOf("function stopGpsSharing()",begin);
 const methods=page.slice(begin,end);
 const messages=[],requests=[];
 let release;
 const api=runInNewContext(methods+`
  ({startNativeGpsTracking,stopNativeGpsTracking,
    grant(){nativeGpsPermission="granted"},
    requested(){return gpsStartRequested}})`,{
  courier:{id:"courier",available:true},window:{PitaccoGps:{postMessage:value=>messages.push(value)}},
  document:{hidden:false},navigator:{onLine:true},nativeGpsPermission:"denied",nativeGpsRunning:false,
  gpsStartRequested:false,gpsStartTask:null,gpsStartGeneration:0,
  gpsStatus(){},showAndroidGpsSettings(){},SUPABASE_URL:"https://demo.invalid",
  SUPABASE_PUBLISHABLE_KEY:"test",
  sb:{rpc(name){
   requests.push(name);
   if(name.endsWith("_start"))return new Promise(resolve=>{release=()=>resolve({data:"a".repeat(64)});});
   return Promise.resolve({});
  }}
 });
 await api.startNativeGpsTracking();
 assert.equal(api.requested(),true);
 assert.deepEqual(requests,[]);
 api.grant();
 const started=api.startNativeGpsTracking();
 assert.equal(api.startNativeGpsTracking(),started);
 release();
 await started;
 assert.equal(messages.filter(msg=>msg.startsWith("start:")).length,1);

 messages.length=0;
 const pending=api.startNativeGpsTracking();
 const stopped=api.stopNativeGpsTracking();
 release();
 await Promise.all([stopped,pending]);
 assert.deepEqual(messages,["stop"]);
 assert.equal(requests.at(-1),"pitacco_courier_background_gps_revoke");
 assert.equal(api.requested(),false);
});
