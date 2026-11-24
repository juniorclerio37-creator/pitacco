import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizePizzaConfig} from '../revisions/0.12/web/normalizePizzaConfig.mjs';
import {quotePizza,quotePizzaSelection} from '../revisions/0.12/web/pizzaPricing.mjs';
const draft=()=>({rule:'avg',sizes:[{id:'g',name:'Grande',diameter:'35',slices:'8',maxFlavors:'2'}],flavors:[{id:'a',name:'Calabresa',available:true,prices:{g:'49,90'}},{id:'b',name:'Frango',available:true,prices:{g:'59.99'}}],extras:[{id:'e',kind:'Borda',name:'Catupiry',prices:{g:'5.00'}},{id:'m',kind:'Massa',name:'Fina',prices:{g:'0'}}]});
test('registration normalizes decimal prices and quotes equal portions',()=>{const c=normalizePizzaConfig(draft());assert.equal(c.flavors[0].prices.g,4990);assert.equal(c.extras[1].prices.g,0);assert.equal(quotePizza({size:c.sizes[0],flavors:c.flavors,selection:['a','b'],rule:c.rule,extras:[c.extras[0].prices.g]}).total,5995)});
test('rejects malformed prices, missing flavors, duplicate identifiers and invalid rule',()=>{for(const alter of [d=>d.flavors[0].prices.g='-1',d=>d.flavors[0].prices.g='1.001',d=>d.flavors=[],d=>d.sizes.push({...d.sizes[0]}),d=>d.rule='unknown']){const d=draft();alter(d);assert.throws(()=>normalizePizzaConfig(d));}});
test('blank price means unavailable; zero means free',()=>{const d=draft();d.flavors[0].prices.g='';const c=normalizePizzaConfig(d);assert.equal(Object.hasOwn(c.flavors[0].prices,'g'),false);assert.equal(c.extras[1].prices.g,0);assert.throws(()=>quotePizza({size:c.sizes[0],flavors:c.flavors,selection:['a'],rule:c.rule}));});
test('fixed price is converted to cents',()=>{const d=draft();d.rule='fixed';d.sizes[0].fixedPrice='65,50';const c=normalizePizzaConfig(d);assert.equal(c.sizes[0].fixedPrice,6550);});

test('merchant pizza selection sends canonical option IDs and labels with calculated price',()=>{const c=normalizePizzaConfig(draft());const q=quotePizzaSelection(c,{sizeId:'g',flavorIds:['b','a'],extraIds:['e','m']});assert.deepEqual(q.options,['a','b','e','g','m']);assert.deepEqual(q.names,['Grande','Frango','Calabresa','Catupiry','Fina']);assert.equal(q.total,5995);});
test('merchant pizza selection rejects duplicated and foreign options',()=>{const c=normalizePizzaConfig(draft());for(const extraIds of [['e','e'],['foreign']])assert.throws(()=>quotePizzaSelection(c,{sizeId:'g',flavorIds:['a'],extraIds}));});
