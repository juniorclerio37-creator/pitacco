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
 assert.ok(build.includes('versionCode 3'));
 assert.ok(build.includes("versionName '1.0.2'"));
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
 assert.match(page,/Avisos com o aplicativo fechado exigem configuração nativa e Firebase/);
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
