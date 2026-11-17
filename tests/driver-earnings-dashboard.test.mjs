import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

const read=path=>readFileSync(new URL("../"+path,import.meta.url),"utf8");

test("driver earnings dashboard includes day, week, month, chart and payment history",()=>{
  const page=read("entregador/painel.html");
  for(const [period,field] of [["hoje","earnToday"],["semana","earnWeek"],["mes","earnMonth"]]){
    assert.match(page,new RegExp('data-earn-period="'+period+'"'));
    assert.match(page,new RegExp('id="'+field+'"'));
  }
  for(const name of ["earnChart","earnHistory","earnUpdated","earnError"]){
    assert.match(page,new RegExp('id="'+name+'"'));
  }
  assert.match(page,/sb\.rpc\("pitacco_driver_earnings",\{p_period:period\}\)/);
  assert.match(page,/Apenas|somente entregas concluídas|somente entregas concluídas|somente entregas concluídas|somente entregas concluídas|entregas concluídas/i);
  assert.match(page,/não confirma pagamento recebido/);
});

test("earnings query is scoped to the signed-in courier with RLS, not store gross revenue",()=>{
  const query=read("docs/sql/driver-earnings-dashboard.sql");
  assert.match(query,/security invoker/);
  assert.match(query,/pitacco_courier_session_ready\(\)/);
  assert.match(query,/c\.user_id = \(select auth\.uid\(\)\)/);
  assert.match(query,/d\.courier_id = v_courier/);
  assert.match(query,/d\.store_id = v_store/);
  assert.match(query,/d\.status = 'entregue'/);
  assert.match(query,/d\.logistics_provider = 'loja'/);
  assert.match(query,/d\.courier_payment as valor/);
  assert.match(query,/America\/Sao_Paulo/);
  assert.match(query,/revoke all on function public\.pitacco_driver_earnings\(text\) from public, anon/);
  assert.match(query,/grant execute on function public\.pitacco_driver_earnings\(text\) to authenticated/);
  assert.doesNotMatch(query,/security definer/);
  assert.doesNotMatch(query,/d\.delivery_fee as valor|d\.gross as valor/);
});

test("dashboard does not render earnings from local simulation",()=>{
 const page=read("entregador/painel.html");
 assert.match(page,/renderEarnings\(data\)/);
 assert.match(page,/data\?.*report|if\(!report\|\|!report\.today/);
 assert.match(page,/Sem entregas concluídas neste período/);
});
