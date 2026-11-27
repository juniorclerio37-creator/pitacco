# Atualizações e distribuição

## Instalador de teste

O script PowerShell gera NSIS por usuário e MSI x64. O workflow `.github/workflows/windows.yml` deve ficar na raiz do repositório contendo `web/` e `android/`; execução manual em GitHub Actions. Não foi publicado repositório nem disparado workflow. Configure variáveis de repositório `VITE_SUPABASE_URL` e `VITE_SUPABASE_ANON_KEY`, somente chave pública. Valide instalador em Windows 10 e Windows 11.

## Atualização segura opcional

O plugin oficial Tauri Updater está integrado, mas não há endpoint nem chave pública de distribuição configurados. O botão chama verificação/instalação somente por ação do operador; sem configuração retorna erro. Não há chave privada no projeto. Antes de habilitar:

1. Gere par de assinatura com `npx tauri signer generate`; mantenha chave privada fora do código e do ZIP.
2. Configure `plugins.updater.pubkey` com a chave pública e `plugins.updater.endpoints` com endpoint HTTPS controlado pelo distribuidor no tauri.conf.json; configure `bundle.createUpdaterArtifacts: true`.
3. Armazene chave privada e senha em segredos do CI (`TAURI_SIGNING_PRIVATE_KEY` e `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`), sem commit.
4. Gere release assinado. Publique manifesto de atualização, versão, plataforma windows-x86_64, URL e assinatura conforme o plugin. Não publique apenas o .exe sem o manifesto/assinatura.
5. Teste instalação, atualização válida, assinatura inválida rejeitada, falta de rede e persistência da fila após atualização. Atualize somente após conciliar tarefas em andamento.

Assinatura Tauri verifica pacotes de atualização; assinatura Authenticode do instalador é separada e exige certificado. Não distribuir comercialmente um instalador não homologado. A instalação base não tem endpoint de atualização demonstrativo nem opção para ignorar assinaturas.

Fontes técnicas: https://v2.tauri.app/plugin/updater/ ; https://v2.tauri.app/distribute/windows-installer/ ; https://v2.tauri.app/plugin/autostart/ .
