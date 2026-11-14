create table public.pitacco_marketplace_settlements (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id),
  provider text not null check(provider in ('ifood','99food','keeta')),
  account_reference text not null check(length(btrim(account_reference)) between 1 and 120),
  settlement_reference text not null check(length(btrim(settlement_reference)) between 1 and 120),
  settled_on date not null,
  imported_at timestamptz not null default now(),
  imported_by uuid not null,
  lines jsonb not null,
  unique(store_id,provider,account_reference,settlement_reference)
);
create index pitacco_marketplace_settlement_history on public.pitacco_marketplace_settlements(store_id,settled_on desc);
alter table public.pitacco_marketplace_settlements enable row level security;
revoke all on public.pitacco_marketplace_settlements from public,anon,authenticated;
grant select(id,store_id,provider,account_reference,settlement_reference,settled_on,imported_at)
  on public.pitacco_marketplace_settlements to authenticated;
create policy pitacco_marketplace_settlements_read on public.pitacco_marketplace_settlements
  for select to authenticated using(public.is_store_manager(store_id));

create function public.pitacco_import_marketplace_settlement(
  p_store uuid,p_provider text,p_account text,p_reference text,p_settled_on date,p_lines jsonb
) returns uuid language plpgsql security definer set search_path='' as $function$
declare
  canonical jsonb;
  entry jsonb;
  existing public.pitacco_marketplace_settlements%rowtype;
  imported uuid;
begin
  if auth.uid() is null or not public.is_store_manager(p_store) then raise exception 'Sem permissão para importar repasses desta loja'; end if;
  p_account:=btrim(p_account);
  p_reference:=btrim(p_reference);
  if p_store is null or p_provider is null or p_provider not in ('ifood','99food','keeta')
     or p_account is null or length(p_account) not between 1 and 120 or p_reference is null or length(p_reference) not between 1 and 120
     or p_settled_on is null or jsonb_typeof(p_lines) is distinct from 'array' then
    raise exception 'Informe a plataforma, a conta, a referência, a data e as linhas do repasse';
  end if;
  if jsonb_array_length(p_lines) not between 1 and 500 or octet_length(p_lines::text)>120000 then
    raise exception 'O CSV deve conter entre 1 e 500 pedidos';
  end if;

  for entry in select value from jsonb_array_elements(p_lines) loop
    if jsonb_typeof(entry) is distinct from 'object' or (entry-array['external_order','net'])<>'{}'::jsonb
       or jsonb_typeof(entry->'external_order') is distinct from 'string'
       or length(btrim(entry->>'external_order')) not between 1 and 120
       or jsonb_typeof(entry->'net') is distinct from 'string'
       or entry->>'net' !~ '^-?[0-9]{1,7}(\.[0-9]{1,2})?$' then
      raise exception 'Uma linha tem pedido externo ou valor líquido inválido';
    end if;
  end loop;
  if (select count(distinct btrim(line->>'external_order')) from jsonb_array_elements(p_lines) line)<>jsonb_array_length(p_lines) then
    raise exception 'O repasse contém o mesmo pedido externo em mais de uma linha';
  end if;
  select jsonb_agg(jsonb_build_object('external_order',btrim(line->>'external_order'),'net',(line->>'net')::numeric)
    order by btrim(line->>'external_order'))
  into canonical from jsonb_array_elements(p_lines) line;

  insert into public.pitacco_marketplace_settlements(store_id,provider,account_reference,settlement_reference,settled_on,imported_by,lines)
    values(p_store,p_provider,p_account,p_reference,p_settled_on,auth.uid(),canonical)
    on conflict (store_id,provider,account_reference,settlement_reference) do nothing
    returning id into imported;
  if imported is not null then return imported; end if;

  select * into existing from public.pitacco_marketplace_settlements
    where store_id=p_store and provider=p_provider and account_reference=p_account and settlement_reference=p_reference;
  if existing.settled_on is distinct from p_settled_on or existing.lines is distinct from canonical then
    raise exception 'Esta referência já foi importada com dados diferentes';
  end if;
  return existing.id;
end;
$function$;

create function public.pitacco_marketplace_settlement_report(p_settlement uuid)
returns table(external_order text,reported_net numeric,recorded_net numeric,difference numeric,status text)
language plpgsql stable security definer set search_path='' as $function$
declare batch public.pitacco_marketplace_settlements%rowtype;
begin
  select * into batch from public.pitacco_marketplace_settlements
    where id=p_settlement and auth.uid() is not null and public.is_store_manager(store_id);
  if not found then raise exception 'Repasse indisponível para este usuário'; end if;

  return query
    select line.external_order,line.net,
      case when match.count=1 then match.amount end,
      case when match.count=1 then line.net-match.amount end,
      case when match.count=0 then 'unmatched' when match.count>1 then 'ambiguous'
           when line.net=match.amount then 'matched' else 'different' end
    from jsonb_to_recordset(batch.lines) as line(external_order text,net numeric)
    cross join lateral (
      select count(*) as count,max(o.gross-o.fees) as amount
        from public.orders o
        where o.store_id=batch.store_id and o.source=batch.provider and o.status in ('accepted','historical')
          and (nullif(o.receipt->>'external_account_id','') is null or o.receipt->>'external_account_id'=batch.account_reference)
          and (o.receipt->>'external_order_id'=line.external_order
            or exists(select 1 from public.marketplace_acceptance_requests a
              where a.store_id=batch.store_id and a.order_id=o.id and a.source=batch.provider and a.external_order_id=line.external_order))
    ) match
    order by line.external_order;
end;
$function$;

revoke all on function public.pitacco_import_marketplace_settlement(uuid,text,text,text,date,jsonb),
  public.pitacco_marketplace_settlement_report(uuid) from public,anon;
grant execute on function public.pitacco_import_marketplace_settlement(uuid,text,text,text,date,jsonb),
  public.pitacco_marketplace_settlement_report(uuid) to authenticated;
