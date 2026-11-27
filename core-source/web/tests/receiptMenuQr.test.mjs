import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {receiptQrMatrix,receiptMenuUrl,loadReceiptMenuUrl,receiptMenuMessage,DEFAULT_MENU_MESSAGE} from '../receiptMenuQr.mjs';
test('QR matches independent Model 2 version 5 M mask 0 reference',()=>{
 const m=receiptQrMatrix('https://pitacco.com.br/loja-teste');
 assert.equal(m.length,37);assert.ok(m.every(row=>row.length===37));
 const s=m.flat().map(Number).join('');
 assert.equal(createHash('sha256').update(s).digest('hex'),'599e3ffd0937addc3a91a840f5fd34725be0d8127c325369d4b7fbea9e0afa4c');
 assert.equal(receiptQrMatrix('https://pitacco.com.br/'+'a'.repeat(60)).length,37);
 assert.throws(()=>receiptQrMatrix('https://other.example/test'));
});
test('only the authenticated store published menu, no QR if unavailable',async()=>{
 assert.equal(receiptMenuUrl({enabled:false,slug:'loja-teste'}),'');
 assert.equal(receiptMenuUrl({enabled:true,slug:'loja-teste'}),'https://pitacco.com.br/loja-teste');
 const c={rpc:async(fn,args)=>{assert.equal(fn,'pitacco_storefront_link');assert.equal(args.p_store,'store-a');return {data:{enabled:true,slug:'loja-teste'}}}};
 assert.equal(await loadReceiptMenuUrl(c,'store-a'),'https://pitacco.com.br/loja-teste');
 assert.equal(await loadReceiptMenuUrl({rpc:async()=>{throw Error('offline')}},'store-a'),'');
});

test('custom incentive is optional, bounded and strips control characters',()=>{assert.equal(receiptMenuMessage('  '),DEFAULT_MENU_MESSAGE);assert.equal(receiptMenuMessage('Peça direto!\nObrigado.'),'Peça direto! Obrigado.');assert.equal(receiptMenuMessage('a'.repeat(180)).length,160)});
