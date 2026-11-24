import test from 'node:test';
import assert from 'node:assert/strict';
import {quotePizza} from '../revisions/0.12/web/pizzaPricing.mjs';
const input={size:{id:'large',maxFlavors:2,fixedPrice:5500},flavors:[{id:'a',prices:{large:4990}},{id:'b',prices:{large:5990}}],selection:['a','b'],extras:[800]};
test('pizza pricing rules and extras',()=>{
 for(const [rule,total] of [['max',6790],['min',5790],['avg',6290],['fixed',6300]])assert.equal(quotePizza({...input,rule}).total,total);
});
test('equal portions',()=>assert.deepEqual(quotePizza(input).portions,[{id:'a',numerator:1,denominator:2},{id:'b',numerator:1,denominator:2}]));
test('reject invalid selections and prices',()=>{
 for(const selection of [[],['a','a'],['a','b','c'],['missing']])assert.throws(()=>quotePizza({...input,selection}));
 assert.throws(()=>quotePizza({...input,extras:[-1]}));
 assert.throws(()=>quotePizza({...input,flavors:[{...input.flavors[0],available:false},input.flavors[1]]}));
});
