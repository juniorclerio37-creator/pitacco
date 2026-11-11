# Pitacco — nova interface web (branch web-redesign-2026-11)

## Escopo implementado
- Interface responsiva com menu lateral, dashboard, listagem e aceite de pedidos, produtos, painel financeiro resumido e configuração do cardápio.
- Login e recuperação de senha pelo Supabase Auth; acesso restrito por associação em public.store_members.
- Leitura e escrita com escopo de store_id, sujeitas às políticas RLS.
- Resolução de cardápio por slug do hostname em subdomínios de pitacco.com.br, com vitrine de produtos ativos.\n- Carrinho público, seleção de complementos, entrega/retirada, dados do cliente e checkout via RPC existente `checkout_public_order` (validação e total no servidor).\n- Aceite via RPC existente `accept_order` e gravação das configurações do menu via `save_public_menu_settings`.\n- Painel de entregas com listagem, contadores e atribuição manual via `assign_order_courier`.\n- Painel de impressão com leitura de fila e edição de setores em `print_sectors`; impressão física permanece sob responsabilidade do aplicativo Windows.

## Limitações e pendências
- Esta branch é uma base inicial e **não está publicada**. Não foi executado teste em navegador nem build automatizado.
- Carrinho e checkout estão conectados ao backend, mas **não homologados por testes reais**. Atribuição manual de motoboy e configuração de setores foram conectadas, mas não homologadas. Integrações de pagamentos online, impressão física, rotas automáticas e relatórios completos ainda não foram implementadas nesta interface. Não anunciar como prontos.
- A leitura anônima do cardápio usa a RPC `get_public_menu`, que retorna apenas os campos destinados ao público; a função possui permissão EXECUTE para anon. Revisar segurança de todas as RPCs privilegiadas antes da produção.
- A impressão exige agente Windows; não confundir envio ao spooler com papel impresso.
- Configurar roteamento, DNS wildcard e TLS na Cloudflare/hospedagem antes de usar subdomínios.
- O banco possui lojas sem associação em store_members. Corrigir vínculo de forma autenticada e auditada, sem liberar acesso geral.
- A chave publishable do Supabase é pública; nunca colocar service_role no frontend.
- Usar dependências fixadas e build com Vite antes da produção; este HTML usa import de CDN somente para prototipagem inicial.

## Testes necessários
1. Login válido/inválido, redefinição de senha e usuário sem loja.
2. Isolamento de duas lojas com contas distintas (RLS).
3. Cadastro de produto e visibilidade no cardápio.
4. Aceite concorrente e proteção contra duplicidade.
5. Vitrine em subdomínio com leitura pública segura.
6. Testes responsivos e acessibilidade.
7. Revisão de segurança e deploy de staging antes de produção.

**Não sobrescrever a versão atual de produção antes da homologação.**
