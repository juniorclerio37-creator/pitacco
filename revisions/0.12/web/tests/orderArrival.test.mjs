import test from 'node:test';
import assert from 'node:assert/strict';
import {newOrderTracker,windowsStore,saveWindowsStore} from '../orderArrival.mjs';

const order=(id,source,store_id='a',status='pending',extras={})=>({id,source,store_id,status,...extras});
test('New direct and marketplace orders alert once and never cross stores',()=>{
 const observe=newOrderTracker('a');
 const backlog=order('old','99food');
 assert.deepEqual(observe([backlog]),[]);
 const arrivals=[order('1','proprio'),order('2','ifood','a','accepted'),order('3','99food'),order('4','keeta','a','accepted')];
 const outsider=order('5','99food','b');
 assert.deepEqual(observe([backlog,...arrivals,outsider]).map(x=>x.id),['1','2','3','4']);
 assert.deepEqual(observe([]),[]);
 assert.deepEqual(observe([...arrivals,order('old','99food','a','accepted'),outsider]),[]);
});
test('Scheduled order alerts on arrival, not when preparation is released',()=>{
 const observed=newOrderTracker('a');
 const after=new Date(Date.now()+3600000).toISOString();
 const before=new Date(Date.now()-3600000).toISOString();
 assert.deepEqual(observed([]),[]);
 assert.equal(observed([order('1','proprio','a','pending',{scheduled_release_at:after})]).length,1);
 assert.equal(observed([order('1','proprio','a','pending',{scheduled_release_at:before})]).length,0);
});
test('Saved store is per account and must still be accessible',()=>{
 const vals=new Map();
 const storage={getItem:key=>vals.get(key),setItem:(key,value)=>vals.set(key,value)};
 const stores=[{id:'a'},{id:'b'}];
 assert.equal(windowsStore(storage,'one',stores),'');
 saveWindowsStore(storage,'one','b');
 assert.equal(windowsStore(storage,'one',stores),'b');
 assert.equal(windowsStore(storage,'two',stores),'');
 assert.equal(windowsStore(storage,'one',[{id:'a'}]),'a');
});
