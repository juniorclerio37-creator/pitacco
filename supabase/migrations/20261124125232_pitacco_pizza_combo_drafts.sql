create table public.pitacco_combo_drafts(
 id uuid primary key default gen_random_uuid(),
 store_id uuid not null references public.stores(id) on delete cascade,
 name text not null check(length(btrim(name)) between 1 and 180),
 items jsonb not null check(jsonb_typeof(items)='array' and jsonb_array_length(items) between 2 and 15 and octet_length(items::text)<=24000),
 rule text not null check(rule in ('fixed','percent')),
 value integer not null check(value>0 and value<=1000000),
 updated_at timestamptz not null default now()
);
alter table public.pitacco_combo_drafts enable row level security;
revoke all on public.pitacco_combo_drafts from public,anon,authenticated;
grant select on public.pitacco_combo_drafts to authenticated;
create policy combo_drafts_manager_read on public.pitacco_combo_drafts for select to authenticated using(public.is_store_manager(store_id));
create or replace function pitacco_private.quote_pizza_combo(p_store uuid,p_items jsonb,p_rule text,p_value integer) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare line jsonb; p public.products%rowtype; opt jsonb; qty integer; cents bigint; total bigint:=0; count_units integer:=0; has_pizza boolean:=false; result jsonb:='[]'; final_cents bigint;
begin
 if jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items) not between 2 and 15 or octet_length(p_items::text)>24000 then raise exception 'Inclua de 2 a 15 itens no combo';end if;
 if p_rule is null or p_rule not in ('fixed','percent') or p_value is null or p_value not between 1 and 1000000 or (p_rule='percent' and p_value>=10000) then raise exception 'Regra de preço inválida';end if;
 for line in select value from jsonb_array_elements(p_items) loop
  if jsonb_typeof(line) is distinct from 'object' or (line-array['product_id','quantity','options'])<>'{}'::jsonb or coalesce(line->>'product_id','') !~ '^[0-9a-fA-F]{8}(-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}$' or jsonb_typeof(line->'quantity') is distinct from 'number' or coalesce(line->>'quantity','') !~ '^[0-9]{1,2}$' or jsonb_typeof(line->'options') is distinct from 'array' then raise exception 'Item do combo inválido';end if;
  qty:=(line->>'quantity')::integer;
  if qty not between 1 and 20 then raise exception 'Quantidade inválida';end if;
  count_units:=count_units+qty;
  if count_units>30 then raise exception 'Limite de 30 unidades por combo';end if;
  select * into p from public.products where id=(line->>'product_id')::uuid and store_id=p_store and menu_active;
  if not found then raise exception 'Produto indisponível para este combo';end if;
  has_pizza:=has_pizza or exists(select 1 from pitacco_private.pizza_catalog pc where pc.product_id=p.id and pc.store_id=p_store);
  opt:=public.pitacco_validate_item_options(p_store,p.id,line->'options');
  cents:=round((p.price+(opt->>'extra')::numeric)*100)::bigint;
  if cents<0 then raise exception 'Preço inválido';end if;
  total:=total+cents*qty;
  result:=result||jsonb_build_array(jsonb_build_object('product_id',p.id,'name',p.name,'quantity',qty,'options',opt->'canonical','modifiers',opt->'modifiers','unit_cents',cents));
 end loop;
 if not has_pizza then raise exception 'Inclua pelo menos uma pizza';end if;
 final_cents:=case when p_rule='fixed' then p_value else round(total*(10000-p_value)::numeric/10000)::bigint end;
 if final_cents not between 1 and 1000000 or final_cents>total then raise exception 'Preço do combo deve ser positivo e não superar a soma dos itens';end if;
 return jsonb_build_object('items',result,'subtotal_cents',total,'total_cents',final_cents,'discount_cents',total-final_cents);
end $$;
revoke all on function pitacco_private.quote_pizza_combo(uuid,jsonb,text,integer) from public,anon,authenticated;
create or replace function public.pitacco_combo_draft_quote(p_store uuid,p_items jsonb,p_rule text,p_value integer) returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
 if auth.uid() is null or not coalesce(public.is_store_manager(p_store),false) then raise exception 'Sem permissão';end if;
 return pitacco_private.quote_pizza_combo(p_store,p_items,p_rule,p_value);
end $$;
revoke all on function public.pitacco_combo_draft_quote(uuid,jsonb,text,integer) from public,anon,authenticated;
grant execute on function public.pitacco_combo_draft_quote(uuid,jsonb,text,integer) to authenticated;
create or replace function public.pitacco_save_combo_draft(p_store uuid,p_id uuid,p_name text,p_items jsonb,p_rule text,p_value integer) returns jsonb
language plpgsql security definer set search_path='' as $$
declare q jsonb; saved uuid;
begin
 if auth.uid() is null or not coalesce(public.is_store_manager(p_store),false) then raise exception 'Sem permissão';end if;
 if coalesce(length(btrim(p_name)),0) not between 1 and 180 then raise exception 'Informe o nome do combo';end if;
 q:=pitacco_private.quote_pizza_combo(p_store,p_items,p_rule,p_value);
 if p_id is null then
  insert into public.pitacco_combo_drafts(store_id,name,items,rule,value) values(p_store,btrim(p_name),p_items,p_rule,p_value) returning id into saved;
 else
  update public.pitacco_combo_drafts set name=btrim(p_name),items=p_items,rule=p_rule,value=p_value,updated_at=now() where id=p_id and store_id=p_store returning id into saved;
  if not found then raise exception 'Combo indisponível';end if;
 end if;
 return q||jsonb_build_object('id',saved,'saved',true);
end $$;
revoke all on function public.pitacco_save_combo_draft(uuid,uuid,text,jsonb,text,integer) from public,anon,authenticated;
grant execute on function public.pitacco_save_combo_draft(uuid,uuid,text,jsonb,text,integer) to authenticated;

