create or replace function public.pitacco_quote_pizza_config(p_config jsonb,p_size text,p_flavors jsonb,p_extras jsonb) returns jsonb
language plpgsql immutable security invoker set search_path='' as $$
declare c jsonb; s jsonb; f jsonb; x jsonb; v jsonb; id text; seen text[]:=array[]::text[]; kinds text[]:=array[]::text[]; amounts bigint[]:=array[]::bigint[]; a bigint; base bigint; extra bigint:=0; mods jsonb:='[]'; n integer;
begin
 c:=public.pitacco_normalize_pizza_draft(p_config);
 select value into s from jsonb_array_elements(c->'sizes') where value->>'id'=p_size;
 if s is null then raise exception 'Tamanho indisponível'; end if;
 if jsonb_typeof(p_flavors) is distinct from 'array' or jsonb_typeof(p_extras) is distinct from 'array' then raise exception 'Seleção inválida'; end if;
 n:=jsonb_array_length(p_flavors);
 if n not between 1 and (s->>'maxFlavors')::integer or jsonb_array_length(p_extras)>100 then raise exception 'Quantidade de escolhas inválida';end if;
 for v in select value from jsonb_array_elements(p_flavors) loop
  if jsonb_typeof(v)<>'string' then raise exception 'Sabor inválido'; end if;
  id:=v#>>'{}';
  if id=any(seen) then raise exception 'Sabor repetido';end if;
  seen:=array_append(seen,id);
  select value into f from jsonb_array_elements(c->'flavors') where value->>'id'=id and coalesce((value->>'available')::boolean,true) and (value->'prices') ? p_size;
  if f is null then raise exception 'Sabor indisponível para este tamanho'; end if;
  a:=(f->'prices'->>p_size)::bigint;
  amounts:=array_append(amounts,a);
  mods:=mods||jsonb_build_array(jsonb_build_object('id',id,'name',f->>'name','kind','Sabor','numerator',1,'denominator',n));
 end loop;
 case c->>'rule'
 when 'max' then select max(z) into base from unnest(amounts) z;
 when 'min' then select min(z) into base from unnest(amounts) z;
 when 'avg' then select round(avg(z))::bigint into base from unnest(amounts) z;
 when 'fixed' then base:=(s->>'fixedPrice')::bigint;
 else raise exception 'Regra inválida';
 end case;
 seen:=array[]::text[];
 for v in select value from jsonb_array_elements(p_extras) loop
  if jsonb_typeof(v)<>'string' then raise exception 'Adicional inválido';end if;
  id:=v#>>'{}';
  if id=any(seen) then raise exception 'Adicional repetido';end if;
  seen:=array_append(seen,id);
  select value into x from jsonb_array_elements(c->'extras') where value->>'id'=id and coalesce((value->>'available')::boolean,true) and (value->'prices') ? p_size;
  if x is null then raise exception 'Adicional indisponível para este tamanho';end if;
  if x->>'kind' in ('Borda','Massa') and (x->>'kind')=any(kinds) then raise exception 'Escolha apenas uma borda e uma massa';end if;
  kinds:=array_append(kinds,x->>'kind');
  a:=(x->'prices'->>p_size)::bigint; extra:=extra+a;
  mods:=mods||jsonb_build_array(jsonb_build_object('id',id,'name',x->>'name','kind',x->>'kind','price_cents',a));
 end loop;
 return jsonb_build_object('size_id',p_size,'size_name',s->>'name','base_cents',base,'extras_cents',extra,'total_cents',base+extra,'modifiers',mods,'rule',c->>'rule');
end $$;
revoke all on function public.pitacco_quote_pizza_config(jsonb,text,jsonb,jsonb) from public,anon;
grant execute on function public.pitacco_quote_pizza_config(jsonb,text,jsonb,jsonb) to authenticated;
create or replace function public.pitacco_quote_pizza_draft(p_store uuid,p_draft uuid,p_size text,p_flavors jsonb,p_extras jsonb) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare c jsonb;
begin
 if auth.uid() is null or not coalesce(public.is_store_manager(p_store),false) then raise exception 'Sem permissão';end if;
 select config into c from public.pitacco_pizza_drafts where store_id=p_store and id=p_draft;
 if not found then raise exception 'Pizza indisponível';end if;
 return public.pitacco_quote_pizza_config(c,p_size,p_flavors,p_extras);
end $$;
revoke all on function public.pitacco_quote_pizza_draft(uuid,uuid,text,jsonb,jsonb) from public,anon;
grant execute on function public.pitacco_quote_pizza_draft(uuid,uuid,text,jsonb,jsonb) to authenticated;

