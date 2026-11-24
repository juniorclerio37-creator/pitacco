import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {latestOfficialCourierRelease,discoverCourierReleaseWithFallback,
 compareCourierVersions,verifiedCourierApk} from './app-update.mjs';

const prefix='https://github.com/juniorclerio37-creator/pitacco/releases/download/';
const version='2.0.16';
const url=prefix+'pitacco-entregador-v'+version+'-123456789abc/Pitacco-Entregador-'+version+'.apk';
const sha='a'.repeat(64);
const latest={tag_name:'pitacco-entregador-v'+version+'-123456789abc',
 published_at:'2026-11-24T03:00:00Z',draft:false,prerelease:false,
 assets:[{name:'Pitacco-Entregador-'+version+'.apk',size:2555555,digest:'sha256:'+sha,browser_download_url:url}]};

test('verifica versão do aplicativo e só recomenda versão superior',()=>{
 assert.equal(compareCourierVersions('2.0.16','2.0.15'),1);
 assert.equal(compareCourierVersions('2.0.15','2.0.16'),-1);
 assert.equal(compareCourierVersions('2.0.16','2.0.16'),0);
 assert.equal(compareCourierVersions('2.0.16-TESTE','2.0.15'),null);
});
test('só aceita APK lançado com versão e hash compatíveis',()=>{
 assert.equal(verifiedCourierApk({version,url,filename:'Pitacco-Entregador-2.0.16.apk',sha256:sha})?.url,url);
 assert.equal(verifiedCourierApk({version,url:url.replace('github.com','fake.invalid'),filename:'Pitacco-Entregador-2.0.16.apk',sha256:sha}),null);
 assert.equal(verifiedCourierApk({version:'2.0.17',url,filename:'Pitacco-Entregador-2.0.16.apk',sha256:sha}),null);
 assert.equal(verifiedCourierApk({version,url,filename:'outro.apk',sha256:sha}),null);
 assert.equal(verifiedCourierApk({version,url,filename:'Pitacco-Entregador-2.0.16.apk',sha256:'bad'}),null);
});
test('seleciona o APK estável mais recente, não rascunho ou pacote sem digest',()=>{
 const old={...latest,tag_name:'pitacco-entregador-v2.0.15-123456789abc',
  assets:[{...latest.assets[0],name:'Pitacco-Entregador-2.0.15.apk',
    browser_download_url:url.replaceAll('2.0.16','2.0.15')}],published_at:'2026-11-23T03:00:00Z'};
 assert.equal(latestOfficialCourierRelease([old,latest])?.version,'2.0.16');
 assert.equal(latestOfficialCourierRelease([{...latest,draft:true}]),null);
 assert.equal(latestOfficialCourierRelease([{...latest,assets:[{...latest.assets[0],digest:null}]}]),null);
});
test('usa catálogo Supabase se Github ficar temporariamente indisponível',async()=>{
 const item=await discoverCourierReleaseWithFallback(
  async()=>({ok:false,status:503}),async()=>({data:{version,url,
   filename:'Pitacco-Entregador-2.0.16.apk',sha256:sha},error:null})
 );
 assert.equal(item.version,'2.0.16');
});
test('interface oferece atualização na área de Ajustes e mantém confirmacão do Android',()=>{
 const ui=readFileSync(new URL('./painel.html',import.meta.url),'utf8');
 const handler=readFileSync(new URL('./app-update-ui.mjs',import.meta.url),'utf8');
 const native=readFileSync(new URL('./android-app/app/src/main/java/br/com/pitacco/entregador/CourierAppUpdater.java',import.meta.url),'utf8');
 const manifest=readFileSync(new URL('./android-app/app/src/main/AndroidManifest.xml',import.meta.url),'utf8');
 assert.match(ui,/id="checkCourierUpdate"/);
 assert.match(ui,/id="installCourierUpdate"/);
 assert.match(ui,/id="courierUpdateHint"/);
 assert.match(ui,/mountCourierUpdateUI/);
 assert.match(handler,/native\.postMessage\('install:'/);
 assert.match(native,/MessageDigest\.getInstance\("SHA-256"\)/);
 assert.match(native,/getPackageArchiveInfo/);
 assert.match(native,/FLAG_GRANT_READ_URI_PERMISSION/);
 assert.match(native,/canRequestPackageInstalls/);
 assert.match(manifest,/REQUEST_INSTALL_PACKAGES/);
 assert.match(manifest,/FileProvider/);
 assert.match(manifest,/courier_update_paths/);
});
