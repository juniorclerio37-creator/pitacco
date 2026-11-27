begin;
insert into auth.users(id,email) values
 ('91000000-0000-0000-0000-000000000001','studio-manager@example.invalid'),
 ('91000000-0000-0000-0000-000000000002','studio-other@example.invalid');
insert into public.stores(id,name) values
 ('92000000-0000-0000-0000-000000000001','Estúdio Loja A'),
 ('92000000-0000-0000-0000-000000000002','Estúdio Loja B');
insert into public.store_members values
 ('92000000-0000-0000-0000-000000000001','91000000-0000-0000-0000-000000000001','gestor'),
 ('92000000-0000-0000-0000-000000000002','91000000-0000-0000-0000-000000000002','gestor');
insert into public.products(id,store_id,name,price,cost,menu_active) values
 ('93000000-0000-0000-0000-000000000001','92000000-0000-0000-0000-000000000001','Açaí Especial',25,6,true);
set local role authenticated;
select set_config('request.jwt.claim.sub','91000000-0000-0000-0000-000000000001',true);
do $test$
declare state jsonb; d jsonb; result jsonb; template_id text;
begin
 state:=public.pitacco_storefront_studio_state('92000000-0000-0000-0000-000000000001');
 assert state->>'draft_version'='0';
 assert state->'published'='null'::jsonb;
 -- Optional template: legacy drafts remain valid, invalid/extra keys rejected.
 foreach template_id in array array['pitacco-v2','essencial','editorial','urbano'] loop
 begin
  perform public.pitacco_storefront_save_draft('92000000-0000-0000-0000-000000000001',state->'draft'||jsonb_build_object('template',template_id),0);
  raise exception using errcode='PT001',message='template validated';
 exception when sqlstate 'PT001' then null;
 end;
 end loop;
 begin
  perform public.pitacco_storefront_save_draft('92000000-0000-0000-0000-000000000001',state->'draft'||'{"template":"legacy"}'::jsonb,0);
  raise exception 'Invalid template accepted';
 exception when raise_exception then
  if sqlerrm<>'Modelo de cardápio inválido' then raise;end if;
 end;
 d:=jsonb_set(state->'draft'||'{"template":"editorial"}'::jsonb,'{primary}','"#183e85"'::jsonb);
 d:=jsonb_set(d,'{banners}',jsonb_build_array(jsonb_build_object(
  'title','Combo da semana','subtitle','Um destaque da loja','image_path','',
  'starts_at',null,'ends_at',null,'product_id','93000000-0000-0000-0000-000000000001')));
 result:=public.pitacco_storefront_save_draft('92000000-0000-0000-0000-000000000001',d,0);
 assert result->>'draft_version'='1';
 assert (public.pitacco_storefront_studio_state('92000000-0000-0000-0000-000000000001')->'published')='null'::jsonb;
 begin
  perform public.pitacco_storefront_save_draft('92000000-0000-0000-0000-000000000001',d,0);
  raise exception 'Old draft revision must fail';
 exception when raise_exception then
  if sqlerrm not like 'O rascunho foi alterado%' then raise;end if;
 end;
 result:=public.pitacco_storefront_publish('92000000-0000-0000-0000-000000000001',1,0);
 assert result->>'published_version'='1';
 assert (public.pitacco_storefront_studio_state('92000000-0000-0000-0000-000000000001')->'published'->>'template')='editorial';
 assert (public.pitacco_storefront_studio_state('92000000-0000-0000-0000-000000000001')->'published'->>'primary')='#183e85';
 begin
  perform public.pitacco_storefront_publish('92000000-0000-0000-0000-000000000001',1,0);
  raise exception 'Old published revision must fail';
 exception when raise_exception then
  if sqlerrm not like 'Aparência alterada%' then raise;end if;
 end;
 d:=jsonb_set(d,'{primary}','"#d15723"'::jsonb);
 d:=d||'{"featured_colors":{"background":"#7320c5","border":"#edb600","price":"#ffff00","badge":"#ffffff","button":"#123456"}}'::jsonb;
 begin
  perform public.pitacco_storefront_save_draft('92000000-0000-0000-0000-000000000001',jsonb_set(d,'{featured_colors,background}','"url(https://example.invalid)"'::jsonb),1);
  raise exception 'Invalid featured color accepted';
 exception when raise_exception then
  if sqlerrm<>'Cores dos destaques inválidas' then raise;end if;
 end;
 d:=d||'{"logo_frame":{"size":120,"zoom":180,"x":-10,"y":5,"padding":3,"fit":"cover","shape":"circle"}}'::jsonb;
 begin
  perform public.pitacco_storefront_save_draft('92000000-0000-0000-0000-000000000001',jsonb_set(d,'{logo_frame,zoom}','999'::jsonb),1);
  raise exception 'Invalid logo zoom accepted';
 exception when raise_exception then
  if sqlerrm<>'Enquadramento do logotipo inválido' then raise;end if;
 end;
 perform public.pitacco_storefront_save_draft('92000000-0000-0000-0000-000000000001',d,1);
 perform public.pitacco_storefront_publish('92000000-0000-0000-0000-000000000001',2,1);
 result:=public.pitacco_storefront_restore_draft('92000000-0000-0000-0000-000000000001',1,2);
 assert result->>'draft_version'='3';
 state:=public.pitacco_storefront_studio_state('92000000-0000-0000-0000-000000000001');
 assert state->'draft'->>'primary'='#183e85';
 assert state->'published'->>'primary'='#d15723';
 assert jsonb_array_length(state->'history')=2;
 begin
  d:=jsonb_set(d,'{logo_path}','"stores/92000000-0000-0000-0000-000000000002/logo.png"'::jsonb);
  perform public.pitacco_storefront_save_draft('92000000-0000-0000-0000-000000000001',d,3);
  raise exception 'Cross-store image path must fail';
 exception when raise_exception then
  if sqlerrm <> 'Imagem fora do armazenamento da loja' then raise; end if;
 end;
