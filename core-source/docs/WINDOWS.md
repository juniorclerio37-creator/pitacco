# Instalação e compilação no Windows 10/11 x64

## Preparação do computador de desenvolvimento

Instale Node.js 22 LTS, Rust stable (rustup, toolchain MSVC, versão mínima declarada 1.90), Visual Studio Build Tools com **Desktop development with C++**, Windows SDK e WebView2 Runtime. O componente de build MSI pode requerer o recurso opcional VBSCRIPT do Windows. Consulte https://v2.tauri.app/start/prerequisites/ .

Para o computador do restaurante, após gerar o instalador, não é necessário Node/Rust; são necessários Windows, WebView2 e driver da impressora. O instalador está configurado para baixar WebView2 se faltar; preparar o Runtime antes para instalação sem internet.

## Banco compartilhado

Use um projeto de homologação Supabase. Não execute migrações pela primeira vez no banco de produção. Faça backup. Para banco novo, execute na ordem:

1. `web/supabase/schema.sql`
2. `web/supabase/003_delivery.sql`
3. `android/supabase/004_dispatch_mobile.sql`
4. `android/supabase/005_routes_and_delivery_codes.sql`
5. `web/supabase/006_dispatch_batches.sql`
6. `web/supabase/007_marketplace_logistics.sql`
7. `web/supabase/008_imports_external_delivery.sql`
8. `web/supabase/009_menu_images_dispatch_policy.sql`
9. `web/supabase/010_acceptance_printing.sql`

Em banco existente, aplique apenas migrações ainda não aplicadas: a 010 não é um script idempotente. Corrige também a grafia inconsistente da distribuição automática. Realtime é habilitado para orders, print_jobs e deliveries quando a publicação supabase_realtime existe.

Crie usuários com Supabase Auth. Promova o administrador por SQL conforme README original; cadastre loja e associe contas como gestor. O painel operacional usa as permissões de gestor de loja. Não coloque `service_role` em nenhum frontend, arquivo .env distribuído ou aplicativo.

## Compilar

No PowerShell, dentro de `web`:

```powershell
Copy-Item .env.example .env
notepad .env
# Preencher URL Supabase e chave pública/anon do MESMO projeto da web/Android.
.\scripts\build-windows.ps1
```

O script executa npm ci, testes JS, testes Rust do núcleo e `tauri build`. Os instaladores, se o build passar, ficam em:

- `web/src-tauri/target/release/bundle/nsis/*.exe`
- `web/src-tauri/target/release/bundle/msi/*.msi`

Se apenas o MSI falhar por ferramentas WiX/VBScript, gere NSIS:

```powershell
npm run desktop:build -- --bundles nsis
```

Desenvolvimento: `npm run desktop:dev`. Web: `npm run dev` ou `npm run build`. Para validar o bundle com todos os componentes, configure `.env`; sem Supabase a tela de configuração é exibida e o otimizador pode remover código inacessível.

## Primeiro uso

Entre com uma conta de gestor, selecione a loja e abra **Operação e impressão**. Configure setores com nome exato da impressora, largura e vias. Vincule este computador à loja. Cada loja permite apenas um computador de impressão; isso impede dois agentes de imprimir a mesma comanda. Ative ou desative início com Windows e teste a notificação. Fechar pelo X oculta a janela; para encerrar use **Sair (pausar impressão)** na bandeja.

O aplicativo precisa permanecer executando e com usuário/loja selecionados. Pode ficar na bandeja; não depende de Chrome/Edge abertos. Ao sair da conta ou selecionar outra loja, a fila anterior é preservada e pausada. Trabalho já em envio pode terminar. Falta de internet não apaga tarefas salvas. Após reiniciar offline, se a sessão/seleção não puder ser recuperada, será necessário conectar e selecionar a loja para retomar; não é um serviço Windows sem sessão.

O login exige internet inicialmente; a autenticação persistida é gerida pelo cliente Supabase. Não é permitido confirmar aceite novo sem resposta do backend. Nunca trate erro de rede como aceite confirmado.
