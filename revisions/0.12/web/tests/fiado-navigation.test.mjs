import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {featureForTab} from '../storeFeatures.mjs';
test('Fiado has an accessible manager-only navigation item in the restored app',()=>{
 const app=readFileSync(new URL('../src.jsx',import.meta.url),'utf8');
 assert.match(app,/\['Fiado \/ Caderneta',Wallet,'Principal'\]/);
 assert.match(app,/name!=='Fiado \/ Caderneta'\|\|manager&&!!active/);
 assert.match(app,/active&&!isDriver&&manager&&tab==='Fiado \/ Caderneta'&&<FiadoCaderneta/);
 assert.match(app,/merchantTabs=new Set\(\[.*[\s\S]*?nav\.map/);
 assert.equal(featureForTab('Fiado / Caderneta'),'financeiro');
});
