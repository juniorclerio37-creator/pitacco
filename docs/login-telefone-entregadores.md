# Autenticação por telefone — Pitacco Entregador

## Decisão de produto
- Login somente por telefone e senha. Não há cadastro público nem recuperação autônoma de senha pelo entregador.
- Somente gestor autorizado da loja cadastra, desativa e solicita redefinição em **Motoboys**.
- Primeiro acesso e acesso após redefinição exigem troca de senha **antes de permitir acessar qualquer pedido**.
- Exemplo de senha temporária solicitado: `1234`. **Não usar `1234` como senha universal de produção**: adotar senha temporária aleatória e individual, ou PIN inicial entregue por canal verificado e com validade curta, para reduzir comprometimento de contas.

## Fluxos
1. Loja cadastra nome e telefone em formato E.164, confirmando titularidade operacional do vínculo. O backend cria conta de autenticação e vínculo de loja sem disponibilizar criação pública de usuários.
2. Backend gera credencial temporária individual de uso limitado; mostra a credencial apenas ao operador autorizado, uma única vez, para entrega segura ao motoboy. Não armazenar em texto puro.
3. Entregador informa telefone + credencial temporária. Backend valida com limitação de tentativas e marca sessão como `password_change_required`; somente endpoint de troca de senha e logout são permitidos até completar a troca.
4. Entregador define nova senha pessoal (preferir no mínimo 8 caracteres, com bloqueio de senhas comuns); backend revoga credencial temporária e sessões anteriores.
5. Esqueceu a senha: entregador procura a loja. Gestor autorizado escolhe **Redefinir senha** e confirma a operação. Backend emite nova credencial temporária individual, invalida a antiga e revoga sessões ativas; na próxima autenticação, exigir nova senha.
6. Se houver múltiplos vínculos de loja, redefinição da credencial global deve ter regras claras de autorização para evitar que uma loja controle indevidamente o acesso do entregador às outras. Preferência: identidade global com reset por administrador autorizado após verificação ou contas isoladas por estabelecimento, a decidir antes de produção.

## Supabase Auth
- Supabase Auth não oferece login por telefone+senha diretamente em todos os fluxos da mesma forma que e-mail+senha; verificar API/documentação e escolher integração suportada. Não criar login customizado que contorne políticas/RLS.
- Uma opção a avaliar é mapeamento interno de telefone verificado para identificador de login e autenticação server-side; **nunca expor** identificadores sintéticos ou senhas em URLs, logs ou analytics. Verificar viabilidade real antes de implementar.
- Tokens e privilégios administrativos somente no servidor. Nunca incluir service_role no site/app.

## UI
- Tela Entrar: Telefone com DDD, Senha, botão Entrar e texto 'Esqueceu a senha? Solicite à sua loja'.
- Tela Primeiro acesso: 'Por segurança, crie sua senha pessoal', Nova senha, Confirmar senha, Salvar e continuar. Não exibir pedidos até conclusão.
- Painel Motoboys: telefone, status de acesso (pendente, ativo, bloqueado), **Redefinir senha**, desativar, histórico de redefinições. Não exibir senha atual.

## Segurança e testes de aceite
- Login inválido apresenta erro genérico para evitar enumeração de contas.
- Bloqueio progressivo de tentativas, rate limit por conta/dispositivo/rede e trilha de auditoria sem registrar senha.
- Reset revoga sessões anteriores, invalida credenciais antigas e exige troca de senha novamente.
- Senha temporária expirada não permite acesso.
- Entregador sem vínculo ativo não acessa pedidos mesmo que a senha esteja correta.
- Gestor de loja A não redefine conta da loja B sem autorização expressa.
- A redefinição é registrada com operador, loja, horário e resultado, sem o segredo.

## Estado
Especificação de desenvolvimento. Ainda não existe autenticação real por telefone no protótipo; integração com backend, Supabase Auth e painel do lojista deve ser implementada e testada antes de liberar acesso a dados reais.
