import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
const html=readFileSync(new URL('../marketing/index.html',import.meta.url),'utf8');
test('landing pricing, legal links and anchors are consistent',()=>{
 const ids=[...html.matchAll(/\bid="([^"]+)"/g)].map(m=>m[1]);
 assert.equal(new Set(ids).size,ids.length);
 for(const m of html.matchAll(/href="#([^"]+)"/g))assert.ok(ids.includes(m[1]),m[1]);
 for(const link of ['/app/','/cadastro/','/sistema/','/termos/','/privacidade/','mailto:suporte@pitacco.com.br'])assert.ok(html.includes('href="'+link+'"'));
 assert.match(html,/2%/);assert.match(html,/R\$ 59,90/);assert.doesNotMatch(html,/5% sobre|5% de comissão/);
});
test('landing demo, mobile menu and pricing calculator respond correctly',()=>{
 function element(dataset={},value=''){const events={},attrs={};const classes=new Set();return{dataset,value,events,attrs,textContent:'',hidden:false,classList:{toggle(k,force){const on=force===undefined?!classes.has(k):force;if(on)classes.add(k);else classes.delete(k);return on},remove:k=>classes.delete(k)},addEventListener:(n,f)=>events[n]=f,setAttribute:(n,v)=>attrs[n]=v,querySelectorAll:()=>[]}}
 const ids=Object.fromEntries(['siteMenu','demoScreen','sales','salesValue','flexCost','calcHint'].map(k=>[k,element()]));
 ids.sales.value='5000';
 const toggle=element(),views=['vendas','pedidos','entregas'],buttons=views.map(view=>element({view})),panels=views.map(panel=>element({panel})),side=Array.from({length:6},()=>element());
 const document={getElementById:k=>ids[k],querySelector:()=>toggle,querySelectorAll:k=>k==='.demo-choice'?buttons:k==='[data-panel]'?panels:side,addEventListener(){}};
 for(const m of html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/gi))runInNewContext(m[1],{document,Intl});
 assert.match(ids.flexCost.textContent,/100,00/);assert.match(ids.calcHint.textContent,/40,10/);
 ids.sales.value='2995';ids.sales.events.input();assert.match(ids.calcHint.textContent,/mesmo custo/);
 ids.sales.value='2000';ids.sales.events.input();assert.match(ids.flexCost.textContent,/40,00/);assert.match(ids.calcHint.textContent,/Flex.*19,90/);
 buttons[1].events.click();assert.equal(ids.demoScreen.dataset.activeView,'pedidos');assert.deepEqual(panels.map(p=>p.hidden),[true,false,true]);assert.equal(buttons[1].attrs['aria-pressed'],'true');
 buttons[2].events.click();assert.deepEqual(panels.map(p=>p.hidden),[true,true,false]);
 toggle.events.click();assert.equal(toggle.attrs['aria-expanded'],'true');toggle.events.click();assert.equal(toggle.attrs['aria-expanded'],'false');
});