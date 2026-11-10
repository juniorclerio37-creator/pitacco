// Layout 80 mm supplied by the store owner. Template only: not a raster printer driver.
// Sections ({{#ITEMS}} etc.) must be expanded by a dedicated safe renderer before printing.
export const CUPOM_80MM_HTML = String.raw`
<style>
@page { size:80mm auto; margin:0; }
* { box-sizing:border-box; -webkit-print-color-adjust:exact!important; print-color-adjust:exact!important; }
html,body { margin:0!important; padding:0!important; width:100%!important; background:#fff!important; color:#000!important; }
.cupom { width:100%; margin:0; padding:2mm 3mm; font-family:Arial,Helvetica,sans-serif; font-size:14px; line-height:1.38; font-weight:500; color:#000!important; -webkit-font-smoothing:none; text-rendering:optimizeLegibility; }
.center,.titulo,.secao { text-align:center; }
.titulo,.secao { font-size:14.5px; font-weight:500; }
.separador { width:100%; border-top:1.5px dashed #000; margin:5px 0; height:0; }
.pedido-numero { text-align:center; font-size:24px; font-weight:800; margin:8px 0; padding:5px 2px; border:2px solid #000; border-radius:5px; }
.cliente-pedido { text-align:left; font-size:17px; font-weight:750; margin:8px 0; overflow-wrap:anywhere; }
.linha { display:flex; width:100%; justify-content:space-between; align-items:flex-start; font-weight:500; color:#000!important; }
.descricao { flex:1; min-width:0; padding-right:6px; overflow-wrap:break-word; word-wrap:break-word; }
.valor { flex:0 0 auto; min-width:70px; text-align:right; white-space:nowrap; }
.item-principal { margin-top:9px; margin-bottom:4px; }
.item-principal,.item-principal .descricao,.item-principal .valor { font-weight:700!important; font-size:15px; }
.complemento { padding-left:12px; font-size:14px; line-height:1.4; font-weight:500!important; }
.complemento .descricao,.complemento .valor { font-size:14px; font-weight:500!important; }
.obs { margin-top:3px; padding-left:10px; font-size:14px; font-weight:500; }
.espaco { height:8px; }
.pagamento-status { border:2px solid #000; border-radius:5px; padding:7px 4px; text-align:center; font-weight:800; font-size:17px; margin:8px 0; }
.troco { font-size:15px; font-weight:700; margin:6px 0; }
.rodape { text-align:center; font-size:12px; margin:10px 0 3px; }
.pequeno { font-size:12.5px; }
.cupom div,.cupom span { color:#000!important; }
@media print {
 html,body { width:80mm!important; margin:0!important; padding:0!important; background:#fff!important; color:#000!important; }
 .cupom { width:80mm!important; max-width:80mm!important; margin:0!important; padding:2mm 3mm!important; font-family:Arial,Helvetica,sans-serif!important; font-size:14.5px!important; line-height:1.22!important; font-weight:500!important; color:#000!important; -webkit-print-color-adjust:exact!important; print-color-adjust:exact!important; -webkit-font-smoothing:none!important; }
}
</style>
<div class="cupom">
{{COMPANY_HEADER}}
<div class="separador"></div>
<div class="titulo">CUPOM NÃO FISCAL</div>
<div class="separador"></div>
<div class="center">{{ORIGIN}}</div>
<div class="separador"></div>
<div class="secao">PEDIDO</div>
<div class="pedido-numero">**** Nº {{ORDER_ID}} ****</div>
<div class="cliente-pedido">Cliente: {{CUSTOMER_NAME}}</div>
<div class="espaco"></div>
<div class="linha"><div>Criado em:</div><div>{{DATE}}</div></div>
<div class="separador"></div>
<div class="secao">PRODUTOS</div>
<div class="espaco"></div>
{{#ITEMS}}
<div class="linha item-principal"><div class="descricao">{{ITEM_QTY}} {{ITEM_NAME}}</div><div class="valor">{{ITEM_PRICE}}</div></div>
{{#SIZES}}
<div class="linha complemento"><div class="descricao">{{SIZE_NAME}}</div></div>
{{/SIZES}}
{{#OPTIONS}}
<div class="linha complemento"><div class="descricao">{{OPT_QTY}} {{OPT_NAME}}</div><div class="valor">{{OPT_PRICE}}</div></div>
{{/OPTIONS}}
{{#ADDITIONAL_GROUPS}}
{{#ADD_ITEMS}}
<div class="linha complemento"><div class="descricao">{{ADD_QTY}} {{ADD_NAME}}</div><div class="valor">{{ADD_PRICE}}</div></div>
{{/ADD_ITEMS}}
{{/ADDITIONAL_GROUPS}}
{{#NOTES}}
<div class="obs">Obs: {{ITEM_NOTE}}</div>
{{/NOTES}}
{{/ITEMS}}
<div class="separador"></div>
<div class="secao">PAGAMENTO</div>
<div class="espaco"></div>
{{VALUES_HTML}}
<div class="espaco"></div>
<div class="linha"><div>Forma de pagamento:</div><div>{{PAYMENT_MSG}}</div></div>
{{PAYMENT_STATUS_HTML}}
{{CHANGE_HTML}}
<div class="separador"></div>
<div class="secao">INFORMAÇÕES DE ENTREGA</div>
<div class="espaco"></div>
{{DELIVERY_ADDRESS}}
<div class="separador"></div>
<div class="rodape">Impresso por Pitacco Gestão de Delivery</div>
</div>
`;
