-- Loja de Testes Açaí do Linho: consolidar as 142 associações legadas
-- em modelos centrais sem trocar IDs de grupos/opções nem alterar o cardápio público.
-- Pré-requisitos: 23 produtos, 142 grupos, 1216 opções, sem modelos/links existentes.
-- Variações de opções/preços/limites/imagens/ordem permanecem separadas.
create table if not exists pitacco_private.menu_centralization_backups (
 store_id uuid primary key references public.stores(id),
 created_at timestamptz not null default now(),
 before_group_count integer not null,
 before_option_count integer not null,
 before_public_menu_hash text not null,
 snapshot jsonb not null
);
alter table pitacco_private.menu_centralization_backups enable row level security;
revoke all on pitacco_private.menu_centralization_backups from public,anon,authenticated;

do $centralize$
declare
 v_store constant uuid:='1481c0c6-5b87-4737-9d1a-96ae5c1615d9';
 v_total_groups integer; v_total_options integer; v_total_templates integer; v_linked integer;
 v_variants integer; v_saved_groups integer; v_saved_options integer; v_template_rank integer:=0;
 v_before_menu jsonb; v_before_detail jsonb; v_after_detail jsonb;
 v_template_id uuid; v_options jsonb;
 v_variant record;
begin
 perform pg_advisory_xact_lock(hashtextextended(v_store::text,4141));
 select count(*) into v_total_groups from public.product_option_groups where store_id=v_store;
 select count(*) into v_total_options from public.product_options where store_id=v_store;
 select count(*) into v_total_templates from public.pitacco_complement_templates where store_id=v_store;
 select count(*) into v_linked from public.product_option_groups where store_id=v_store and library_template_id is not null;

 if exists(select 1 from pitacco_private.menu_centralization_backups where store_id=v_store) then
  if v_total_groups=142 and v_total_options=1216 and v_total_templates=18 and v_linked=142
    and (select count(*) from public.product_options where store_id=v_store and library_option_id is not null)=1216
  then return; end if;
  raise exception 'Consolidação anterior detectada em estado divergente. Revisar antes de prosseguir.';
 end if;
 if v_total_groups<>142 or v_total_options<>1216 or v_total_templates<>0 or v_linked<>0 then
  raise exception 'Os dados mudaram desde a análise (grupos %, opções %, modelos %, vínculos %). Não consolidar automaticamente.',
   v_total_groups,v_total_options,v_total_templates,v_linked;
 end if;
 if (select count(*) from public.product_options where store_id=v_store and library_option_id is not null)<>0 then
  raise exception 'Existem opções com ID de biblioteca anterior. Interrompido.';
 end if;

 v_before_menu:=public.get_public_menu('acai-do-linho-demo');
 v_before_detail:=jsonb_build_object(
  'groups',coalesce((select jsonb_agg(to_jsonb(g)-'library_template_id' order by g.id)
             from public.product_option_groups g where g.store_id=v_store),'[]'::jsonb),
  'options',coalesce((select jsonb_agg(to_jsonb(o)-'library_option_id' order by o.id)
             from public.product_options o where o.store_id=v_store),'[]'::jsonb)
 );

 insert into pitacco_private.menu_centralization_backups(
   store_id,before_group_count,before_option_count,before_public_menu_hash,snapshot)
 values(v_store,v_total_groups,v_total_options,md5(v_before_menu::text),
  jsonb_build_object(
   'groups',(select jsonb_agg(to_jsonb(g) order by g.id) from public.product_option_groups g where g.store_id=v_store),
   'options',(select jsonb_agg(to_jsonb(o) order by o.id) from public.product_options o where o.store_id=v_store),
   'templates',(select coalesce(jsonb_agg(to_jsonb(t) order by t.id),'[]'::jsonb) from public.pitacco_complement_templates t where t.store_id=v_store)
  ));

 create temporary table _linho_group_variants on commit drop as
 select g.id,g.product_id,g.name,g.min_select,g.max_select,g.enabled,g.sort_order,
  coalesce((
   select jsonb_agg(
    jsonb_build_array(o.name,o.additional_price,o.available,coalesce(o.image_url,''),o.sort_order)
    order by o.sort_order,o.name,o.additional_price,o.available,coalesce(o.image_url,''),o.id)
   from public.product_options o where o.group_id=g.id
  ),'[]'::jsonb) as options_signature
 from public.product_option_groups g where g.store_id=v_store;

 select count(*) into v_variants from (
   select distinct name,min_select,max_select,enabled,options_signature from _linho_group_variants
 ) variants;
 if v_variants<>18 then raise exception 'A quantidade de configurações mudou: %; esperado 18',v_variants; end if;

 if exists(select 1 from (
   select product_id,name,min_select,max_select,enabled,options_signature,count(*) as qty
   from _linho_group_variants group by 1,2,3,4,5,6 having count(*)>1
 ) duplicate_groups) then
  raise exception 'Há dois grupos idênticos no mesmo produto. Exige revisão manual.';
 end if;

 create temporary table _linho_group_links (
  group_id uuid primary key,
  template_id uuid not null,
  representative_group_id uuid not null
 ) on commit drop;

 for v_variant in
  select name,min_select,max_select,enabled,options_signature,
    (array_agg(id order by id))[1] as representative_group_id,
    count(*) as associations
  from _linho_group_variants
  group by name,min_select,max_select,enabled,options_signature
  order by name,min_select,max_select,options_signature::text
 loop
  -- Cada opção do modelo recebe o ID da opção original da cópia representativa.
  -- Isto evita UUIDs artificiais e mantém o mapeamento de opções duplicadas estável.
  select coalesce(jsonb_agg(jsonb_build_object(
    'id',o.id,'name',o.name,'price',o.additional_price,'available',o.available,
    'image_url',coalesce(o.image_url,'')
  ) order by o.sort_order,o.name,o.additional_price,o.available,coalesce(o.image_url,''),o.id),'[]'::jsonb)
  into v_options
  from public.product_options o where o.group_id=v_variant.representative_group_id;

  v_template_rank:=v_template_rank+10;
  insert into public.pitacco_complement_templates(
    store_id,name,min_select,max_select,options,sort_order
  ) values(v_store,v_variant.name,v_variant.min_select,v_variant.max_select,v_options,v_template_rank)
  returning id into v_template_id;

  insert into _linho_group_links(group_id,template_id,representative_group_id)
  select id,v_template_id,v_variant.representative_group_id
  from _linho_group_variants
  where name=v_variant.name and min_select=v_variant.min_select
   and max_select=v_variant.max_select and enabled=v_variant.enabled
   and options_signature=v_variant.options_signature;
 end loop;

 if (select count(*) from _linho_group_links)<>142 then
  raise exception 'Nem todos os grupos receberam uma configuração equivalente';
 end if;

 update public.product_option_groups g
  set library_template_id=m.template_id
 from _linho_group_links m
 where g.store_id=v_store and g.id=m.group_id and g.library_template_id is null;
 get diagnostics v_saved_groups=row_count;
 if v_saved_groups<>142 then raise exception 'Vínculos incompletos: %/142',v_saved_groups;end if;

 -- Associar cada opção à opção canônica da mesma posição e conteúdo.
 -- Não altera IDs, nomes, preços, fotos, disponibilidade nem posições dos produtos.
 with ranking as (
  select o.id as option_id,o.group_id,m.representative_group_id,
   row_number() over(partition by o.group_id order by o.sort_order,o.name,o.additional_price,
    o.available,coalesce(o.image_url,''),o.id) as position
  from public.product_options o join _linho_group_links m on m.group_id=o.group_id
  where o.store_id=v_store
 ), representatives as (
  select o.id as canonical_option_id,o.group_id,
   row_number() over(partition by o.group_id order by o.sort_order,o.name,o.additional_price,
    o.available,coalesce(o.image_url,''),o.id) as position
  from public.product_options o
  where o.group_id in (select distinct representative_group_id from _linho_group_links)
 ), mapping as (
  select ranking.option_id,representatives.canonical_option_id
  from ranking join representatives
   on representatives.group_id=ranking.representative_group_id
   and representatives.position=ranking.position
 )
 update public.product_options o
   set library_option_id=m.canonical_option_id
 from mapping m where o.store_id=v_store and o.id=m.option_id and o.library_option_id is null;
 get diagnostics v_saved_options=row_count;
 if v_saved_options<>1216 then raise exception 'Opções vinculadas: %/1216',v_saved_options;end if;

 if (select count(*) from public.pitacco_complement_templates where store_id=v_store)<>18 then
  raise exception 'Número incorreto de modelos centrais';
 end if;
 if (select count(*) from public.product_option_groups where store_id=v_store and library_template_id is not null)<>142 then
  raise exception 'Nem todos os produtos estão vinculados aos grupos centrais';
 end if;

 v_after_detail:=jsonb_build_object(
  'groups',coalesce((select jsonb_agg(to_jsonb(g)-'library_template_id' order by g.id)
             from public.product_option_groups g where g.store_id=v_store),'[]'::jsonb),
  'options',coalesce((select jsonb_agg(to_jsonb(o)-'library_option_id' order by o.id)
             from public.product_options o where o.store_id=v_store),'[]'::jsonb)
 );
 if v_before_detail is distinct from v_after_detail then
  raise exception 'Os dados originais de grupos ou opções foram alterados. Revertendo.';
 end if;
 if v_before_menu is distinct from public.get_public_menu('acai-do-linho-demo') then
  raise exception 'O cardápio público mudou durante a consolidação. Revertendo.';
 end if;
 raise notice 'Consolidação concluída: % grupos vinculados, % complementos vinculados, 18 modelos; dados originais preservados.',
  v_saved_groups,v_saved_options;
end $centralize$;
