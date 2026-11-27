import React from 'react';
import './category-icons.css';

// Each icon has a stable key stored per store + category, not an emoji string.
// The pizza slice is intentionally SVG so it never depends on platform emoji.
export const CATEGORY_ICON_GROUPS=[
 {name:'Destaques e promoções',icons:[
  ['flame','Destaques'],['star','Novidades'],['discount','Promoções'],['crown','Mais pedidos'],['trophy','Top vendas'],['tag','Ofertas'],['megaphone','Lançamentos']]},
 {name:'Açaí e sorveteria',icons:[
  ['acai','Açaí'],['ice-cream-cone','Sorvete casquinha'],['ice-cream-cup','Sorvete copo'],['dessert','Sobremesas']]},
 {name:'Todos os tipos de combos',icons:[
  ['combo-burger','Hambúrguer + bebida'],['combo-pizza','Pizza + bebida'],['combo-acai','Açaí + bebida'],
  ['combo-ice-cream','Dois sorvetes diferentes'],['combo-meal','Marmita + bebida'],['combo-mixed','Outros combos']]},
 {name:'Pizzaria',icons:[
  ['pizza-slice','Fatia de pizza'],['pizza-whole','Pizza inteira'],['pizza-sweet','Pizza doce']]},
 {name:'Refeições e marmitas',icons:[
  ['meal-box','Marmitas'],['plate','Prato executivo'],['meal','Refeições'],['buffet','Self-service'],
  ['pf','Prato feito'],['healthy','Saudável'],['homemade','Caseira']]},
 {name:'Lanches',icons:[
  ['burger','Hambúrguer'],['snack','Lanche'],['sandwich','Sanduíche'],['hot-dog','Hot dog']]},
 {name:'Bebidas',icons:[
  ['soda','Refrigerante'],['juice','Suco'],['energy','Energético'],['beer','Cerveja'],
  ['water','Água'],['drink','Bebidas em geral']]},
 {name:'Porções e complementos',icons:[
  ['fries','Porções'],['appetizer','Petiscos'],['rings','Aperitivos'],['board','Tábua'],
  ['plus','Complementos'],['cheese','Adicionais'],['sauce','Molhos'],['spice','Temperos'],
  ['calendar','Sob encomenda'],['more','Diversos']]}
];
export const CATEGORY_ICON_KEYS=CATEGORY_ICON_GROUPS.flatMap(group=>group.icons.map(([key])=>key));
const EMOJIS={
 star:'⭐',discount:'💯',crown:'👑',trophy:'🏆',tag:'🏷️',megaphone:'📣',
 'ice-cream-cone':'🍦','ice-cream-cup':'🍨',dessert:'🍧',
 'pizza-whole':'🍕','pizza-sweet':'🍫', 'meal-box':'🍱',plate:'🍽️',meal:'🍛',
 buffet:'🍲',pf:'🥘',healthy:'🥗',homemade:'🍲',burger:'🍔',snack:'🥪',
 sandwich:'🥪','hot-dog':'🌭',soda:'🥤',juice:'🧃',energy:'⚡',beer:'🍺',
 water:'💧',drink:'🥛',fries:'🍟',appetizer:'🥟',rings:'🧅',board:'🧀',
 plus:'➕',cheese:'🧀',sauce:'🥫',spice:'🧂',calendar:'🗓️',more:'⋯'
};
const COMBOS={
 'combo-burger':['🍔','🥤'],
 'combo-pizza':['pizza','🥤'],
 'combo-acai':['acai','🥤'],
 'combo-ice-cream':['🍦','🍨'],
 'combo-meal':['🍱','🥤'],
 'combo-mixed':['🎁','⭐']
};
function PizzaSlice(){
 return <svg className="pitacco-pizza-svg" viewBox="0 0 64 64" role="presentation" aria-hidden="true">
  <path d="M7 14 Q32 1 57 14 L32 58 Z" fill="#FFCE56" stroke="#B8611D" strokeWidth="2.2" strokeLinejoin="round"/>
  <path d="M7 14 Q32 0 57 14 L53 23 Q32 12 11 23 Z" fill="#D58B46" stroke="#A86128" strokeWidth="1.8" strokeLinejoin="round"/>
  <path d="M14 25 Q32 17 50 25 L32 52 Z" fill="#F6DE74"/>
  <circle cx="23" cy="29" r="5.2" fill="#D73F27" stroke="#B72F23" strokeWidth="1"/>
  <circle cx="40" cy="30" r="4.8" fill="#D73F27" stroke="#B72F23" strokeWidth="1"/>
  <circle cx="31" cy="43" r="4.5" fill="#D73F27" stroke="#B72F23" strokeWidth="1"/>
  <path d="M30 24 q4 -4 7 0 m-15 13 q2 -3 5 0" fill="none" stroke="#51A046" strokeWidth="2.3" strokeLinecap="round"/>
 </svg>;
}
// Açaí preenchido: copo roxo com creme, granola, morango e folha; não utiliza emoji de tigela.
function AcaiCup(){
 return <svg className="pitacco-acai-svg" viewBox="0 0 64 64" role="presentation" aria-hidden="true">
  <path d="M17 27 L21 59 Q32 63 43 59 L47 27Z" fill="#7A248C" stroke="#431252" strokeWidth="2.4" strokeLinejoin="round"/>
  <path d="M22 33 L26 56 Q34 59 39 56 L43 33Z" fill="#A847B0"/>
  <path d="M22 35 L25 52" fill="none" stroke="#CF81D0" strokeWidth="3.5" strokeLinecap="round"/>
  <ellipse cx="32" cy="28" rx="21" ry="7" fill="#4B155D" stroke="#3A104C" strokeWidth="2"/>
  <path d="M13 28 Q15 18 25 20 Q25 11 34 13 Q42 13 42 20 Q53 19 51 28 Q45 34 32 32 Q18 34 13 28Z" fill="#732184" stroke="#461057" strokeWidth="1.8"/>
  <path d="M21 23 Q26 18 33 21 Q42 22 43 25" fill="none" stroke="#BB6CC8" strokeWidth="3" strokeLinecap="round"/>
  <path d="M31 13 Q29 6 37 6 Q43 6 44 12" fill="#942E9E" stroke="#51145F" strokeWidth="1.5"/>
  <path d="M37 12 Q43 5 50 9 Q45 17 37 12Z" fill="#4CAC54"/>
  <path d="M38 14 Q42 12 47 11" fill="none" stroke="#287B37" strokeWidth="1.3"/>
  <path d="M12 17 Q13 9 21 11 Q27 12 26 20 Q22 27 16 23Z" fill="#F34B62" stroke="#C52B48" strokeWidth="1.8"/>
  <path d="M13 15 Q18 10 23 16" fill="none" stroke="#FF9AAA" strokeWidth="2.3" strokeLinecap="round"/>
  <path d="M16 11 L19 7 L22 11" fill="#40984E"/>
  <g fill="#F8CD66"><ellipse cx="27" cy="16" rx="2.6" ry="1.8"/><ellipse cx="31" cy="23" rx="2.7" ry="2"/><ellipse cx="38" cy="22" rx="2.4" ry="1.8"/><ellipse cx="46" cy="22" rx="2.4" ry="1.7"/><ellipse cx="25" cy="28" rx="2" ry="1.5"/></g>
  <path d="M15 32 Q32 37 49 32" fill="none" stroke="#6A1C7C" strokeWidth="1.5"/>
 </svg>;
}
function Fire(){
 return <svg className="pitacco-fire-svg" viewBox="0 0 64 64" role="presentation" aria-hidden="true">
  <g className="pitacco-fire-motion">
   <path d="M33 3 C41 15 38 19 42 27 C45 23 48 17 47 13 C61 25 61 38 56 49 C50 61 38 63 30 61 C12 59 6 46 11 32 C14 24 20 22 21 15 C25 21 26 27 24 33 C30 27 28 17 33 3Z" fill="#F4491B"/>
   <path d="M32 18 C39 29 35 33 43 34 C46 31 46 28 45 27 C53 40 47 54 38 58 C25 64 14 54 16 42 C18 35 25 34 26 29 C27 36 29 38 32 18Z" fill="#FF9A0B"/>
   <path d="M31 34 C34 41 42 42 39 50 C37 56 27 59 23 53 C19 46 27 42 31 34Z" fill="#FFF16A"/>
  </g>
 </svg>;
}
export function inferCategoryIcon(name=''){
 const v=String(name).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
 if(/combo|kit|dupla|duplo/.test(v)){
  if(/sorvete|gelat/.test(v))return 'combo-ice-cream';
  if(/marmita|refeic|prato|almo|janta/.test(v))return 'combo-meal';
  if(/pizza/.test(v))return 'combo-pizza';
  if(/acai/.test(v))return 'combo-acai';
  if(/hamburg|burger|lanche/.test(v))return 'combo-burger';
  return 'combo-mixed';
 }
 if(/destaq|mais vendid/.test(v))return 'flame';
 if(/novidade/.test(v))return 'star';
 if(/promoc|oferta/.test(v))return 'discount';
 if(/acai/.test(v))return 'acai';
 if(/sorvete|gelat/.test(v))return 'ice-cream-cup';
 if(/pizza/.test(v))return 'pizza-slice';
 if(/marmita/.test(v))return 'meal-box';
 if(/refeic|prato/.test(v))return 'plate';
 if(/hamburg|burger/.test(v))return 'burger';
 if(/sandui|lanche/.test(v))return 'sandwich';
 if(/bebida|refrigerante/.test(v))return 'soda';
 if(/suco/.test(v))return 'juice';
 if(/agua/.test(v))return 'water';
 if(/porc|batata frita/.test(v))return 'fries';
 if(/complemento|adicional/.test(v))return 'plus';
 if(/doce|sobremesa|creme/.test(v))return 'dessert';
 return 'more';
}
export function CategoryIcon({icon='more',size=30,animated=true}){
 const key=CATEGORY_ICON_KEYS.includes(icon)?icon:'more';
 let body;
 if(key==='flame')body=<Fire/>;
 else if(key==='pizza-slice')body=<PizzaSlice/>;
 else if(key==='acai')body=<AcaiCup/>;
 else if(COMBOS[key])body=<span className="pitacco-combo-icons">{COMBOS[key].map((item,i)=><span key={i}>{item==='pizza'?<PizzaSlice/>:item==='acai'?<AcaiCup/>:item}</span>)}</span>;
 else body=EMOJIS[key]||'🍽️';
 return <span className={'pitacco-category-icon '+(key==='flame'&&animated?'pitacco-flame-animated':'')} style={{fontSize:size}} aria-hidden="true">{body}</span>;
}
