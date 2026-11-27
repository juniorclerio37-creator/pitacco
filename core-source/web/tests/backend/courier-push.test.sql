begin;
update pitacco_private.courier_push_settings set enabled=true;
create table if not exists auth.sessions(id uuid primary key,user_id uuid,created_at timestamptz);
create or replace function auth.jwt() returns jsonb language sql stable as $$select jsonb_build_object('session_id',current_setting('test.push.session',true))$$;
create table if not exists public.pitacco_courier_auth_state(user_id uuid,store_id uuid,must_change_password boolean,credentials_issued_at timestamptz);
create or replace function public.pitacco_courier_session_ready() returns boolean language sql stable as $$
select exists(select 1 from public.pitacco_courier_auth_state where user_id=auth.uid() and not must_change_password)
$$;
insert into auth.users(id,email) values('f0000000-0000-4000-8000-000000000001','push@example.invalid');
insert into public.stores(id,name) values('f0000000-0000-4000-8000-000000000002','Loja Push');
insert into public.couriers(id,user_id,name,fleet_type,store_id,active,available) values
 ('f0000000-0000-4000-8000-000000000003','f0000000-0000-4000-8000-000000000001','Entregador','propria','f0000000-0000-4000-8000-000000000002',true,true);
insert into auth.sessions values('f0000000-0000-4000-8000-000000000004','f0000000-0000-4000-8000-000000000001',now());
insert into public.pitacco_courier_auth_state values('f0000000-0000-4000-8000-000000000001','f0000000-0000-4000-8000-000000000002',false,now());
select set_config('request.jwt.claim.sub','f0000000-0000-4000-8000-000000000001',true);
select set_config('test.push.session','f0000000-0000-4000-8000-000000000004',true);
set local role authenticated;
select public.pitacco_register_courier_push(repeat('a',60));
do $$begin
 if has_function_privilege('authenticated','public.pitacco_claim_courier_push()','EXECUTE') then
  raise exception 'Entregador pode ler registros de envio';
 end if;
end$$;
reset role;
insert into public.deliveries(id,store_id,courier_id,customer_name,address,logistics_provider,status)
values('f0000000-0000-4000-8000-000000000005','f0000000-0000-4000-8000-000000000002','f0000000-0000-4000-8000-000000000003',
 'Cliente','Endereço','loja','atribuida');
update public.deliveries set status=status where id='f0000000-0000-4000-8000-000000000005';
update public.couriers set available=false where id='f0000000-0000-4000-8000-000000000003';
set local role service_role;
do $$begin
 if exists(select 1 from public.pitacco_claim_courier_push()) then raise exception 'Enviou para entregador offline'; end if;
end$$;
reset role;
update public.couriers set available=true where id='f0000000-0000-4000-8000-000000000003';
set local role service_role;
do $$declare event record;
begin
 select * into strict event from public.pitacco_claim_courier_push();
 if event.token<>repeat('a',60) then raise exception 'Dispositivo incorreto'; end if;
 if exists(select 1 from public.pitacco_claim_courier_push()) then raise exception 'Reivindicou evento novamente'; end if;
 perform public.pitacco_finish_courier_push(event.event_id,event.token,'invalid');
end$$;
reset role;
do $$begin
 if exists(select 1 from pitacco_private.courier_push_device) then raise exception 'Token inválido permaneceu cadastrado'; end if;
 if (select count(*) from pitacco_private.courier_push_outbox where sent_at is not null)<>1 then
  raise exception 'Evento duplicado ou não encerrado';
 end if;
end$$;
rollback;
