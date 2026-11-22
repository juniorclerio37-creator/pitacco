import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');

test('APK shows sign-in promptly without trusting the local session marker',()=>{
 const page=read('entregador/acesso.html');
 assert.match(page,/localStorage\.getItem\('sb-mdevzehqcpcgxspwbiyz-auth-token'\)/);
 assert.match(page,/document\.getElementById\('login'\)\.classList\.remove\('hidden'\)/);
 assert.match(page,/<button class="primary" id="loginButton"[^>]*disabled/);
 assert.match(page,/\$\("loginButton"\)\.disabled=false/);
 assert.match(page,/html\.pitacco-native #publicInstaller/);
 assert.match(page,/window\.PitaccoPush/);
 assert.match(page,/downloadAndroid/);
 assert.match(page,/rel="preconnect"/);
});

test('login and dispatch panel require both server checks, in parallel, without redundant remote getUser',()=>{
 const login=read('entregador/acesso.html'),panel=read('entregador/painel.html');
 for(const [name,s,expr] of [
  ['login',login,/Promise\.all\(\[\s*call\("status"\),sb\.rpc\("pitacco_courier_session_ready"\)/],
  ['panel',panel,/Promise\.all\(\[\s*api\("status"\),sb\.rpc\("pitacco_courier_session_ready"\)/]
 ]){
  assert.match(s,expr,name+' should run server validation concurrently');
  assert.match(s,/sb\.auth\.getSession\(\)/);
  assert.match(s,/readyResult\.data!==true/);
 }
 const route=login.slice(login.indexOf('async function routeSession(){'),login.indexOf('$("loginForm").addEventListener'));
 const boot=panel.slice(panel.indexOf('async function boot(){'),panel.indexOf('$("online").addEventListener'));
 assert.doesNotMatch(route,/auth\.currentUser\(\)/);
 assert.doesNotMatch(boot,/driver\.currentUser\(\)/);
 assert.match(route,/status\.mustChangePassword/);
 assert.match(boot,/status\.mustChangePassword/);
});

test('the first dispatch refresh reads authorized records concurrently and preserves financial data',()=>{
 const panel=read('entregador/painel.html');
 assert.match(panel,/\[authorized,list,badges,originsResult(?:,gpsResult)?\]=await Promise\.all/);
 assert.match(panel,/driver\.myAllowedStores\(\)/);
 assert.match(panel,/driver\.myDeliveries\(\[courier\.id\]\)/);
 assert.match(panel,/sb\.rpc\("pitacco_driver_card_badges"\)/);
 assert.match(panel,/sb\.rpc\("pitacco_driver_route_origins"\)/);
 assert.match(panel,/Promise\.all\(\[loadEarnings\(\),loadSafeHistory\(\)\]\)/);
 assert.match(panel,/new Map\(authorized\.map\(/);
 assert.match(panel,/if\(records\.length!==1\)/);
 assert.match(panel,/if\(labelsError\)/);
});
