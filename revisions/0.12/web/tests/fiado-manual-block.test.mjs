import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
test('Fiado can be manually blocked and unblocked independently of customer editing',()=>{
 const source=readFileSync(new URL('../FiadoCaderneta.jsx',import.meta.url),'utf8');
 assert.match(source,/Bloquear fiado/);assert.match(source,/Desbloquear fiado/);
 assert.match(source,/rpc\('pitacco_fiado_set_customer_enabled',\{p_store:storeId,p_customer:target.id,p_enabled:enabled\}\)/);
 assert.match(source,/if\(!selected\|\|!customer\?\.enabled\|\|!overview\?\.enabled/);
 assert.match(source,/rpc\('pitacco_fiado_receive'/);
 assert.match(source,/p_enabled:customer\?customer.enabled:form.enabled/);
});
