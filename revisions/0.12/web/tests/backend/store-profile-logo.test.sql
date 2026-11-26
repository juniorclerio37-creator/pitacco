-- Logo é identidade institucional e não uma revisão da aparência.
begin;
insert into auth.users(id,email) values
 ('94000000-0000-0000-0000-000000000011','logo-manager@example.invalid'),
 ('94000000-0000-0000-0000-000000000012','logo-other@example.invalid');
insert into public.stores(id,name,logo_path) values
 ('95000000-0000-0000-0000-000000000011','Loja Logo A','stores/95000000-0000-0000-0000-000000000011/old.png'),
 ('95000000-0000-0000-0000-000000000012','Loja Logo B',null);
insert into public.store_members values
 ('95000000-0000-0000-0000-000000000011','94000000-0000-0000-0000-000000000011','gestor'),
 ('95000000-0000-0000-0000-000000000012','94000000-0000-0000-0000-000000000012','gestor');
set local role authenticated;
select set_config('request.jwt.claim.sub','94000000-0000-0000-0000-000000000011',true);
do $test$
declare s uuid:='95000000-0000-0000-0000-000000000011';
 old_logo text:='stores/95000000-0000-0000-0000-000000000011/old.png';
 new_logo text:='stores/95000000-0000-0000-0000-000000000011/new.png';
 d jsonb; st jsonb; r jsonb;
begin
 assert public.pitacco_store_identity(s)->>'logo_path'=old_logo;
 st:=public.pitacco_storefront_studio_state(s);
 d:=st->'draft'||jsonb_build_object('logo_path',old_logo,'slogan','Visual original');
 r:=public.pitacco_storefront_save_publish(s,d,0,0);
 assert r->>'published'='true';
 r:=public.pitacco_save_store_logo(s,new_logo);
 assert r->>'saved'='true';
 st:=public.pitacco_storefront_studio_state(s);
 assert st->'published'->>'logo_path'=new_logo;
 assert st->'draft'->>'logo_path'=new_logo;
 assert st->'published'->>'slogan'='Visual original';
 assert public.pitacco_store_identity(s)->>'logo_path'=new_logo;
 -- Mesmo uma aparência antiga não pode reverter o logotipo.
 r:=public.pitacco_storefront_save_publish(s,d||'{"slogan":"Visual novo"}'::jsonb,(st->>'draft_version')::int,(st->>'published_version')::int);
 assert r->>'published'='true';
 assert public.pitacco_storefront_studio_state(s)->'published'->>'logo_path'=new_logo;
 begin
  perform public.pitacco_save_store_logo(s,'stores/95000000-0000-0000-0000-000000000012/new.png');
  raise exception 'Caminho de outra loja aceito';
 exception when raise_exception then if sqlerrm<>'Caminho de imagem inválido' then raise;end if;end;
end $test$;
select set_config('request.jwt.claim.sub','94000000-0000-0000-0000-000000000012',true);
do $test$
begin
 begin
  perform public.pitacco_save_store_logo('95000000-0000-0000-0000-000000000011','stores/95000000-0000-0000-0000-000000000011/other.png');
  raise exception 'Gestor de outra loja conseguiu alterar logotipo';
 exception when insufficient_privilege then null;end;
end $test$;
reset role;
rollback;
