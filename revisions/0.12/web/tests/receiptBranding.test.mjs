import test from 'node:test';
import assert from 'node:assert/strict';
import {validReceiptLogoPath,receiptLogoDimensions,receiptLogoSize,receiptPlatformMark,monochromeLogo} from '../receiptBranding.mjs';
test('registered logo is restricted to the current store and image formats',()=>{
 const id='f5d13242-3e76-4f43-8e9b-a70b5f87d92d';
 assert.equal(validReceiptLogoPath(id,'stores/'+id+'/abc.png'),true);
 assert.equal(validReceiptLogoPath(id,'stores/00000000-0000-0000-0000-000000000000/abc.png'),false);
 assert.equal(validReceiptLogoPath(id,'stores/'+id+'/../abc.png'),false);
 assert.equal(validReceiptLogoPath(id,'https://example.org/logo.png'),false);
});
test('three independent logo sizes fit both papers without distortion',()=>{
 for(const w of [58,80]){
  const d=['small','medium','large'].map(s=>receiptLogoDimensions(400,200,w,s));
  assert.ok(d[0].width<d[1].width&&d[1].width<d[2].width);
  for(const v of d){assert.ok(v.width<(w===58?384:576));assert.ok(Math.abs(v.width/v.height-2)<.05);}
 }
 assert.equal(receiptLogoSize('bad'),'medium');
});
test('monochrome conversion creates only black and white pixels',()=>{
 let result;const data=new Uint8ClampedArray([10,20,30,255,255,255,255,255,130,140,150,255,240,240,240,255]);
 const c={getContext:()=>({fillRect(){},drawImage(){},getImageData:()=>({data}),putImageData:p=>result=p})};
 assert.equal(monochromeLogo({}, {width:2,height:2},()=>c),c);
 assert.ok(result.data.every(v=>v===0||v===255));
});
test('known platforms receive distinct locally rendered marks',()=>{
 assert.deepEqual(['iFood','99Food','Keeta','Loja','Other'].map(receiptPlatformMark),['ifood','99food','keeta','store','other']);
});
