create table pitacco_private.ifood_store_controls (
  store_id uuid primary key references public.stores(id) on delete cascade,
  paused boolean not null
);
revoke all on pitacco_private.ifood_store_controls from public,anon,authenticated;

create function pitacco_private.ifood_store_receives(p_store uuid,p_test boolean)
returns boolean language sql stable set search_path='' as $$
  select p_test or not exists (
    select 1 from pitacco_private.ifood_store_controls where store_id=p_store and paused
  )
$$;
revoke all on function pitacco_private.ifood_store_receives(uuid,boolean) from public,anon,authenticated;

create function public.pitacco_owner_ifood_store_status(p_store uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
  if not public.pitacco_is_platform_owner() then
    raise exception 'Somente o proprietário pode consultar o controle do iFood' using errcode='42501';
  end if;
  if not exists(select 1 from public.stores where id=p_store) then raise exception 'Loja indisponível'; end if;
  return jsonb_build_object(
    'paused',not pitacco_private.ifood_store_receives(p_store,false),
    'linking_released',(select merchant_linking from pitacco_private.ifood_control),
    'connections',(select count(*) from pitacco_private.ifood_merchants where store_id=p_store and not test_only),
    'enabled_connections',(select count(*) from pitacco_private.ifood_merchants where store_id=p_store and enabled and not test_only)
  );
end $$;

create function public.pitacco_owner_set_ifood_store_pause(p_store uuid,p_paused boolean)
returns jsonb language plpgsql security definer set search_path='' as $$
begin
  if not public.pitacco_is_platform_owner() then
    raise exception 'Somente o proprietário pode alterar o recebimento do iFood' using errcode='42501';
  end if;
  if p_paused is null then raise exception 'Informe o novo estado do recebimento'; end if;
  perform 1 from public.stores where id=p_store for update;
  if not found then raise exception 'Loja indisponível'; end if;
  if p_paused is distinct from (not pitacco_private.ifood_store_receives(p_store,false)) then
    insert into pitacco_private.ifood_store_controls(store_id,paused) values(p_store,p_paused)
    on conflict(store_id) do update set paused=excluded.paused;
    insert into public.operation_audit(store_id,actor,action,details)
    values(p_store,auth.uid(),case when p_paused then 'ifood_store_paused' else 'ifood_store_resumed' end,'{}'::jsonb);
  end if;
  return public.pitacco_owner_ifood_store_status(p_store);
end $$;

revoke all on function public.pitacco_owner_ifood_store_status(uuid),public.pitacco_owner_set_ifood_store_pause(uuid,boolean)
from public,anon,authenticated;
grant execute on function public.pitacco_owner_ifood_store_status(uuid),public.pitacco_owner_set_ifood_store_pause(uuid,boolean)
to authenticated;

-- Keep individual OAuth permissions intact. A paused store can refresh its credentials,
-- while polling and order processing remain gated. Queued events stay available to retry.
do $migration$
declare
  target regprocedure;
  old_text text;
  new_text text;
  definition text;
begin
  for target,old_text,new_text in
    select patch.sig::regprocedure,patch.old_text,patch.new_text from (values
      ('public.pitacco_ifood_connections(uuid)',
       'select m.merchant_id,m.test_only,m.enabled',
       'select m.merchant_id,m.test_only,(m.enabled and pitacco_private.ifood_store_receives(m.store_id,m.test_only))'),
      ('public.pitacco_ifood_online(uuid[])',
       'where enabled and credential is null',
       'where enabled and pitacco_private.ifood_store_receives(store_id,test_only) and credential is null'),
      ('public.pitacco_ifood_claim(uuid)',
       'and e.attempts<10 and m.enabled',
       'and e.attempts<10 and m.enabled and pitacco_private.ifood_store_receives(m.store_id,m.test_only)'),
      ('public.pitacco_ifood_claim_poll()',
       'where m.enabled and m.credential is not null',
       'where m.enabled and m.credential is not null and pitacco_private.ifood_store_receives(m.store_id,m.test_only)'),
      ('public.pitacco_ifood_complete(uuid,uuid,jsonb,boolean)',
       'select * into m from pitacco_private.ifood_merchants where merchant_id=e.merchant_id and enabled for share;',
       'select * into m from pitacco_private.ifood_merchants where merchant_id=e.merchant_id and enabled and pitacco_private.ifood_store_receives(store_id,test_only) for share;')
    ) as patch(sig,old_text,new_text)
  loop
    definition:=pg_get_functiondef(target);
    if strpos(definition,old_text)=0 then
      raise exception 'O fluxo de recepção iFood mudou em %',target;
    end if;
    execute replace(definition,old_text,new_text);
  end loop;
end $migration$;
