-- O gatilho de checkout é invocado também em caminhos autenticados.
-- A função privada não deve exigir USAGE do schema privado ao usuário da loja.
-- Conceda acesso pelo trigger e nunca diretamente pelo cliente.
alter function pitacco_private.attach_cash_change_at_checkout() security definer;
revoke all on function pitacco_private.attach_cash_change_at_checkout() from public,anon,authenticated;
