import test from 'node:test';
import assert from 'node:assert/strict';
import {businessDay,isDailyOrder} from '../dailyOrders.mjs';
test('Brasilia midnight keeps prior open orders and archives prior terminal orders',()=>{
 const now='2026-11-26T03:00:00Z',day=businessDay(now),old={created_at:'2026-11-26T02:59:59Z'},today={created_at:now};
 assert.equal(day,'2026-11-26');assert.equal(businessDay(old.created_at),'2026-11-25');
 for(const stage of ['analysis','preparing','ready','delivery','scheduled'])assert.equal(isDailyOrder(old,stage,day),true);
 for(const stage of ['completed','cancelled','rejected']){assert.equal(isDailyOrder(old,stage,day),false);assert.equal(isDailyOrder(today,stage,day),true);}
});
