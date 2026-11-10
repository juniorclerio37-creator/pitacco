export {CUPOM_80MM_HTML} from './cupom80mm.mjs';
// Original, script-free receipt templates. Render with a sanitized thermal renderer.
export function validateReceiptTemplate(html){
 if(typeof html!=='string'||!html.trim()||html.length>32768)throw Error('Modelo inválido: máximo 32768 caracteres');
 if(/<\s*(script|iframe|object|embed|link|meta|img|svg|audio|video|form|base)\b|\bon\w+\s*=|(?:src|href)\s*=|@import|url\s*\(/i.test(html))throw Error('HTML contém recursos externos ou código não permitido');
 return html;
}
