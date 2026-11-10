import test from 'node:test';
import assert from 'node:assert/strict';
import {validateReceiptTemplate} from '../receiptTemplates.mjs';
import {CUPOM_80MM_HTML} from '../cupom80mm.mjs';

test('only the supplied standard 80mm receipt is offered',()=>{
 assert.ok(CUPOM_80MM_HTML.includes('CUPOM NÃO FISCAL'));
 assert.ok(CUPOM_80MM_HTML.includes('{{#ITEMS}}'));
 assert.ok(CUPOM_80MM_HTML.includes('Pitacco Delivery App'));
 assert.equal(validateReceiptTemplate(CUPOM_80MM_HTML),CUPOM_80MM_HTML);
});
test('unsafe HTML is rejected',()=>{
 for(const bad of ['<script>alert(1)</script>','<img src="https://example.org/a">','<p onclick="run()">x</p>','<style>@import "https://x"</style>','<a href="https://example.org">a</a>']){
  assert.throws(()=>validateReceiptTemplate(bad));
 }
});
test('template size limits',()=>{
 assert.throws(()=>validateReceiptTemplate(''));
 assert.throws(()=>validateReceiptTemplate('x'.repeat(32769)));
});
