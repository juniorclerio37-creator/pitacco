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
 assert.match(preview,/renderReceiptCanvas\(/);
 assert.match(preview,/receiptFontSize/);
 const bridge=readFileSync(new URL('../printBridge.mjs',import.meta.url),'utf8');
 assert.match(bridge,/rasterReceipt\(job,job.width/);
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
  assert.match(text,/NAO COBRAR NA ENTREGA/);
 }
});

test('Windows navigation makes printing independently clickable and identifies installed version',()=>{
 const source=readFileSync(new URL('../src.jsx',import.meta.url),'utf8');
 const config=JSON.parse(readFileSync(new URL('../src-tauri/tauri.conf.json',import.meta.url),'utf8'));
 assert.ok(source.includes('Pitacco Windows v'+config.version));
 const nav=readFileSync(new URL('../MerchantNavigation.jsx',import.meta.url),'utf8');
 assert.match(nav,/Configurar impressão e visualizar nota/);
 assert.match(source,/onNavigate=\{target=>\{setTab\(target\)/);
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

test('Windows alerts use the fixed embedded natural voice, not robotic SAPI',()=>{
 const operations=readFileSync(new URL('../Operations.jsx',import.meta.url),'utf8');
 const rust=readFileSync(new URL('../src-tauri/src/main.rs',import.meta.url),'utf8');
 assert.match(operations,/invoke\('play_order_voice'/);
 assert.match(operations,/invoke\('order_voice_status'/);
 assert.match(operations,/invoke\('play_order_alert_combo'/);
 assert.match(operations,/Voz natural já incluída no Pitacco Windows/);
 assert.match(operations,/Nenhuma importação é necessária/);
 assert.match(operations,/invoke\('save_order_voice'/);
 assert.match(operations,/Volume da voz oficial/);
 assert.match(operations,/pitacco-audio-voice-volume/);
 assert.ok(operations.includes('return [1,2,3].includes(level)?level:3'));
 assert.ok(rust.includes('let selected=match level.unwrap_or(1)'));
 assert.match(rust,/if level!=1/);
 assert.match(operations,/Testar sino \+ voz/);
 assert.doesNotMatch(rust,/System\.Speech|SpeechSynthesizer|System\.Media\.Speech/);
 assert.match(rust,/fn play_order_voice/);
 assert.match(rust,/fn order_voice_status/);
 assert.match(rust,/play_order_alert_combo,save_order_voice,play_order_voice,order_voice_status,check_update/);
 assert.match(rust,/fn save_order_voice/);
 assert.match(rust,/pitacco_voice_payload/);
 assert.match(operations,/invoke\('play_order_bell'/);
});


test('merchant Windows order alert controls belong to settings, not the Pedidos screen',()=>{
 const operations=readFileSync(new URL('../Operations.jsx',import.meta.url),'utf8');
 const rust=readFileSync(new URL('../src-tauri/src/main.rs',import.meta.url),'utf8');
 assert.match(operations,/view==='Configurações'&&settingsTab==='Alertas e aplicativo'/);
 assert.doesNotMatch(operations,/\['Painel','Pedidos','Configurações','Alertas'\]/);
 assert.doesNotMatch(operations,/desktop\?<div className="dispatch-actions">/);
 assert.doesNotMatch(operations,/manager&&desktop&&view==='Pedidos'&&<div className="operational-overview"/);
 assert.match(operations,/manager&&view==='Pedidos'&&<Pedidos/);
 assert.match(operations,/Testar sino \+ voz/);
 assert.match(operations,/Ouvir sino/);
 assert.match(operations,/pitacco-audio-bell-volume/);
 assert.match(operations,/pitacco-audio-voice-volume/);
 assert.match(operations,/alertLevelRef\.current=alertLevel/);
 assert.match(operations,/voiceLevelRef\.current=voiceLevel/);
 assert.match(operations,/invoke\('play_order_alert_combo'/);
 assert.match(operations,/notify_new_order/);
 assert.match(rust,/fn play_order_alert_combo\(/);
 assert.match(rust,/std::thread::spawn\(move \|\|/);
 assert.match(rust,/PlaySoundA\(bell_wav\.as_ptr\(\)/);
 assert.match(rust,/PlaySoundA\(voice_wav\.as_ptr\(\)/);
 assert.match(rust,/play_order_alert_combo,save_order_voice/);
});

test('exactly one bundled merchant voice and five distinct native bells are selectable per store',()=>{
 const operations=readFileSync(new URL('../Operations.jsx',import.meta.url),'utf8');
 const rust=readFileSync(new URL('../src-tauri/src/main.rs',import.meta.url),'utf8');
 assert.match(operations,/pitacco:bell-choice:'\+storeId/);
 assert.match(operations,/pitacco:native-alert-volume:'\+storeId/);
 assert.match(operations,/pitacco:natural-voice-level:'\+storeId/);
 for(const [id,label] of [['original','Pitacco Original'],['moderno','Moderno'],['classico','Clássico'],['duplo','Duplo'],['intenso','Intenso']]){
  assert.ok(operations.includes('<option value="'+id+'">'+label+'</option>'),label);
 }
 assert.match(operations,/invoke\('play_order_bell'/);
 assert.match(operations,/invoke\('play_order_alert_combo'/);
 assert.match(rust,/fn merchant_bell_bytes/);
 assert.match(rust,/fn merchant_voice_bytes/);
 assert.match(rust,/fn play_order_alert_combo/);
 assert.match(rust,/fn play_order_bell/);
 for(const [sound] of [['moderno'],['classico'],['duplo'],['intenso']]){
  for(const level of [1,2,3]){
   assert.ok(rust.includes('include_bytes!("order-bell-'+sound+'-'+level+'.wav")'));
  }
 }
 for(const level of [1,2,3]){
  assert.ok(rust.includes('include_bytes!("order-merchant-voice-'+level+'.wav")'));
 }
 assert.match(operations,/Nenhuma importação é necessária/);
 assert.doesNotMatch(operations,/<input type="file" accept="\.wav/);
});

test('same installed Windows app keeps order cards and guarded conclusion next to progress actions',()=>{
 const orders=readFileSync(new URL('../Pedidos.jsx',import.meta.url),'utf8');
 const css=readFileSync(new URL('../pedidos.css',import.meta.url),'utf8');
 const mount=readFileSync(new URL('../../revisions/0.12/mount_orders_045.py',import.meta.url),'utf8');
 assert.match(mount,/popupLayout=\{desktop\}/);
 const details=readFileSync(new URL('../OrderDetails.jsx',import.meta.url),'utf8');
 assert.match(orders,/<OrderDetails /);
 assert.match(details,/pedidos-detail-modal/);
 assert.match(details,/pedidos-modal-close/);
 assert.match(orders,/Marcar pronto/);
 assert.match(orders,/Despachar/);
 assert.match(orders,/pedidos-complete-button/);
 assert.match(orders,/canConcludeOnWindows/);
 assert.match(orders,/canExecuteConclusion/);
 assert.match(orders,/onClick=\{\(\)=>onConclude\?\.\(o\.id\)\}/);
 assert.match(orders,/delivery\?\.logistics_provider==='loja'/);
 assert.match(css,/pedidos-card-actions/);
 assert.match(css,/pedidos-complete-button/);
 assert.doesNotMatch(orders,/applicationId\s*:/);
});


test('each merchant order card labels its platform with an offline icon',()=>{
 const orders=readFileSync(new URL('../Pedidos.jsx',import.meta.url),'utf8');
 const css=readFileSync(new URL('../pedidos.css',import.meta.url),'utf8');
 assert.match(orders,/function PlatformIcon\(\{source\}\)/);
 assert.match(orders,/<PlatformIcon source=\{o\.source\}\/>/);
 for(const platform of ['99food','ifood','keeta','loja']){
   assert.ok(orders.includes("'"+platform+"'"),platform);
   assert.ok(css.includes('data-platform="'+platform+'"'),platform);
 }
});

test('native Windows order alarm continues without visible or foreground WebView',()=>{
 const rust=readFileSync(new URL('../src-tauri/src/main.rs',import.meta.url),'utf8');
 const operations=readFileSync(new URL('../Operations.jsx',import.meta.url),'utf8');
 const cargo=readFileSync(new URL('../src-tauri/Cargo.toml',import.meta.url),'utf8');
 const migration=readFileSync(new URL('../../supabase/migrations/20261119001000_windows_native_background_watch.sql',import.meta.url),'utf8');
 assert.match(rust,/fn start_background_order_watch/);
 assert.match(rust,/fn stop_background_order_watch/);
 assert.match(rust,/PITACCO_BACKGROUND_WATCH/);
 assert.match(rust,/reqwest::blocking::Client/);
 assert.match(rust,/play_order_alert_combo\(Some\(cfg\.level\)/);
 assert.match(rust,/get_webview_window\("main"\)/);
 assert.match(rust,/fn notify_new_order/);
 assert.match(operations,/pitacco_windows_watch_start/);
 assert.match(operations,/pitacco_windows_watch_stop/);
 assert.match(operations,/invoke\('start_background_order_watch'/);
 assert.match(operations,/invoke\('stop_background_order_watch'/);
 assert.match(operations,/document\.hasFocus\(\)/);
 assert.match(cargo,/reqwest = /);
 assert.match(migration,/public\.is_store_manager\(p_store\)/);
 assert.match(migration,/extensions\.digest\(p_token,'sha256'\)/);
 assert.match(migration,/auth\.sessions/);
 assert.match(migration,/interval '18 hours'/);
 assert.doesNotMatch(rust,/SUPABASE_SERVICE_ROLE_KEY/);
});

test('Windows empty board has exactly its stage columns and never wraps into a second row',()=>{
 const orders=readFileSync(new URL('../Pedidos.jsx',import.meta.url),'utf8');
 const css=readFileSync(new URL('../pedidos.css',import.meta.url),'utf8');
 assert.match(orders,/const showWindowsBoard=filter==='all'/);
 assert.match(orders,/!showWindowsBoard&&filtered\.length===0&&<p className="pedidos-list-empty"/);
 assert.match(orders,/showWindowsBoard&&group\.items\.length===0/);
 assert.match(orders,/\['analysis','Em análise'\],\['preparing','Em preparo'\],\['ready','Pronto'\],\['delivery','Em entrega'\]/);
 assert.match(css,/grid-template-columns:repeat\(4,minmax\(190px,1fr\)\);grid-auto-flow:column/);
 assert.match(css,/grid-template-rows:minmax\(300px,auto\)/);
 assert.doesNotMatch(css,/pedidos-kanban\{grid-template-columns:repeat\(4,minmax\(250px/);
});

test('Windows exposes iFood cancellation after acceptance using the shared official integration',()=>{
 const orders=readFileSync(new URL('../Pedidos.jsx',import.meta.url),'utf8');
 const operations=readFileSync(new URL('../Operations.jsx',import.meta.url),'utf8');
 assert.match(orders,/o\.source==='ifood'&&\['preparing','ready','delivery'\]\.includes\(stage\(o\)\)/);
 assert.match(orders,/aria-label="Cancelar pedido no iFood"[^>]*onClick=\{\(\)=>void openIfoodReject\(o\)\}>Cancelar<\/button>/);
 assert.match(orders,/onGetIfoodReasons\(order\.id\)/);
 assert.match(operations,/ifood-manual-action'[,].*action:'reasons'/);
 assert.match(operations,/ifood-manual-action'[,].*action:'cancel'/);
 assert.match(orders,/Aguardando confirmação oficial/);
});

 test('own orders expose local cancellation on pickup and delivery regardless of channel',()=>{
 const orders=readFileSync(new URL('../Pedidos.jsx',import.meta.url),'utf8');
 assert.match(orders,/const canCancelOwnOrder=o=>o\?\.source==='proprio'/);
 assert.match(orders,/onClick=\{\(\)=>openOwnCancel\(o\)\}>Cancelar<\/button>/);
 assert.match(orders,/setDecision\(\{id:order\.id,status:'cancelled',reason:''\}\)/);
 assert.match(orders,/onDecision\(current\.id,decision\.status,decision\.reason\)/);
 assert.match(orders,/Nenhuma solicitação de cancelamento será enviada ao iFood/);
 });

 test('own pickup has Finalizar only when ready and cannot be dispatched',()=>{
 const orders=readFileSync(new URL('../Pedidos.jsx',import.meta.url),'utf8');
 assert.ok(orders.includes("const canAssign=(order,delivery)=>order.receipt?.logistics!=='retirada'"));
 assert.ok(orders.includes("o.receipt?.logistics!=='retirada'&&canConcludeOnWindows"));
 assert.ok(orders.includes('onClick={()=>onPickup?.(o.id)}>Finalizar</button>'));
 assert.ok(orders.includes('Disponível para retirada'));
 });

 test('web and Windows share compact board and dispatcher while routing remains web-only',()=>{
 const orders=readFileSync(new URL('../Pedidos.jsx',import.meta.url),'utf8');
 const mount=readFileSync(new URL('../../revisions/0.12/mount_orders_045.py',import.meta.url),'utf8');
 assert.ok(orders.includes('pitacco-pedidos windows-cards-only'));
 assert.ok(orders.includes('pedidos-compact-content'));
 assert.ok(orders.includes("!popupLayout&&client&&storeId&&layout==='routes'"));
 assert.match(mount,/onAssign=\{o=>\{setDispatchOnly\(true\);setDetail\(o\)\}\}/);
 });

 test('compact web and Windows expose completed, cancelled and rejected history separately',()=>{
 const orders=readFileSync(new URL('../Pedidos.jsx',import.meta.url),'utf8');
 assert.ok(orders.includes("['completed','Concluído'],['cancelled','Cancelados'],['rejected','Recusados']"));
 assert.ok(orders.includes("key==='completed'?'Concluídos':label"));
 assert.ok(orders.includes("filter==='all'?(!terminal.has(stage(o))||(!popupLayout&&['completed','cancelled'].includes(stage(o)))):stage(o)===filter"));
 assert.ok(orders.includes('data-order-filter={key}'));
 assert.doesNotMatch(orders,/popupLayout\?stages\.filter/);
 });

 test('web order toolbar removes duplicate stage controls while keeping history and native controls',()=>{
 const orders=readFileSync(new URL('../Pedidos.jsx',import.meta.url),'utf8');
 const css=readFileSync(new URL('../pedidos.css',import.meta.url),'utf8');
 assert.ok(orders.includes("const visibleStages=stages.filter(([key])=>popupLayout||['completed','cancelled','rejected','scheduled'].includes(key))"));
 assert.ok(orders.includes("popupLayout?'Em andamento':'Pedidos'"));
 assert.ok(orders.includes('visibleStages.map'));
 assert.ok(css.includes('.pitacco-pedidos.web-compact-orders .pedidos-kpis{display:none!important}'));
 });

 test('web board includes completed and cancelled columns without changing native active board',()=>{
 const orders=readFileSync(new URL('../Pedidos.jsx',import.meta.url),'utf8');
 const css=readFileSync(new URL('../pedidos.css',import.meta.url),'utf8');
 assert.ok(orders.includes("historyBoardStages=popupLayout?[]:[['completed','Concluídos'],['cancelled','Cancelados']]"));
 assert.ok(orders.includes("...boardStages,...historyBoardStages"));
 assert.ok(orders.includes("!popupLayout&&['completed','cancelled'].includes(stage(o))"));
 assert.ok(orders.includes("o.status==='accepted'&&!terminal.has(stage(o))"));
 assert.ok(css.includes('grid-template-columns:repeat(6,minmax(190px,1fr))'));
 });
