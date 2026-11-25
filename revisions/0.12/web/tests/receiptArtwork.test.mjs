import {receiptTestJob} from '../receiptTestSample.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {receiptPayment,receiptFontSize,renderReceiptCanvas,rasterReceipt} from '../receiptArtwork.mjs';
const receipt={source:'99food',external_order_number:'542012',store_name:'Loja Teste',customer_name:'Cliente fictício',total:21.05,payment_method:'Dinheiro',change_for:30,items:[{name:'Produto comprido com descrição que precisa quebrar sem cortar o valor',quantity:1,total:19.95,modifiers:[{name:'Complemento muito longo',quantity:2}]}]};
test('three real amounts, integer cents and legacy cash',()=>{assert.deepEqual(receiptPayment(receipt),{state:'collect',method:'Dinheiro',total:2105,due:2105,given:3000,change:895,invalidChange:false});assert.equal(receiptPayment({...receipt,change_for:undefined,notes:'Troco para: R$ 30'}).change,895);assert.equal(receiptPayment({...receipt,change_for:10}).invalidChange,true)});
test('paid or fiado never requests collection',()=>{assert.equal(receiptPayment({...receipt,payment_confirmed:true}).state,'paid');assert.equal(receiptPayment({...receipt,payment_method:'fiado'}).state,'no_collect');assert.equal(receiptPayment({...receipt,payment_method:'Pix'}).state,'unknown')});
function fake(){const log=[];const ctx={font:'',measureText(s){return {width:s.length*Number(this.font.match(/\d+px/)?.[0].slice(0,-2)||25)*.53}},fillText(s,x,y){log.push({s,x,y,font:this.font,align:this.textAlign})},fillRect(){},beginPath(){},roundRect(){},fill(){},stroke(){},save(){},translate(){},scale(){},arc(){},moveTo(){},lineTo(){},quadraticCurveTo(){},bezierCurveTo(){},closePath(){},restore(){},getImageData(x,y,w,h){return {data:new Uint8ClampedArray(w*h*4).fill(255)}}};return {width:0,height:0,log,getContext:()=>ctx}}
test('58 and 80mm, all sizes, wrapping and payment details',()=>{for(const width of [58,80]){const sizes=['small','medium','large'].map(fontSize=>renderReceiptCanvas({receipt},width,{fontSize},fake));assert.equal(sizes[0].width,width===58?384:576);assert.ok(sizes[2].height>sizes[1].height&&sizes[1].height>sizes[0].height);for(const s of sizes){const text=s.log.map(x=>x.s).join(' ');assert.match(text,/542012/);assert.match(text,/21,05/);assert.match(text,/30,00/);assert.match(text,/8,95/);assert.ok(s.log.every(x=>x.x>=0&&x.x<=s.width));}assert.match(rasterReceipt({receipt},width,{fontSize:'small'},fake),/^PITACCO_RASTER_V1:/)}assert.equal(receiptFontSize('invalid'),'medium')});

test('platform identification is optional without hiding the real platform and order number',()=>{
 for(const [source,label] of [['99food','99Food'],['ifood','iFood'],['proprio','Loja'],['cardapio','Loja'],['balcao','Loja'],['keeta','Keeta']]){
  const job={receipt:{...receipt,source,display_number:'542012'}};
  const withIcon=renderReceiptCanvas(job,58,{platformIcon:true},fake);
  const noIcon=renderReceiptCanvas(job,58,{platformIcon:false},fake);
  for(const image of [withIcon,noIcon]){const text=image.log.map(x=>x.s).join(' ');assert.ok(text.includes(label));assert.ok(text.includes('542012'));}
 }
});

test('menu QR stays scannable without printing its URL on 58 or 80mm paper',()=>{
 const menuUrl='https://pitacco.com.br/loja-teste';
 for(const width of [58,80]){
  let dots=0;
  const canvas=renderReceiptCanvas({receipt},width,{menuQr:true,menuUrl},()=>{const c=fake(),ctx=c.getContext('2d');ctx.fillRect=(x,y,w,h)=>{if(w===6&&h===6)dots++};return c});
  const printed=canvas.log.map(x=>x.s).join(' ');
  assert.ok(dots>100,'QR modules must still be drawn');
  assert.match(printed,/PEÇA PELO NOSSO CARDÁPIO/);
  assert.doesNotMatch(printed,/https:\/\/|pitacco\.com\.br|loja-teste/i);
  const without=renderReceiptCanvas({receipt},width,{menuQr:false,menuUrl},fake);
  assert.ok(canvas.height>without.height);
 }
});

test('physical sample uses real receipt artwork, unmistakable test marker and saved presentation settings',()=>{
 for(const width of [58,80]){
  const job=receiptTestJob('proprio',new Date('2026-11-25T12:00:00Z'));
  const canvas=renderReceiptCanvas(job,width,{storeName:'Minha Loja',menuQr:true,menuUrl:'https://pitacco.com.br/loja-teste',fontSize:'small'},fake);
  const text=canvas.log.map(x=>x.s).join(' ');
  assert.match(text,/TESTE DE IMPRESSÃO/);assert.match(text,/SEM VALIDADE/);assert.match(text,/MINHA LOJA/);assert.match(text,/542012/);assert.match(text,/TROCO/);assert.match(text,/PEÇA PELO NOSSO CARDÁPIO/);assert.doesNotMatch(text,/https:\/\//);
 }
});
