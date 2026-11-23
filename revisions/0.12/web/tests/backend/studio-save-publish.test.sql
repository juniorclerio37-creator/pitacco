-- Regressão: botão único salva e publica sem estado intermediário.
begin;
insert into auth.users(id,email) values
 ('94000000-0000-0000-0000-000000000001','studio-atomic-manager@example.invalid'),
 ('94000000-0000-0000-0000-000000000002','studio-atomic-other@example.invalid');
insert into public.stores(id,name) values
 ('95000000-0000-0000-0000-000000000001','Estúdio Publicação Atômica A'),
 ('95000000-0000-0000-0000-000000000002','Estúdio Publicação Atômica B');
insert into public.store_members values
 ('95000000-0000-0000-0000-000000000001','94000000-0000-0000-0000-000000000001','gestor'),
 ('95000000-0000-0000-0000-000000000002','94000000-0000-0000-0000-000000000002','gestor');

set local role authenticated;
select set_config('request.jwt.claim.sub','94000000-0000-0000-0000-000000000001',true);
do $test$
declare
 d jsonb; result jsonb; state jsonb;
 s uuid:='95000000-0000-0000-0000-000000000001';
begin
 state:=public.pitacco_storefront_studio_state(s);
 assert state->>'draft_version'='0';
 d:=state->'draft'||'{"template":"pitacco-v2","slogan":"Novo visual publicado"}'::jsonb;
 result:=public.pitacco_storefront_save_publish(s,d,0,0);
 assert result->>'saved'='true' and result->>'published'='true';
 assert result->>'draft_version'='1';
 assert result->>'published_version'='1';
 state:=public.pitacco_storefront_studio_state(s);
 assert state->>'draft_version'='1' and state->>'published_version'='1';
 assert state->'draft'=d and state->'published'=d;
 assert jsonb_array_length(state->'history')=1;
 assert state->'published_at' is not null;

 -- Reenvio com versão antiga não pode gerar publicação duplicada.
 begin
  perform public.pitacco_storefront_save_publish(s,d,0,0);
  raise exception 'Versões antigas não devem ser aceitas';
 exception when raise_exception then
  if sqlerrm not like 'A aparência foi alterada%' then raise;end if;
 end;
 state:=public.pitacco_storefront_studio_state(s);
 assert state->>'draft_version'='1' and state->>'published_version'='1';
 assert jsonb_array_length(state->'history')=1;

 -- Visual inválido falha antes da atualização e preserva o publicado.
 begin
  perform public.pitacco_storefront_save_publish(s,d||'{"primary":"invalid"}'::jsonb,1,1);
  raise exception 'Aparência inválida não foi bloqueada';
 exception when raise_exception then
  if sqlerrm<>'Cor primary inválida' then raise;end if;
 end;
 assert (public.pitacco_storefront_studio_state(s)->'published')=d;

 -- Edição e publicação simultâneas precisam manter histórico de versões.
 d:=d||'{"slogan":"Segundo visual"}'::jsonb;
 result:=public.pitacco_storefront_save_publish(s,d,1,1);
 assert result->>'draft_version'='2' and result->>'published_version'='2';
 assert (public.pitacco_storefront_studio_state(s)->'published')=d;
 assert jsonb_array_length(public.pitacco_storefront_studio_state(s)->'history')=2;
end $test$;

-- Outros gestores não podem publicar a aparência de lojas alheias.
select set_config('request.jwt.claim.sub','94000000-0000-0000-0000-000000000002',true);
do $test$
begin
 begin
  perform public.pitacco_storefront_save_publish(
   '95000000-0000-0000-0000-000000000001','{}'::jsonb,2,2);
  raise exception 'Outra loja conseguiu publicar';
 exception when insufficient_privilege then null;end;
end $test$;

reset role;
do $test$
begin
 assert not has_function_privilege('anon',
  'public.pitacco_storefront_save_publish(uuid,jsonb,integer,integer)','EXECUTE');
 assert has_function_privilege('authenticated',
  'public.pitacco_storefront_save_publish(uuid,jsonb,integer,integer)','EXECUTE');
 assert not has_table_privilege('authenticated',
  'public.pitacco_storefront_designs','UPDATE');
end $test$;
rollback;
