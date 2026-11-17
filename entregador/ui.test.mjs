import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

function read(relative) {
  return readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8");
}
function syntaxCheck(source) {
  const folder=mkdtempSync(join(tmpdir(),"pitacco-syntax-"));
  try {
    const file=join(folder,"module.mjs");
    writeFileSync(file,source);
    const result=spawnSync(process.execPath,["--check",file],{encoding:"utf8"});
    assert.equal(result.status,0,result.stderr);
  } finally {rmSync(folder,{recursive:true,force:true});}
}
test("browser modules for driver login and delivery panel parse",()=>{
  for(const page of ["acesso.html","painel.html"]){
    const html=read(page);
    const match=html.match(/<script type="module">([\s\S]*?)<\/script>/i);
    assert.ok(match,"Missing module in "+page);
    syntaxCheck(match[1]);
  }
});
test("driver controls never implement public registration or accepting / rejecting",()=>{
  const login=read("acesso.html"),panel=read("painel.html");
  assert.match(login,/auth\.signIn/);
  assert.match(login,/change-password/);
  assert.doesNotMatch(login,/auth\.signUp\s*\(/);
  assert.match(panel,/pitacco_driver_collect/);
  assert.match(panel,/pitacco_driver_depart/);
  assert.doesNotMatch(panel,/set_delivery_status/);
  assert.doesNotMatch(panel,/pitacco_driver_accept/);
});
test("merchant management lives in existing Motoboys -> Entregadores tab",()=>{
  const workspace=read("../revisions/0.12/web/CourierWorkspace.jsx");
  const management=read("../revisions/0.12/web/CourierAccessManager.jsx");
  const legacy=read("../revisions/0.12/web/LogisticsHub.jsx");
  const oldPage=read("gestao.html");
  assert.match(workspace,/tab==='Entregadores'/);
  assert.match(workspace,/<CourierAccessManager/);
  assert.match(workspace,/tab==='Pagamentos'/);
  assert.match(workspace,/tab==='Relatórios'/);
  assert.match(workspace,/tab==='Entregas'/);
  assert.doesNotMatch(legacy,/register_courier/);
  assert.doesNotMatch(management,/auth\.signUp\s*\(/);
  assert.match(management,/client\.functions\.invoke\('pitacco-courier-access'/);
  for(const action of ['create','reset','disable','reactivate']){
    assert.ok(management.includes("'"+action+"'"),"Missing store management action "+action);
  }
  assert.match(oldPage,/app\.pitacco\.com\.br/);
  assert.doesNotMatch(oldPage,/type="password"/);
});
test("Edge Function parses and checks caller JWT and store membership",()=>{
  const edge=read("../supabase/functions/pitacco-courier-access/index.ts");
  syntaxCheck(edge);
  assert.match(edge,/admin\.auth\.getUser\(jwt\)/);
  assert.match(edge,/authorizeStore\(actor,/);
  assert.match(edge,/pitacco_courier_auth_state/);
  assert.doesNotMatch(edge,/Deno\.env\.get\("JWT_SECRET"\)/);
});
