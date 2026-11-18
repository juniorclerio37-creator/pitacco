import test from 'node:test';
import assert from 'node:assert/strict';
import {discoverPublicWindowsInstaller,downloadPublicWindowsInstaller,officialCourierApkUrl,downloadRelease} from '../appReleases.mjs';

const repo='https://github.com/juniorclerio37-creator/pitacco';
const url=repo+'/releases/download/pitacco-windows-123abc456def/Pitacco-Windows-Setup.exe';
const release={tag_name:'pitacco-windows-123abc456def',draft:false,prerelease:false,
 published_at:'2026-11-17T16:00:00Z',
 assets:[{name:'Pitacco-Windows-Setup.exe',size:12345678,browser_download_url:url}]};

test('discovers Windows installer only from published verified-release channel',async()=>{
 const installed=await discoverPublicWindowsInstaller(async requestUrl=>{
   assert.match(requestUrl,/api\.github\.com\/repos\/juniorclerio37-creator\/pitacco\/releases/);
   return {ok:true,json:async()=>[
    {...release,draft:true},
    {...release,tag_name:'pitacco-android-123abc456def'},
    {...release,assets:[{name:'Pitacco-Windows-Setup.exe',size:10,browser_download_url:'https://attacker.invalid/bad.exe'}]},
    release]};
 });
 assert.equal(installed.url,url);
 assert.equal(installed.published_at,'2026-11-17T16:00:00Z');
});
test('rejects empty releases and invalid API responses',async()=>{
 assert.equal(await discoverPublicWindowsInstaller(async()=>({ok:true,json:async()=>[]})),null);
 await assert.rejects(()=>discoverPublicWindowsInstaller(async()=>({ok:false,status:403})),/Não foi possível/);
});
test('public Windows download links are restricted to the real GitHub release asset',()=>{
 const original=globalThis.document;
 let href,clicked=0,removed=0,downloadName='',openedNewTab=false;
 globalThis.document={
   createElement:()=>({set href(value){href=value},get href(){return href},
     set download(value){downloadName=value},get download(){return downloadName},
     set target(value){openedNewTab=value==='_blank'},
     rel:'',click(){clicked++},remove(){removed++}}),
   body:{append(){}}
 };
 try{
   downloadPublicWindowsInstaller({url});
   assert.equal(href,url);assert.equal(clicked,1);assert.equal(removed,1);
   assert.equal(downloadName,'Pitacco-Windows-Setup.exe');
   assert.equal(openedNewTab,false,'download should not open a GitHub tab');
   assert.throws(()=>downloadPublicWindowsInstaller({url:'https://attacker.invalid/setup.exe'}),/indisponível/);
 }finally{globalThis.document=original}
});

test('Super Admin links only verified official Android GitHub download format',async()=>{
 const prefix='https://github.com/juniorclerio37-creator/pitacco/releases/download/';
 const url=prefix+'pitacco-entregador-v2.0.6-4e5c9c2de727/Pitacco-Entregador-2.0.6.apk';
 const release={app:'android',channel:'stable',version:'2.0.6',
  filename:'Pitacco-Entregador-2.0.6.apk',distribution_source:'github_official',external_download_url:url};
 assert.equal(officialCourierApkUrl(release),url);
 assert.equal(officialCourierApkUrl({...release,version:'2.0.7'}),null);
 assert.equal(officialCourierApkUrl({...release,external_download_url:'https://evil.example/asset.apk'}),null);
 assert.equal(officialCourierApkUrl({...release,channel:'test'}),null);
 let clicked=0,removed=0,href='',download='';
 globalThis.document={body:{append(){}},createElement(){
  return {set href(v){href=v},get href(){return href},
   set download(v){download=v},get download(){return download},set rel(_){},
   click(){clicked++},remove(){removed++}};
 }};
 try{
  await downloadRelease(null,release);
  assert.equal(href,url);
  assert.equal(download,release.filename);
  assert.equal(clicked,1);
  assert.equal(removed,1);
  await assert.rejects(()=>downloadRelease(null,{...release,external_download_url:'https://evil.example/asset.apk'}),/não corresponde/);
 }finally{delete globalThis.document;}
});
