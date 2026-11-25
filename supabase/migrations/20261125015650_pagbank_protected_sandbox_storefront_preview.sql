create table pitacco_private.pagbank_sandbox_previews(
 token_hash bytea primary key, store_id uuid not null references public.stores(id), checkout_id uuid not null unique,
 expires_at timestamptz not null, created_at timestamptz not null default now()
);
alter table pitacco_private.pagbank_sandbox_previews enable row level security;
revoke all on pitacco_private.pagbank_sandbox_previews from public,anon,authenticated;
create function public.pitacco_pagbank_sandbox_preview(p_action text,p_token text,p_store uuid default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v pitacco_private.pagbank_sandbox_previews%rowtype; slug text; h bytea;
begin
 if p_token is null or p_token !~ '^[a-f0-9]{64}$' then raise exception 'Link de teste inválido';end if;
 h:=sha256(convert_to(p_token,'UTF8'));
 if p_action='start' then
  if not exists(select 1 from pitacco_private.pagbank_sandbox_accounts a join pitacco_private.ifood_merchants m on m.store_id=a.store_id and m.test_only where a.store_id=p_store and (a.expires_at is null or a.expires_at>now())) then raise exception 'Somente loja vinculada de homologação';end if;
  select m.slug into slug from public.public_menu_settings m where m.store_id=p_store and m.enabled and m.pickup_enabled;
  if slug is null then raise exception 'Ative a retirada no cardápio de teste';end if;
  if (select count(*) from pitacco_private.pagbank_sandbox_previews where store_id=p_store and created_at>now()-interval '1 minute')>=5 then raise exception 'Limite temporário de links';end if;
  insert into pitacco_private.pagbank_sandbox_previews(token_hash,store_id,checkout_id,expires_at) values(h,p_store,gen_random_uuid(),now()+interval '30 minutes') returning * into v;
 elsif p_action='validate' then
  select * into v from pitacco_private.pagbank_sandbox_previews where token_hash=h and expires_at>now();
  if not found then raise exception 'Link de teste inválido ou expirado';end if;
  if not exists(select 1 from pitacco_private.pagbank_sandbox_accounts a join pitacco_private.ifood_merchants m on m.store_id=a.store_id and m.test_only where a.store_id=v.store_id and (a.expires_at is null or a.expires_at>now())) then raise exception 'Conta de teste indisponível';end if;
  select m.slug into slug from public.public_menu_settings m where m.store_id=v.store_id and m.enabled and m.pickup_enabled;
  if slug is null then raise exception 'Cardápio de teste indisponível';end if;
 else raise exception 'Operação inválida';end if;
 return jsonb_build_object('store',v.store_id,'id',v.checkout_id,'slug',slug,'expires_at',v.expires_at);
end $$;
revoke all on function public.pitacco_pagbank_sandbox_preview(text,text,uuid) from public,anon,authenticated;
grant execute on function public.pitacco_pagbank_sandbox_preview(text,text,uuid) to service_role;