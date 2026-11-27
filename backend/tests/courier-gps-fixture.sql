-- CI-only synthetic courier. No real credentials or tokens in fixtures.
insert into auth.users(id,email) values ('97000000-0000-0000-0000-000000000001','gps-fixture@example.invalid');
insert into public.profiles(id,email,role) values ('97000000-0000-0000-0000-000000000001','gps-fixture@example.invalid','entregador') on conflict(id) do update set role=excluded.role;
insert into public.couriers(id,user_id,name,fleet_type,store_id,active,available) values ('97000000-0000-0000-0000-000000000002','97000000-0000-0000-0000-000000000001','GPS Fixture','propria','91000000-0000-0000-0000-000000000002',true,true);
insert into public.pitacco_courier_auth_state(user_id,store_id,must_change_password,credentials_issued_at) values ('97000000-0000-0000-0000-000000000001','91000000-0000-0000-0000-000000000002',false,now()-interval '1 minute');
insert into auth.sessions(id,user_id) values ('97000000-0000-0000-0000-000000000003','97000000-0000-0000-0000-000000000001');
create role pitacco_core_courier_gps login password 'ci-courier-gps-only' nosuperuser nocreatedb nocreaterole nobypassrls;
grant usage on schema public to pitacco_core_courier_gps;
grant execute on function public.pitacco_courier_background_gps_update(text,double precision,double precision,double precision),public.pitacco_courier_background_gps_update_motion(text,double precision,double precision,double precision,text,integer,double precision) to pitacco_core_courier_gps;

grant execute on function public.pitacco_courier_background_assignments(text) to pitacco_core_courier_gps;
-- Second synthetic courier, same store, separate credentials and plantão.
insert into auth.users(id,email) values ('97000000-0000-0000-0000-000000000011','gps-other-fixture@example.invalid');
insert into public.profiles(id,email,role) values ('97000000-0000-0000-0000-000000000011','gps-other-fixture@example.invalid','entregador') on conflict(id) do update set role=excluded.role;
insert into public.couriers(id,user_id,name,fleet_type,store_id,active,available) values ('97000000-0000-0000-0000-000000000012','97000000-0000-0000-0000-000000000011','Other GPS Fixture','propria','91000000-0000-0000-0000-000000000002',true,true);
insert into public.pitacco_courier_auth_state(user_id,store_id,must_change_password,credentials_issued_at) values ('97000000-0000-0000-0000-000000000011','91000000-0000-0000-0000-000000000002',false,now()-interval '1 minute');
insert into auth.sessions(id,user_id) values ('97000000-0000-0000-0000-000000000013','97000000-0000-0000-0000-000000000011');
