# Reforço de privilégios — 2026-11-17

No Supabase do Pitacco, a inspeção de `information_schema.role_table_grants` identificou `TRUNCATE` concedido a `anon` e `authenticated` em `public.couriers`, e a `authenticated` em `public.deliveries` e `public.orders`.

Foi aplicada no projeto `mdevzehqcpcgxspwbiyz` a migração `revoke_public_truncate_from_delivery_tables`:

```sql
revoke truncate on table public.couriers from anon, authenticated;
revoke truncate on table public.deliveries, public.orders from authenticated;
```

Consulta posterior em `information_schema.role_table_grants` retornou **zero permissões TRUNCATE** para esses papéis nessas três tabelas.

Esta correção não substitui a auditoria de `SECURITY DEFINER`, `REFERENCES`, `TRIGGER`, nem os testes RLS com JWTs distintos. Não foram executados testes end-to-end de entregador e lojista.
