create or replace function public.pitacco_normalize_pizza_draft(p jsonb) returns jsonb
language plpgsql immutable security invoker set search_path = '' as $$
declare
 s jsonb; r jsonb; k text; sid text; amount text; cents bigint; n integer; ids text[]; size_ids text[]:=array[]::text[]; available_sizes text[]:=array[]::text[]; prices jsonb; out_sizes jsonb:='[]'; out_flavors jsonb:='[]'; out_extras jsonb:='[]'; normalized_row jsonb;
begin
 if jsonb_typeof(p) is distinct from 'object' or coalesce(p->>'rule','') not in ('max','min','avg','fixed') then raise exception 'Regra de pizza inválida'; end if;
 if jsonb_typeof(p->'sizes') is distinct from 'array' or jsonb_typeof(p->'flavors') is distinct from 'array' or jsonb_typeof(p->'extras') is distinct from 'array' then raise exception 'Configuração de pizza inválida'; end if;
 if jsonb_array_length(p->'sizes') not between 1 and 100 or jsonb_array_length(p->'flavors') not between 1 and 200 or jsonb_array_length(p->'extras')>200 then raise exception 'Quantidade de opções inválida'; end if;
 for s in select value from jsonb_array_elements(p->'sizes') loop
  sid:=s->>'id';
  if jsonb_typeof(s->'id') is distinct from 'string' or coalesce(length(sid),0) not between 1 and 100 or sid=any(size_ids) or jsonb_typeof(s->'name') is distinct from 'string' or length(btrim(s->>'name')) not between 1 and 180 then raise exception 'Tamanho inválido'; end if;
  size_ids:=array_append(size_ids,sid); normalized_row:=s;
  foreach k in array array['diameter','slices','maxFlavors'] loop
   amount:=s->>k;
   if coalesce(amount,'') !~ '^[0-9]{1,3}$' then raise exception 'Medida inválida'; end if;
   n:=amount::integer;
   if n not between 1 and 100 then raise exception 'Medida inválida'; end if;
   normalized_row:=jsonb_set(normalized_row,array[k],to_jsonb(n));
  end loop;
  if (normalized_row->>'maxFlavors')::integer>(normalized_row->>'slices')::integer then raise exception 'Limite de sabores maior que número de fatias'; end if;
  if p->>'rule'='fixed' then
   amount:=replace(btrim(coalesce(s->>'fixedPrice','')),',','.');
   if amount !~ '^[0-9]{1,6}([.][0-9]{1,2})?$' then raise exception 'Preço fixo inválido'; end if;
   normalized_row:=jsonb_set(normalized_row,'{fixedPrice}',to_jsonb((amount::numeric*100)::bigint));
  end if;
  out_sizes:=out_sizes||jsonb_build_array(normalized_row);
 end loop;
 foreach k in array array['flavors','extras'] loop
  ids:=array[]::text[];
  for r in select value from jsonb_array_elements(p->k) loop
   sid:=r->>'id';
   if jsonb_typeof(r->'id') is distinct from 'string' or coalesce(length(sid),0) not between 1 and 100 or sid=any(ids) or jsonb_typeof(r->'name') is distinct from 'string' or length(btrim(r->>'name')) not between 1 and 180 or jsonb_typeof(r->'prices') is distinct from 'object' then raise exception 'Opção inválida'; end if;
   if r ? 'available' and jsonb_typeof(r->'available') is distinct from 'boolean' then raise exception 'Disponibilidade inválida'; end if;
   if k='extras' and coalesce(r->>'kind','') not in ('Borda','Massa','Adicional') then raise exception 'Tipo de adicional inválido'; end if;
   ids:=array_append(ids,sid); prices:='{}';
   foreach sid in array size_ids loop
    amount:=replace(btrim(coalesce(r->'prices'->>sid,'')),',','.');
    if amount='' then continue; end if;
    if amount !~ '^[0-9]{1,6}([.][0-9]{1,2})?$' then raise exception 'Preço inválido'; end if;
    cents:=(amount::numeric*100)::bigint;
    prices:=prices||jsonb_build_object(sid,cents);
    if k='flavors' and coalesce((r->>'available')::boolean,true) and not sid=any(available_sizes) then available_sizes:=array_append(available_sizes,sid); end if;
   end loop;
   normalized_row:=jsonb_set(r,'{prices}',prices);
   if k='flavors' then out_flavors:=out_flavors||jsonb_build_array(normalized_row); else out_extras:=out_extras||jsonb_build_array(normalized_row); end if;
  end loop;
 end loop;
 if not size_ids <@ available_sizes then raise exception 'Cada tamanho precisa de um sabor disponível'; end if;
 return jsonb_build_object('rule',p->>'rule','sizes',out_sizes,'flavors',out_flavors,'extras',out_extras);
end $$;
revoke all on function public.pitacco_normalize_pizza_draft(jsonb) from public,anon;
grant execute on function public.pitacco_normalize_pizza_draft(jsonb) to authenticated;
create or replace function public.pitacco_validate_pizza_draft() returns trigger
language plpgsql security invoker set search_path = '' as $$
begin
 new.config:=jsonb_set(new.config,'{normalized}',public.pitacco_normalize_pizza_draft(new.config));
 return new;
end $$;
revoke all on function public.pitacco_validate_pizza_draft() from public,anon;
grant execute on function public.pitacco_validate_pizza_draft() to authenticated;
drop trigger if exists validate_pizza_draft on public.pitacco_pizza_drafts;
create trigger validate_pizza_draft before insert or update of config on public.pitacco_pizza_drafts for each row execute function public.pitacco_validate_pizza_draft();

