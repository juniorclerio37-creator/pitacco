import {rasterReceipt} from './receiptArtwork.mjs';
import {readPrintPreferences} from './printPreferences.mjs';
import {loadReceiptLogo} from './receiptBranding.mjs';
import {loadReceiptMenuUrl} from './receiptMenuQr.mjs';
const sample={source:'99food',external_order_number:'542012',customer_name:'Cliente de exemplo',phone:'(21) 90000-0000',localizer:'123456',address:'Rua de Exemplo, 100 – Centro',reference:'Portão branco',notes:'Pedido fictício para conferir a apresentação da comanda.',subtotal:19.95,delivery_fee:5.99,service_fee:1.10,discount:5.99,total:21.05,payment_method:'Dinheiro',payment_on_delivery:true,change_for:30,items:[{name:'Açaí Tradicional 770ml – Monte o Seu',quantity:1,total:19.95,modifiers:[{name:'Batido com maracujá',quantity:1},{name:'Leite em pó',quantity:2},{name:'Granola',quantity:1},{name:'Nutella',quantity:1}]}]};
export function receiptTestJob(source='99food',date=new Date()){
 const origin=['99food','ifood','proprio','keeta'].includes(source)?source:'99food';
 return {order_id:'TESTE-542012',test:true,receipt:{...sample,source:origin,created_at:date.toISOString(),display_number:'542012'}};
}
// No order, stock, payment or delivery is created: generate a local raster only.
export async function buildPhysicalReceiptTest({client,storeId,storeName,storeLogoPath,width}){
 const preferences=readPrintPreferences(storeId);
 const [menuUrl,logoImage]=await Promise.all([preferences.menuQr===true?loadReceiptMenuUrl(client,storeId):'',preferences.printLogo===true?loadReceiptLogo(client,storeId,storeLogoPath):null]);
 const receipt=rasterReceipt(receiptTestJob(preferences.previewSource),width,{...preferences,storeName,menuUrl,logoImage});
 const warnings=[];
 if(preferences.printLogo===true&&!logoImage)warnings.push('Logotipo indisponível no momento do teste.');
 if(preferences.menuQr===true&&!menuUrl)warnings.push('QR Code indisponível: confira se o cardápio está publicado.');
 return {receipt,warnings};
}
