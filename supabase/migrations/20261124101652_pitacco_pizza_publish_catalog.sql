CREATE OR REPLACE FUNCTION pitacco_private.pizza_checkout_options(p_store uuid, p_product uuid, p_options jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
declare c jsonb; p numeric; chosen text[]; size_ids text[]; flavors jsonb; extras jsonb; q jsonb; mods jsonb; normalized jsonb;
begin
 select pc.config,pr.price into c,p from pitacco_private.pizza_catalog pc join public.products pr on pr.id=pc.product_id and pr.store_id=pc.store_id where pc.product_id=p_product and pc.store_id=p_store and pr.menu_active;
 if not found then raise exception 'Pizza indisponível';end if;
 if jsonb_typeof(p_options) is distinct from 'array' or jsonb_array_length(p_options) not between 2 and 100 then raise exception 'Montagem inválida';end if;
 if exists(select 1 from jsonb_array_elements(p_options) v where jsonb_typeof(v)<>'string' or (v#>>'{}') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$') then raise exception 'Opção inválida';end if;
 select array_agg(v order by v) into chosen from jsonb_array_elements_text(p_options) v;
 if cardinality(chosen)<>(select count(distinct v) from unnest(chosen) v) then raise exception 'Opção repetida';end if;
 normalized:=public.pitacco_normalize_pizza_draft(c);
 select array_agg(v->>'id') into size_ids from jsonb_array_elements(normalized->'sizes') v where (v->>'id')=any(chosen);
 if coalesce(cardinality(size_ids),0)<>1 then raise exception 'Escolha exatamente um tamanho';end if;
 select coalesce(jsonb_agg(v->>'id' order by v->>'id'),'[]') into flavors from jsonb_array_elements(normalized->'flavors') v where (v->>'id')=any(chosen);
 select coalesce(jsonb_agg(v->>'id' order by v->>'id'),'[]') into extras from jsonb_array_elements(normalized->'extras') v where (v->>'id')=any(chosen);
 if cardinality(chosen)<>1+jsonb_array_length(flavors)+jsonb_array_length(extras) then raise exception 'Opção não pertence à pizza';end if;
 q:=public.pitacco_quote_pizza_config(c,size_ids[1],flavors,extras);
 if (q->>'base_cents')::numeric/100<p then raise exception 'Preço de catálogo inconsistente';end if;
 mods:=jsonb_build_array(jsonb_build_object('option_id',size_ids[1],'group','Tamanho','name',q->>'size_name','price',(q->>'base_cents')::numeric/100-p));
 select mods||coalesce(jsonb_agg(jsonb_build_object('option_id',v->>'id','group',v->>'kind','name',v->>'name','price',coalesce((v->>'price_cents')::numeric,0)/100,'numerator',v->'numerator','denominator',v->'denominator')),'[]') into mods from jsonb_array_elements(q->'modifiers') v;
 return jsonb_build_object('modifiers',mods,'extra',(q->>'total_cents')::numeric/100-p,'canonical',to_jsonb(chosen));
end $function$;
create or replace function public.pitacco_publish_pizza(p_store uuid,p_draft uuid,p_active boolean default true) returns jsonb
language plpgsql security definer set search_path='' as $$
declare d public.pitacco_pizza_drafts%rowtype; c jsonb; n jsonb; meta jsonb; pid uuid; min_price numeric; ids text[]; active boolean;
begin
 if auth.uid() is null or not coalesce(public.is_store_manager(p_store),false) then raise exception 'Sem permissão';end if;
 if p_active is null then raise exception 'Status inválido';end if;
 select * into d from public.pitacco_pizza_drafts where store_id=p_store and id=p_draft for update;
 if not found then raise exception 'Cadastro de pizza indisponível';end if;
 c:=d.config-'normalized';n:=public.pitacco_normalize_pizza_draft(c);meta:=coalesce(c->'metadata','{}');
 select array_agg(x->>'id') into ids from jsonb_array_elements((n->'sizes')||(n->'flavors')||(n->'extras')) x;
 if exists(select 1 from unnest(ids) x where x !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$') or cardinality(ids)<>(select count(distinct x) from unnest(ids) x) then raise exception 'Identificadores de opções inválidos ou repetidos';end if;
 select min(case when n->>'rule'='fixed' then (s->>'fixedPrice')::numeric else (f->'prices'->>(s->>'id'))::numeric end)/100
 into min_price from jsonb_array_elements(n->'sizes') s cross join jsonb_array_elements(n->'flavors') f
 where coalesce((f->>'available')::boolean,true) and (f->'prices') ? (s->>'id');
 if min_price is null or min_price<=0 or min_price>10000 then raise exception 'Informe preços de venda válidos';end if;
 if exists(select 1 from jsonb_array_elements(n->'sizes') s where (s->>'maxFlavors')::integer>99) then raise exception 'Limite de sabores inválido';end if;
 select pc.product_id into pid from pitacco_private.pizza_catalog pc where pc.draft_id=p_draft and pc.store_id=p_store;
 if pid is null then
  insert into public.products(store_id,name,price,cost,menu_active,category,description,image_url) values(p_store,d.name,min_price,0,p_active,coalesce(nullif(btrim(meta->>'category'),''),'Pizzas'),left(coalesce(meta->>'description',''),1200),left(coalesce(meta->>'image_url',''),2048)) returning id into pid;
  insert into pitacco_private.pizza_catalog(product_id,store_id,draft_id,config) values(pid,p_store,p_draft,c);
 else
  perform 1 from public.products where id=pid and store_id=p_store for update;
  if not found then raise exception 'Produto indisponível';end if;
  update pitacco_private.pizza_catalog set config=c,updated_at=now() where product_id=pid and store_id=p_store;
  update public.products set name=d.name,price=min_price,menu_active=p_active,category=coalesce(nullif(btrim(meta->>'category'),''),'Pizzas'),description=left(coalesce(meta->>'description',''),1200),image_url=left(coalesce(meta->>'image_url',''),2048) where id=pid and store_id=p_store;
 end if;
 return jsonb_build_object('published',true,'product_id',pid,'draft_id',p_draft,'active',p_active,'price',min_price);
end $$;
revoke all on function public.pitacco_publish_pizza(uuid,uuid,boolean) from public,anon,authenticated;
grant execute on function public.pitacco_publish_pizza(uuid,uuid,boolean) to authenticated;
create or replace function public.pitacco_pizza_publication_status(p_store uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
 if auth.uid() is null or not coalesce(public.is_store_manager(p_store),false) then raise exception 'Sem permissão';end if;
 return coalesce((select jsonb_agg(jsonb_build_object('draft_id',pc.draft_id,'product_id',pc.product_id,'active',p.menu_active,'price',p.price)) from pitacco_private.pizza_catalog pc join public.products p on p.id=pc.product_id and p.store_id=pc.store_id where pc.store_id=p_store),'[]');
end $$;
revoke all on function public.pitacco_pizza_publication_status(uuid) from public,anon,authenticated;
grant execute on function public.pitacco_pizza_publication_status(uuid) to authenticated;

