import test from 'node:test';
import assert from 'node:assert/strict';
import {calculateSalesOffer} from '../revisions/0.12/web/salesOfferMath.mjs';
const base={base:40,cost:15,fee:10,fixed:3,margin:20,discount:10};
test('discount respects direct costs and target margin',()=>{
 const r=calculateSalesOffer(base);assert.equal(r.minimum,25.72);assert.equal(r.proposed,36);assert.ok(Math.abs(r.contribution-14.4)<1e-9);assert.equal(r.safe,true);assert.equal(r.requiredVolume,25);assert.equal(r.maximumDiscount,35.7);
});
test('missing cost and impossible percentages fail closed',()=>{
 for(const patch of [{cost:''},{cost:0},{fee:80},{discount:100},{base:0},{fixed:-1},{margin:'NaN'},{fixed:null}])assert.equal(calculateSalesOffer({...base,...patch}),null);
});
test('loss-making promotions do not suggest a volume target',()=>{
 const r=calculateSalesOffer({...base,discount:75});assert.equal(r.safe,false);assert.ok(r.contribution<0);assert.equal(r.requiredVolume,null);
});
