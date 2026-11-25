alter table pitacco_private.pagbank_sandbox_accounts add column provider_account_id text;
update pitacco_private.pagbank_sandbox_accounts a set provider_account_id=v.decrypted_secret::jsonb->>'account_id' from vault.decrypted_secrets v where v.id=a.secret_id;
alter table pitacco_private.pagbank_sandbox_accounts alter column provider_account_id set not null;
alter table pitacco_private.pagbank_sandbox_accounts add constraint pagbank_sandbox_unique_seller unique(provider_account_id), add constraint pagbank_sandbox_seller_format check(provider_account_id ~ '^ACCO_[A-Za-z0-9-]{8,80}$');
create function pitacco_private.pagbank_sandbox_account_guard() returns trigger language plpgsql set search_path='' as $$
declare seller text; platform text;
begin
 select decrypted_secret::jsonb->>'account_id' into seller from vault.decrypted_secrets where id=new.secret_id;
 select v.decrypted_secret::jsonb->>'account_id' into platform from pitacco_private.pagbank_sandbox_registration r join vault.decrypted_secrets v on v.id=r.credential_secret_id where r.singleton and r.status='registered';
 if seller is null or platform is null or seller=platform then raise exception 'PagBank: a loja precisa autorizar uma conta de vendedor diferente da conta da plataforma'; end if;
 if tg_op='UPDATE' and (new.store_id is distinct from old.store_id or seller is distinct from old.provider_account_id) then raise exception 'PagBank: troca de titular requer novo fluxo de autorização'; end if;
 new.provider_account_id:=seller;
 return new;
end $$;
revoke all on function pitacco_private.pagbank_sandbox_account_guard() from public,anon,authenticated;
create trigger pagbank_sandbox_account_guard before insert or update on pitacco_private.pagbank_sandbox_accounts for each row execute function pitacco_private.pagbank_sandbox_account_guard();
alter table pitacco_private.pagbank_sandbox_pix add column provider_account_id text;
update pitacco_private.pagbank_sandbox_pix p set provider_account_id=a.provider_account_id from pitacco_private.pagbank_sandbox_accounts a where p.store_id=a.store_id;
alter table pitacco_private.pagbank_sandbox_pix add constraint pagbank_sandbox_charge_seller check(store_id is null or provider_account_id is not null);
create function pitacco_private.pagbank_sandbox_charge_guard() returns trigger language plpgsql set search_path='' as $$
begin
 if tg_op='INSERT' then
  if new.store_id is null then raise exception 'PagBank: a cobrança exige uma loja vinculada'; end if;
  select provider_account_id into new.provider_account_id from pitacco_private.pagbank_sandbox_accounts where store_id=new.store_id and (expires_at is null or expires_at>now());
  if new.provider_account_id is null then raise exception 'PagBank: conta individual indisponível'; end if;
 elsif new.store_id is distinct from old.store_id or new.provider_account_id is distinct from old.provider_account_id or new.cents is distinct from old.cents then
  raise exception 'PagBank: titular e valor da cobrança são imutáveis';
 end if;
 return new;
end $$;
revoke all on function pitacco_private.pagbank_sandbox_charge_guard() from public,anon,authenticated;
create trigger pagbank_sandbox_charge_guard before insert or update on pitacco_private.pagbank_sandbox_pix for each row execute function pitacco_private.pagbank_sandbox_charge_guard();
create function pitacco_private.pagbank_sandbox_state_guard() returns trigger language plpgsql set search_path='' as $$
begin
 if new.actor is null or not (exists(select 1 from public.store_members m where m.store_id=new.store_id and m.user_id=new.actor and m.role='gestor') or exists(select 1 from pitacco_private.platform_owner o where o.user_id=new.actor)) then raise exception 'PagBank: autorização exige gestor autenticado da loja'; end if;
 if tg_op='UPDATE' and (new.actor is distinct from old.actor or new.store_id is distinct from old.store_id or new.state is distinct from old.state) then raise exception 'PagBank: autorização não transferível'; end if;
 return new;
end $$;
revoke all on function pitacco_private.pagbank_sandbox_state_guard() from public,anon,authenticated;
create trigger pagbank_sandbox_state_guard before insert or update on pitacco_private.pagbank_sandbox_states for each row execute function pitacco_private.pagbank_sandbox_state_guard();