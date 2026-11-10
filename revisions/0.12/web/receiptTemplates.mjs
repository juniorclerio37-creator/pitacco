export {CUPOM_80MM_HTML} from './cupom80mm.mjs';
// Original, script-free receipt templates. Render with a sanitized thermal renderer.
export const RECEIPT_TEMPLATES=Object.freeze({
 simples: '<h2>{{loja}}</h2><p>Pedido {{pedido}}</p><p>{{itens}}</p><hr><strong>Total: {{total}}</strong>',
 completo: '<h2>{{loja}}</h2><p>{{contato}}</p><p>Pedido: {{pedido}} · {{origem}}</p><p>Cliente: {{cliente}}</p><p>{{endereco}}</p><hr><p>{{itens}}</p><p>{{observacoes}}</p><hr><p>Subtotal: {{subtotal}}</p><p>Desconto: {{desconto}}</p><p>Entrega: {{entrega}}</p><strong>Total: {{total}}</strong><p>{{pagamento}}</p>',
 cozinha: '<h2>COZINHA</h2><strong>Pedido {{pedido}}</strong><hr><p>{{itens}}</p><hr><p>OBS: {{observacoes}}</p>',
 expedicao: '<h2>EXPEDIÇÃO</h2><p>Pedido {{pedido}}</p><p>{{cliente}}</p><p>{{endereco}}</p><hr><p>{{itens}}</p><p>{{entregador}}</p>',
 entregador: '<h2>ENTREGA</h2><p>Pedido {{pedido}}</p><p>{{cliente}}</p><p>{{endereco}}</p><p>Referência: {{referencia}}</p><hr><p>{{pagamento}}</p><strong>Total: {{total}}</strong>'
});
export function validateReceiptTemplate(html){
 if(typeof html!=='string'||!html.trim()||html.length>32768)throw Error('Modelo inválido: máximo 32768 caracteres');
 if(/<\s*(script|iframe|object|embed|link|meta|img|svg|audio|video|form|base)\b|\bon\w+\s*=|(?:src|href)\s*=|@import|url\s*\(/i.test(html))throw Error('HTML contém recursos externos ou código não permitido');
 return html;
}
