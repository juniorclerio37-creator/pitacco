import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const html=readFileSync(new URL('../marketing/cardapio.html',import.meta.url),'utf8');
const context=vm.createContext({money:n=>String(n)});
vm.runInContext(html.slice(html.indexOf('function availableLoyaltyRewards('),html.indexOf('const loyaltyFingerprint=')),context);
const rules={points_enabled:true,min_points_to_redeem:100,points_reward_cents:1000,orders_enabled:true,orders_required:10,orders_reward_cents:500,cashback_enabled:true,cashback_max_redeem_percent:50};
function values(wallet){context.wallet=wallet;return Array.from(vm.runInContext('availableLoyaltyRewards(wallet)',context),r=>r.value)}
test('only benefits unlocked for this customer are offered',()=>{
 assert.deepEqual(values(null),[]);
 assert.deepEqual(values({rules,points:99,orders:9,cashback_cents:0}),[]);
 assert.deepEqual(values({rules,points:100,orders:9,cashback_cents:0}),['points']);
 assert.deepEqual(values({rules,points:100,orders:10,cashback_cents:100}),['points','orders','cashback']);
 assert.deepEqual(values({rules:{...rules,points_enabled:false,orders_reward_cents:0,cashback_max_redeem_percent:0},points:1000,orders:100,cashback_cents:100}),[]);
});
test('referral is automatic, scoped to store and never a checkout field',()=>{
 assert.doesNotMatch(html,/id="loyaltyReferral"/);
 assert.doesNotMatch(html,/if\(referralCode\|\|loyaltyProgram/,'An old link cannot force disabled Fideliza checkout');
 assert.match(html,/pitacco-referral:'\+slug/);
 assert.match(html,/pendingRequest\.p_key=referralCode/);
 assert.match(html,/referralCode='';try\{localStorage.removeItem\(referralStorageKey\)/);
});
test('referral attribution survives return and does not cross stores',()=>{
 const storage=new Map();
 const source=html.slice(html.indexOf("const referralStorageKey='pitacco-referral:'"),html.indexOf('const referralLink='));
 function open(slug,search){const ctx=vm.createContext({slug,URLSearchParams,location:{search},localStorage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v)}});vm.runInContext(source,ctx);return vm.runInContext('referralCode',ctx)}
 assert.equal(open('a','?indicacao=abc123'),'ABC123');
 assert.equal(open('a',''),'ABC123');
 assert.equal(open('b',''),'');
 assert.equal(open('b','?indicacao=%3Cscript%3E'),'');
});

test('checkout only offers usable rewards and limits cashback to the cart',()=>{
 const helper=html.slice(html.indexOf('function checkoutAvailableLoyaltyRewards('),html.indexOf('function setLoyaltyCardExpanded('));
 vm.runInContext(helper,context);
 context.wallet={rules,points:100,orders:10,cashback_cents:800};
 let out=vm.runInContext('checkoutAvailableLoyaltyRewards(wallet,600)',context);
 assert.deepEqual(Array.from(out,r=>[r.value,r.cents]),[['orders',500],['cashback',300]]);
 context.wallet={rules,points:99,orders:9,cashback_cents:0};
 assert.equal(vm.runInContext('checkoutAvailableLoyaltyRewards(wallet,5000).length',context),0);
});
