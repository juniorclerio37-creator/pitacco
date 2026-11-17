begin;
insert into auth.users(id,email) values
 ('71000000-0000-0000-0000-000000000001','support-manager@example.invalid'),
 ('71000000-0000-0000-0000-000000000002','support-other@example.invalid'),
 ('71000000-0000-0000-0000-000000000003','support-owner@example.invalid');
insert into pitacco_private.platform_owner(user_id) values('71000000-0000-0000-0000-000000000003');
insert into public.stores(id,name) values
 ('72000000-0000-0000-0000-000000000001','Loja Suporte 1'),
 ('72000000-0000-0000-0000-000000000002','Loja Suporte 2');
insert into public.store_members values
 ('72000000-0000-0000-0000-000000000001','71000000-0000-0000-0000-000000000001','gestor'),
 ('72000000-0000-0000-0000-000000000002','71000000-0000-0000-0000-000000000002','gestor');
set local role authenticated;
select set_config('request.jwt.claim.sub','71000000-0000-0000-0000-000000000001',true);
do $test$
declare ticket uuid; detail jsonb;
begin
 ticket:=public.pitacco_support_create('72000000-0000-0000-0000-000000000001',
  'impressoes','Minha impressora parou','A impressora deixou de imprimir pedidos hoje.');
 assert (public.pitacco_support_list('72000000-0000-0000-0000-000000000001')->'rows'->0->>'id')::uuid=ticket;
 assert jsonb_array_length(public.pitacco_support_list('72000000-0000-0000-0000-000000000001')->'rows')=1;
 detail:=public.pitacco_support_details(ticket);
 assert jsonb_array_length(detail->'messages')=1;
 perform public.pitacco_support_reply(ticket,'Preciso de auxílio com o aplicativo.');
 assert jsonb_array_length(public.pitacco_support_details(ticket)->'messages')=2;
 begin
  perform public.pitacco_support_list(null);
  raise exception 'Missing tenant scope should be denied';
 exception when insufficient_privilege then null;end;
 begin
  perform public.pitacco_support_create('72000000-0000-0000-0000-000000000002',
   'pedidos','Loja não autorizada','Tentativa de chamado na loja errada.');
  raise exception 'Cross-tenant write must be denied';
 exception when insufficient_privilege then null;end;
 begin
  perform public.pitacco_owner_support_status(ticket,'resolved','Resolvido pelo lojista');
  raise exception 'Manager must not change support status';
 exception when insufficient_privilege then null;end;
end $test$;
select set_config('request.jwt.claim.sub','71000000-0000-0000-0000-000000000002',true);
do $test$
begin
 assert jsonb_array_length(public.pitacco_support_list('72000000-0000-0000-0000-000000000002')->'rows')=0;
 begin
  perform public.pitacco_support_list('72000000-0000-0000-0000-000000000001');
  raise exception 'Cross-tenant read must be denied';
 exception when insufficient_privilege then null;end;
end $test$;
select set_config('request.jwt.claim.sub','71000000-0000-0000-0000-000000000003',true);
do $test$
declare ticket uuid; state jsonb;
begin
 ticket:=(public.pitacco_support_list(null)->'rows'->0->>'id')::uuid;
 assert ticket is not null;
 state:=public.pitacco_owner_support_status(ticket,'in_progress','Equipe de suporte analisando a solicitação');
 assert state->>'status'='in_progress';
 assert jsonb_array_length(public.pitacco_support_details(ticket)->'messages')=3;
 perform public.pitacco_support_reply(ticket,'Estamos analisando seu chamado.');
 assert public.pitacco_support_details(ticket)->'ticket'->>'status'='waiting_store';
end $test$;
reset role;
do $test$
begin
 assert not has_table_privilege('authenticated','public.pitacco_support_tickets','INSERT');
 assert not has_table_privilege('authenticated','public.pitacco_support_messages','SELECT');
 assert not has_function_privilege('anon','public.pitacco_support_create(uuid,text,text,text)','EXECUTE');
 assert not has_function_privilege('anon','public.pitacco_support_list(uuid,text,integer)','EXECUTE');
end $test$;
rollback;
