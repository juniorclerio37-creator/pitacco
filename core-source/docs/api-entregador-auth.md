# Contrato de integração — cadastro e login do Pitacco Entregador

Este documento define os contratos pretendidos. **Não indica endpoints publicados ou funcionais.** Adaptar ao backend real após extração e inspeção da versão preservada.

## Operações administrativas (painel Motoboys)
- `POST /driver-admin/invitations`: gestor autorizado cadastra telefone E.164, nome e vínculo da loja; backend gera credencial temporária individual e com expiração. Não aceitar `store_id` arbitrário sem validação de autorização.
- `POST /driver-admin/{driverId}/reset-password`: gestor autorizado redefine credencial temporária e exige troca no próximo acesso. Auditar operador e invalidar sessões anteriores.
- `PATCH /driver-admin/{driverId}`: editar dados operacionais e status ativo/inativo, sem permitir alterar identidade de outro estabelecimento.
- `GET /driver-admin`: listar apenas entregadores vinculados à loja autorizada.

## Operações do entregador
- `POST /driver-auth/sign-in`: telefone e senha via HTTPS, rate limit; backend devolve sessão curta e indicação `must_change_password`. Resposta genérica em caso de falha.
- `POST /driver-auth/change-password`: autenticado com sessão restrita de primeiro acesso; recebe nova senha e confirma alteração, revoga credencial temporária.
- `POST /driver-auth/sign-out`: revoga sessão.
- `GET /driver/me`: retorna apenas identidade e vínculos autorizados, sem segredos.
- `GET /driver/assignments`: somente pedidos atualmente atribuídos ao usuário autenticado.
- `POST /driver/assignments/{id}/collect`, `/depart`, `/complete`: validar atribuição atual, versão e idempotência; concluir somente após regras de código e pagamento.

## Respostas de exemplo
```json
{
  "driver_id": "uuid",
  "display_name": "Entregador",
  "must_change_password": true,
  "store_memberships": [{"store_id": "uuid", "active": true}]
}
```

## Pré-condições para produção
1. Inspecionar schema real do Supabase e fluxo de autenticação existente, evitando duplicação de tabelas.
2. Confirmar estratégia suportada para telefone + senha com Supabase Auth, sem criar autenticação insegura paralela.
3. Implementar endpoints administrativos protegidos e RLS.
4. Testar revogação de sessões, reset, troca obrigatória, múltiplas lojas e bloqueio.
5. Integrar UI com estados de carregamento, falha e sessão expirada.
6. Somente então publicar `entregador.pitacco.com.br` com autenticação real.

## Importante
Não utilizar senha padrão universal `1234` em produção. Ela é trivial de adivinhar; credencial inicial deve ser individual e temporária, embora o fluxo de redefinição permaneça controlado pelo lojista.
