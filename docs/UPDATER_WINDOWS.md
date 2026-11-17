# Atualização nativa do Pitacco Windows

O Pitacco Windows usa Tauri 2. O instalador NSIS possui o mesmo identificador
`com.deliverygestor.desktop` e modo `currentUser`, preservando o diretório de
dados e a fila SQLite. Não desinstalar antes de atualizar.

## Etapa única: ativar assinatura GRATUITA do atualizador

A assinatura Ed25519 do Tauri **não é** o certificado comercial Authenticode
do Windows. Ela é indispensável para atualizações automáticas seguras.

1. Em uma cópia local do projeto com dependências instaladas, execute
   `npm run tauri signer generate -- -w ~/.tauri/pitacco-updater.key` dentro de
   `web`. Salve a chave privada fora do repositório, em backup seguro.
2. No GitHub, em **Settings → Secrets and variables → Actions**, cadastre:
   - `TAURI_SIGNING_PRIVATE_KEY`: conteúdo completo do arquivo privado
   - `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`: senha usada para gerar a chave (se houver)
   - `PITACCO_TAURI_UPDATER_PUBLIC_KEY`: conteúdo completo da chave pública
3. Uma compilação Windows de `main` passa a embutir somente a chave pública,
   a usar HTTPS no endpoint de update e a gerar a assinatura do instalador.
   O workflow publica `latest.json` e `Pitacco-Windows-Setup.exe.sig` no
   GitHub Releases junto ao EXE.
4. Dentro do Pitacco Windows, use **Configurações → Verificar atualizações**.
   O Tauri verifica a assinatura do pacote antes da instalação. Não atualiza
   enquanto há trabalhos `queued` ou `printing` na fila local.

**Não** coloque chaves privadas em commits, mensagens, arquivos públicos nem
no frontend. Sem ambas as chaves, o instalador NSIS convencional continua
sendo produzido, mas o aplicativo não tenta instalar pacotes sem assinatura.

## Migração dos aplicativos existentes

A versão 0.12.1 foi distribuída com `plugins.updater.pubkey` vazio e
`endpoints=[]`. Ela **não pode ativar o próprio atualizador remotamente**.
Por isso é necessária **uma única execução do instalador de atualização por
cima da versão existente**, sem desinstalar, para receber uma versão que
já inclua a chave pública e o endpoint. Depois disso, as versões seguintes
podem ser instaladas pela função de atualização interna.

## Política de segurança

- Preservar SQLite e logs no diretório de dados local do Windows.
- Verificar versão crescente e a assinatura Ed25519.
- Não iniciar a atualização enquanto houver impressões pendentes ou em envio.
- Não alterar pedidos em andamento, estabelecimento ativo ou dados financeiros.
- Publicar a nova versão somente após CI Windows, banco isolado, navegador e
  teste real de atualização Windows aprovados.
