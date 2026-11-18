import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {approvedReceipt} from '../approvedReceipt.mjs';

test('Windows keeps every merchant menu and never redirects to Pedidos',()=>{
 const source=readFileSync(new URL('../src.jsx',import.meta.url),'utf8');
 assert.doesNotMatch(source,/desktopOperationalTabs/);
 assert.doesNotMatch(source,/!nativeAvailable\(\)\|\|\['Visão Geral','Pedidos','Motoboys'/);
 for(const menu of ['Visão Geral','Pedidos','Motoboys','Meu Cardápio','Estoque','Integrações','Fideliza+','Clientes','Administrar Loja','Financeiro','Relatórios','Caixa']){
   assert.ok(source.includes("'"+menu+"'"),menu);
 }
 for(const target of ["tab==='Alertas'","tab==='Relatórios'","tab==='Estoque'","tab==='Minha Loja'","tab==='Horário de funcionamento'","tab==='Aparência do cardápio'"]){
   assert.ok(source.includes(target),'screen target absent: '+target);
 }
});

test('native print preview uses actual thermal receipt renderer',()=>{
 const operations=readFileSync(new URL('../Operations.jsx',import.meta.url),'utf8');
 assert.match(operations,/WindowsReceiptPreview/);
 const preview=readFileSync(new URL('../WindowsReceiptPreview.jsx',import.meta.url),'utf8');
 assert.match(preview,/approvedReceipt\(/);
 assert.match(preview,/savePrintPreference/);
 assert.match(preview,/58 mm/);
 assert.match(preview,/80 mm/);
});

test('iFood object modifiers render by name and quantity on 80mm and 58mm notes',()=>{
 const receipt={store_name:'Açaí do Linho',display_number:'3497',
  customer_name:'Cliente Teste',phone:'(21) 90000-0000',address:'Rua Teste, 100',
  payment_status:'paid',payment_method:'Cartão',total:27,notes:'Campainha',
  items:[{name:'Açaí combo',quantity:1,modifiers:[
   {name:'Leite em pó',quantity:2},{name:'Nutella',quantity:1}],notes:'Sem gelo'}]};
 for(const width of [58,80]){
  const text=approvedReceipt({receipt},width,{phone:false,address:false,notes:false,complements:true});
  assert.match(text,/2x Leite em pó/);
  assert.match(text,/1x Nutella/);
  assert.doesNotMatch(text,/\[object Object\]/);
  assert.doesNotMatch(text,/Rua Teste/);
  assert.doesNotMatch(text,/Campainha/);
  assert.match(text,/PAGO - NAO COBRAR/);
 }
});

test('Windows navigation makes printing independently clickable and identifies installed version',()=>{
 const source=readFileSync(new URL('../src.jsx',import.meta.url),'utf8');
 assert.match(source,/Pitacco Windows v0\.12\.8/);
 assert.match(source,/aria-label="Configurar impressão e visualizar nota"/);
 assert.match(source,/onClick=\{\(\)=>\{setTab\('Configurações'\)/);
 assert.match(source,/tab==='Aplicativos e Downloads'&&<AppDownloads/);
 assert.match(source,/Pagamento de motoboys/);
 assert.match(source,/hiddenOnError=\{false\}/);
});

test('one-store exception roster is referenced by all merchant dispatch screens',()=>{
 const operations=readFileSync(new URL('../Operations.jsx',import.meta.url),'utf8');
 const hub=readFileSync(new URL('../LogisticsHub.jsx',import.meta.url),'utf8');
 const dialog=readFileSync(new URL('../DeliveryDialog.jsx',import.meta.url),'utf8');
 const workspace=readFileSync(new URL('../CourierWorkspace.jsx',import.meta.url),'utf8');
 assert.match(operations,/client\.rpc\('pitacco_store_couriers',\{p_store:storeId\}\)/);
 assert.match(dialog,/client\.rpc\('pitacco_store_couriers',\{p_store:storeId\}\)/);
 assert.match(hub,/client\.rpc\('pitacco_store_couriers',\{p_store:store\.id\}\)/);
 assert.match(workspace,/client\.rpc\('pitacco_store_couriers',\{p_store:store\.id\}\)/);
});

test('Windows gives truthful feedback after queueing a reprint, not paper confirmation',()=>{
 const source=readFileSync(new URL('../Operations.jsx',import.meta.url),'utf8');
 assert.match(source,/reprintRequests\.current\.delete\(key\);setPrintRequestFeedback\(/);
 assert.match(source,/printRequestFeedback&&<p role="status"/);
 assert.match(source,/O envio não confirma impressão física/);
 assert.match(source,/rpc\('reprint_order'/);
 assert.match(source,/rpc\('claim_print_jobs'/);
 assert.match(source,/ingestJobs\(/);
});

test('Windows alerts use an imported natural audio file, not robotic SAPI',()=>{
 const operations=readFileSync(new URL('../Operations.jsx',import.meta.url),'utf8');
 const rust=readFileSync(new URL('../src-tauri/src/main.rs',import.meta.url),'utf8');
 assert.match(operations,/invoke\('play_order_voice'/);
 assert.match(operations,/invoke\('order_voice_status'/);
 assert.match(operations,/invoke\('play_order_alert_combo'/);
 assert.match(operations,/Voz natural ainda não configurada neste computador/);
 assert.match(operations,/O sino continuará funcionando, sem voz robótica/);
 assert.match(operations,/invoke\('save_order_voice'/);
 assert.match(operations,/Volume da voz natural/);
 assert.ok(operations.includes('Normal (áudio original, sem amplificação)'));
 assert.ok(operations.includes('return [1,2,3].includes(level)?level:3'));
 assert.ok(rust.includes('let selected=match level.unwrap_or(1)'));
 assert.match(rust,/if level!=1/);
 assert.match(operations,/Testar somente voz/);
 assert.doesNotMatch(rust,/System\.Speech|SpeechSynthesizer|System\.Media\.Speech/);
 assert.match(rust,/fn play_order_voice/);
 assert.match(rust,/fn order_voice_status/);
 assert.match(rust,/play_order_alert_combo,save_order_voice,play_order_voice,order_voice_status,check_update/);
 assert.match(rust,/fn save_order_voice/);
 assert.match(rust,/pitacco_voice_payload/);
 assert.match(operations,/invoke\('play_order_alert'/);
});


test('merchant Windows order alerts provide bell and voice volume in each settings screen',()=>{
 const operations=readFileSync(new URL('../Operations.jsx',import.meta.url),'utf8');
 const rust=readFileSync(new URL('../src-tauri/src/main.rs',import.meta.url),'utf8');
 assert.match(operations,/\['Painel','Pedidos','Configurações','Alertas'\]/);
 assert.match(operations,/Testar sino e voz/);
 assert.match(operations,/Testar somente sino/);
 assert.match(operations,/pitacco-native-order-volume/);
 assert.match(operations,/pitacco-natural-voice-level/);
 assert.match(operations,/alertLevelRef\.current=alertLevel/);
 assert.match(operations,/voiceLevelRef\.current=voiceLevel/);
 assert.match(operations,/invoke\('play_order_alert_combo'/);
 assert.match(operations,/notify_new_order/);
 assert.match(rust,/fn play_order_alert_combo\(/);
 assert.match(rust,/std::thread::spawn\(move \|\|/);
 assert.match(rust,/PlaySoundA\(bell\.as_ptr\(\)/);
 assert.match(rust,/PlaySoundW\(path\.as_ptr\(\)/);
 assert.match(rust,/play_order_alert_combo,save_order_voice/);
});
