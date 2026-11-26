import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runWindowsStartupUpdate,startWindowsUpdatePolling,UPDATE_POLL_MS} from '../windowsAutoUpdate.mjs';
test('web startup never accesses native updater; Windows attempts only once and failure opens workspace',async()=>{
 let calls=0;
 const call=async cmd=>{assert.equal(cmd,'startup_update');calls++;throw Error('offline')};
 assert.equal((await runWindowsStartupUpdate(false,call)).state,'skipped');
 const results=await Promise.all([runWindowsStartupUpdate(true,call),runWindowsStartupUpdate(true,call)]);
 assert.deepEqual(results,[{state:'deferred'},{state:'deferred'}]);assert.equal(calls,1);
});
test('periodic checks never install or overlap; disposal prevents stale notices',async()=>{
 let tick,resolve,count=0,cancelled=false,notices=[];
 const dispose=startWindowsUpdatePolling({native:true,call:cmd=>{assert.equal(cmd,'check_update_available');count++;return new Promise(r=>{resolve=r})},onAvailable:v=>notices.push(v),schedule:(cb,ms)=>{assert.equal(ms,UPDATE_POLL_MS);tick=cb;return 7},cancel:id=>{assert.equal(id,7);cancelled=true}});
 const first=tick();await tick();assert.equal(count,1);resolve('0.12.45');await first;assert.deepEqual(notices,['0.12.45']);
 const second=tick();dispose();resolve('0.12.46');await second;assert.ok(cancelled);assert.deepEqual(notices,['0.12.45']);
});
test('native install gates before and after download and auto checks do not install',()=>{
 const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
 const rust=read('src-tauri/src/main.rs'),ui=read('src.jsx');
 assert.match(rust,/STARTUP_UPDATE_ATTEMPTED\.swap/);
 assert.match(rust,/state\.active\.lock\(\).*?\.is_some\(\)/);
 assert.match(rust,/state IN \('queued','printing'\)/);
 const install=rust.slice(rust.indexOf('async fn install_signed_update'),rust.indexOf('#[tauri::command]async fn check_update('));
 assert.ok(install.indexOf('update_guard(&app,startup)?')<install.indexOf('update.download('));
 assert.ok(install.lastIndexOf('update_guard(&app,startup)?')>install.indexOf('update.download('));
 assert.ok(install.lastIndexOf('update_guard(&app,startup)?')<install.indexOf('.install(bytes)'));
 assert.match(install,/restart_after_install\(true\)/);
 const poll=rust.slice(rust.indexOf('async fn check_update_available'),rust.indexOf('fn worker('));
 assert.doesNotMatch(poll,/\.download\(|\.install\(/);
 assert.match(ui,/if\(!ready\)return/);
 assert.match(ui,/<WindowsStartupGate\/>/);
});