end $test$;
select set_config('request.jwt.claim.sub','91000000-0000-0000-0000-000000000002',true);
do $test$
begin
 begin
  perform public.pitacco_storefront_studio_state('92000000-0000-0000-0000-000000000001');
  raise exception 'Foreign tenant should be blocked';
 exception when insufficient_privilege then null;end;
 begin
  perform public.pitacco_storefront_publish('92000000-0000-0000-0000-000000000001',3,2);
  raise exception 'Foreign tenant should not publish';
 exception when insufficient_privilege then null;end;
end $test$;
reset role;
do $test$
begin
 assert not has_table_privilege('authenticated','public.pitacco_storefront_designs','SELECT');
 assert not has_table_privilege('anon','public.pitacco_storefront_design_versions','SELECT');
 assert not has_function_privilege('anon','public.pitacco_storefront_save_draft(uuid,jsonb,integer)','EXECUTE');
 assert not has_function_privilege('anon','public.pitacco_storefront_publish(uuid,integer,integer)','EXECUTE');
end $test$;
set local role authenticated;
select set_config('request.jwt.claim.sub','91000000-0000-0000-0000-000000000001',true);
select public.save_public_menu_settings('92000000-0000-0000-0000-000000000001','estudiolojaa',true,true,true,5,array['dinheiro'],'');
set local role anon;
select set_config('request.jwt.claim.sub','',true);
do $test$
declare public_design jsonb;
begin
 public_design:=public.get_public_menu('estudiolojaa')->'store'->'appearance';
 assert public_design->>'primary'='#d15723';
 assert public_design->'logo_frame'->>'zoom'='180';
 assert public_design->'featured_colors'->>'background'='#7320c5';
 assert public_design->'featured_colors'->>'button'='#123456';
 assert public_design->'logo_frame'->>'fit'='cover';
 assert public.pitacco_public_menu_identity('estudiolojaa')->>'name'='Estúdio Loja A';
 assert public.pitacco_public_menu_identity('invalid-test-store') is null;
 assert not (public.pitacco_public_menu_identity('estudiolojaa') ? 'products');
 assert jsonb_array_length(public_design->'banners')=1;
end $test$;
rollback;


-- As imagens do Estúdio devem ser públicas para os clientes e graváveis
-- somente por gestores no caminho exclusivo da sua loja.
do $studio_test$
begin
 assert exists(select 1 from storage.buckets where id='pitacco-media'
  and public and file_size_limit=5242880), 'Bucket pitacco-media público com limite correto';
 assert exists(select 1 from pg_policies where schemaname='storage'
  and tablename='objects' and policyname='pitacco_media_store_manager_insert'),
  'Política de upload por gestor deve existir';
 assert exists(select 1 from pg_policies where schemaname='storage'
  and tablename='objects' and policyname='pitacco_media_public_read'),
  'Fotos devem estar visíveis no cardápio público';
 assert 'stores/92000000-0000-0000-0000-000000000001/22000000-0000-0000-0000-000000000002.jpg'
  ~ '^(stores|products)/[0-9a-fA-F-]{36}/[0-9a-fA-F-]{36}[.](jpg|png|webp)$';
 assert 'stores/92000000-0000-0000-0000-000000000001/22000000-0000-0000-0000-000000000002.exe'
  !~ '^(stores|products)/[0-9a-fA-F-]{36}/[0-9a-fA-F-]{36}[.](jpg|png|webp)$';
 assert pg_get_functiondef('pitacco_private.validate_storefront_design(uuid,jsonb)'::regprocedure)
  like '%photo !~ ''[.](jpg|png|webp)$''%', 'Validação das imagens corrigida';
end $studio_test$;
