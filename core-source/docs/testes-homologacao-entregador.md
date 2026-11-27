# Validação antes da ativação do Pitacco Entregador

## Testes automatizados do modelo
Executar na raiz do repositório com Node.js 20+:
```sh
node --test entregador/domain.test.mjs entregador/access-rules.test.mjs
```
Esses testes exercitam um **modelo de referência em JavaScript**, não a RLS real do Postgres.

## Testes de integração obrigatórios com Supabase
Preparar ambiente de homologação com duas lojas, dois gestores e três entregadores de teste, com pelo menos um entregador desativado. Não usar dados de clientes reais.

1. Login por telefone com senha temporária individual; troca obrigatória no primeiro acesso.
2. Falha de login com senha errada; rate limit e resposta sem enumeração de usuário.
3. Reset por gestor autorizado; revogar sessões anteriores e exigir nova troca.
4. Gestor A não pode redefinir conta exclusivamente da loja B.
5. Entregador A só pode ler entrega atribuída a A, mesmo que seja membro da loja.
6. Entregador A não pode ler pedido de B, endereço de B ou pagamentos de B.
7. Entregador desativado não lê entregas nem recebe novas atribuições.
8. Gestor da loja A só lê pedidos da loja A; administrador global mantém acesso necessário.
9. Realocação feita pelo gestor atualiza imediatamente a visibilidade para o novo entregador.
10. Entregador não pode aceitar/rejeitar; apenas coletar, sair e concluir com provas de entrega e pagamento válidos.
11. Repetir testes após atualizar policies e após reconexão de sessão antiga.

## Critério de publicação
Não publicar login real ou acesso a pedidos até que os testes de RLS com JWTs de usuários diferentes sejam executados e aprovados. Não aplicar SQL apenas com base nos testes do modelo JavaScript.
