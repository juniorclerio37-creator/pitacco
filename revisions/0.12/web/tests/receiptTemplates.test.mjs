import test from 'node:test';
import assert from 'node:assert/strict';
import {RECEIPT_TEMPLATES,validateReceiptTemplate} from '../receiptTemplates.mjs';

test('five default receipt templates are available',()=>{
 assert.deepEqual(Object.keys(RECEIPT_TEMPLATES).sort(),['completo','cozinha','entregador','expedicao','simples'].sort());
 for(const html of Object.values(RECEIPT_TEMPLATES)){
  assert.ok(html.includes('{{pedido}}'));
  assert.equal(validateReceiptTemplate(html),html);
 }
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
