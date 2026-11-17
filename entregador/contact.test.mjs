import test from 'node:test';
import assert from 'node:assert/strict';
import {resolveCustomerContact} from './contact.mjs';

test('real Brazilian phone opens WhatsApp with country code',()=>{
 const a=resolveCustomerContact({kind:'real',number:'(21) 98888-1234'});
 assert.equal(a.type,'real');
 assert.equal(a.href,'https://wa.me/5521988881234');
 assert.equal(a.localizer,null);
 const b=resolveCustomerContact({kind:'real',number:'+55 (21) 98888-1234'});
 assert.equal(b.href,a.href);
});
test('iFood intermediary 0800 calls phone and shows localizer, never WhatsApp',()=>{
 const result=resolveCustomerContact({kind:'intermediary',number:'0800 705 3040',localizer:'75159000'});
 assert.equal(result.type,'intermediary');
 assert.equal(result.href,'tel:08007053040');
 assert.equal(result.localizer,'75159000');
 assert.equal(result.href.includes('wa.me'),false);
});
test('0800 classified as intermediary even when labeled as real',()=>{
 const result=resolveCustomerContact({kind:'real',number:'0800 705 3040'});
 assert.equal(result.type,'intermediary');
 assert.ok(result.href.startsWith('tel:'));
});
test('missing, invalid, or masked contacts have no WhatsApp action',()=>{
 for(const data of [null,{}, {kind:'none',number:null},
   {kind:'unknown',number:'****1234'},{kind:'real',number:'12345'},
   {kind:'intermediary',number:'4004'}]){
  const result=resolveCustomerContact(data);
  assert.equal(result.href,null);
 }
});
test('expired marketplace contact is unavailable to call',()=>{
 const result=resolveCustomerContact({kind:'intermediary',number:'0800 705 3040',
   localizer:'75159000',expires_at:'2026-11-15T18:00:00Z'},Date.parse('2026-11-17T00:00:00Z'));
 assert.equal(result.type,'expired');
 assert.equal(result.href,null);
 assert.equal(result.localizer,null);
});
test('direct real number provided by a marketplace remains WhatsApp eligible',()=>{
 const result=resolveCustomerContact({kind:'real',number:'21988881234',localizer:null});
 assert.equal(result.type,'real');
 assert.equal(result.href,'https://wa.me/5521988881234');
});
