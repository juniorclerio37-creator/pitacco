-- Garante a emissão por pedido em bases novas/restauradas.
-- A função já existe pela migration anterior e respeita a regra da loja.
drop trigger if exists pitacco_issue_own_delivery_code on public.deliveries;
create trigger pitacco_issue_own_delivery_code
after insert on public.deliveries
for each row execute function pitacco_private.issue_own_delivery_code();