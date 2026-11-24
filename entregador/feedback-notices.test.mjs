import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const courier=readFileSync(new URL('./painel.html',import.meta.url),'utf8');
const access=readFileSync(new URL('./acesso.html',import.meta.url),'utf8');
const windows=readFileSync(new URL('../revisions/0.12/web/appReleases.mjs',import.meta.url),'utf8');

test('todos os avisos ficam sem vermelho por padrão, com cores para cada gravidade',()=>{
 assert.match(courier,/#notice\[data-kind="success"\]/);
 assert.match(courier,/#notice\[data-kind="warning"\]/);
 assert.match(courier,/#notice\[data-kind="info"\]/);
 assert.match(courier,/#notice\[data-kind="error"\]/);
 assert.doesNotMatch(courier,/#notice\{color:#b91c1c/);
 assert.match(courier,/function message\(text,kind="error"\)/);
 assert.match(courier,/role="status" aria-live="polite" hidden/);
});
test('coleta, saída e conclusão mostram confirmação transitória não-vermelha',()=>{
 assert.match(courier,/message\(notice,notice\.includes\("Atualize a lista"\)\?"warning":"success"\)/);
 assert.match(courier,/message\(notice,\/\(Atenção:/);
 assert.match(courier,/message\("Entrega concluída! Ganho registrado conforme o valor configurado pela loja\.","success"\)/);
 assert.match(courier,/window\.setTimeout/);
 assert.match(courier,/severity==="success"\?4500:6500/);
 assert.match(courier,/function switchView\(view\)\{\s*const next=[^;]+;\s*message\(""\);/);
});
test('erros verdadeiros permanecem, avisos normais têm severidade adequada',()=>{
 assert.match(courier,/if\(severity!=="error"\)/);
 assert.match(courier,/message\("Nova entrega atribuída pela loja\.","info"\)/);
 assert.match(courier,/message\("Pagamento registrado no Pitacco\. Atualize a lista quando houver conexão\.","warning"\)/);
 assert.match(courier,/message\(String\(error\?\.message\|\|"Não foi possível confirmar a coleta"\)\)/);
});
test('o botão Android existente oferece APK oficial 2.0.15 mesmo sem RPC',()=>{
 assert.match(access,/id="downloadAndroid" href="https:\/\/github\.com\/juniorclerio37-creator\/pitacco\/releases\/download\/pitacco-entregador-v2\.0\.16-be032d7a357c\/Pitacco-Entregador-2\.0\.16\.apk"/);
 assert.match(access,/download="Pitacco-Entregador-2\.0\.16\.apk"/);
 assert.match(access,/Versão oficial 2\.0\.16/);
 assert.match(access,/pitacco_public_courier_apk/);
});
test('botão Windows existente procura o último instalador oficial sem filtro de ordenação antiga',()=>{
 assert.match(windows,/releases\?per_page=100/);
 assert.match(windows,/Date\.parse\(b\.published_at\|\|b\.created_at\)/);
 assert.match(windows,/WINDOWS_ASSET = 'Pitacco-Windows-Setup\.exe'/);
});
