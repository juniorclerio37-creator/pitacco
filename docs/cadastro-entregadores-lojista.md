# Cadastro e acesso de entregadores — exclusivamente pelo lojista

## Regra obrigatória
Não existe cadastro público de entregadores, autoinscrição, criação de loja ou solicitação de vínculo no site/app Pitacco Entregador. **Somente usuários autorizados da loja** podem criar, convidar, editar, desativar e desvincular entregadores em **Motoboys → Adicionar entregador**.

## Fluxo
1. Lojista autorizado informa nome, telefone e identificador de login (e-mail ou telefone conforme mecanismo de autenticação homologado). Não coletar senha do entregador no painel.
2. Backend valida permissão do lojista e cria convite de uso único com prazo de expiração para definição da própria senha pelo entregador. Nunca expor chaves administrativas no navegador.
3. Entregador recebe o convite pelo canal configurado e faz primeiro acesso. Site/app do entregador mostra apenas **Entrar** e **Recuperar acesso**; sem botão **Cadastrar-se**.
4. O vínculo `store_id + driver_user_id` é criado pelo backend; o entregador só acessa atribuições das lojas às quais está vinculado. Caso haja mais de uma loja autorizada, pode alternar contexto sem ver pedidos de terceiros.
5. Loja pode desativar, reativar, editar dados e revogar vínculo. Revogação remove imediatamente acesso aos pedidos da loja e invalida permissões de localização/atribuição; sessões existentes devem ser revalidadas no servidor.
6. A loja pode realocar manualmente pedidos para outro entregador vinculado, sem aceite/recusa no app.

## Segurança
- Supabase Auth para identidade; associação e papéis em tabelas protegidas por RLS com vínculo real à loja; não usar `user_metadata` para autorização.
- Criar convites e vínculos por backend autenticado com permissão administrativa; não confiar em `store_id` enviado pelo cliente.
- Não gerar senha padrão compartilhada, não armazenar senha em texto e não enviar senha por mensagens.
- Auditoria de criação, edição, desativação, vínculo e revogação, com operador, horário e loja.

## Critérios de aceite
- Sem rota pública de cadastro e sem botão de inscrição.
- Usuário não convidado não consegue acessar área do entregador.
- Entregador desativado não recebe alocações e não pode consultar pedidos da loja.
- Lojista de outra loja não pode alterar o cadastro ou os vínculos sem autorização.
- Convite expirado ou reutilizado não concede acesso.

## Situação
Documento de requisitos; a demonstração web atual não possui login real nem integração com cadastro de motoboys no painel. A implementação de autenticação, convite e RLS permanece pendente.
