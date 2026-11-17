import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

const read=p=>readFileSync(new URL("../"+p,import.meta.url),"utf8");

test("merchant Motoboys workspace mounts secure management in Entregadores",()=>{
  const workspace=read("revisions/0.12/web/CourierWorkspace.jsx");
  const manager=read("revisions/0.12/web/CourierAccessManager.jsx");
  const mount=read("revisions/0.12/mount_courier_workspace_049.py");
  assert.match(workspace,/import CourierAccessManager from '\.\/CourierAccessManager\.jsx'/);
  assert.match(workspace,/tab==='Entregadores'&&/);
  assert.match(workspace,/<CourierAccessManager client={client} store={store}/);
  assert.match(mount,/tab==='Entregadores'&&<CourierWorkspace/);
  assert.match(manager,/client\.functions\.invoke\('pitacco-courier-access'/);
  assert.match(manager,/storeId:store\.id/);
  assert.match(manager,/action\('reset',c\)/);
  assert.match(manager,/action\('disable',c\)/);
  assert.match(manager,/action\('reactivate',c\)/);
});

test("preserves billing reports routes and removes email-based courier signup",()=>{
  const workspace=read("revisions/0.12/web/CourierWorkspace.jsx");
  const logistics=read("revisions/0.12/web/LogisticsHub.jsx");
  assert.match(workspace,/tab==='Entregas'/);
  assert.match(workspace,/tab==='Pagamentos'/);
  assert.match(workspace,/tab==='Relatórios'/);
  assert.match(workspace,/tab==='Desempenho'/);
  assert.doesNotMatch(logistics,/register_courier/);
  const manager=read("revisions/0.12/web/CourierAccessManager.jsx");
  assert.doesNotMatch(manager,/auth\.signUp\s*\(/);
  assert.doesNotMatch(manager,/SUPABASE_SERVICE_ROLE_KEY|Deno\\.env\\.get/);
});

test("standalone courier manager redirects merchants to app.pitacco",()=>{
  const old=read("entregador/gestao.html");
  assert.match(old,/app\.pitacco\.com\.br/);
  assert.match(old,/Motoboys/);
  assert.doesNotMatch(old,/<form|<input[^>]*password/i);
});
