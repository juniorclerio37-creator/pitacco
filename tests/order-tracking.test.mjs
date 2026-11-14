import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const html=readFileSync(new URL('../marketing/acompanhar.html',import.meta.url),'utf8');
test('tracking token requires canonical UUID format',()=>{
 assert.match(html,/\^\[0-9a-f\]\{8\}-\[0-9a-f\]\{4\}/);
 assert.match(html,/Link de acompanhamento inválido/);
});
test('rejected and cancelled orders do not show progress timeline',()=>{
 assert.match(html,/rejected=\['rejected','recusado','recusada'\]/);
 assert.match(html,/if\(!cancelled\)\{for\(let i=0;i<labels\.length/);
 assert.match(html,/Pedido recusado/);
 assert.match(html,/Pedido cancelado/);
});
test('pickup completed only after explicit collection',()=>{
 assert.match(html,/const collected=\[/);
 assert.match(html,/current=collected\?4:/);
});
test('tracking refresh avoids overlapping requests and has a timer',()=>{
 assert.match(html,/if\(working\)return;working=true/);
 assert.match(html,/finally\{working=false\}/);
 assert.match(html,/setInterval\(refresh,15000\)/);
});
test('notification feature is guarded by browser support',()=>{
 assert.match(html,/'Notification'in window/);
 assert.match(html,/'serviceWorker'in navigator/);
});
