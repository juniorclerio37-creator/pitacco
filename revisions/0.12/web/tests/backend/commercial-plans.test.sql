
begin;
do $$
declare period record;
begin
 select * into period from pitacco_private.weekly_commission_period('2026-11-18 02:59:59+00');
 assert period.week_start='2026-11-11'::date;
 assert period.period_start='2026-11-11 03:00:00+00'::timestamptz;
 assert period.period_end='2026-11-18 03:00:00+00'::timestamptz;
 assert period.due_at='2026-11-19 02:59:00+00'::timestamptz;
 assert period.grace_until='2026-11-21 02:59:00+00'::timestamptz;
 assert (select week_start from pitacco_private.weekly_commission_period('2026-11-18 03:00:00+00'))='2026-11-18'::date;
 assert pitacco_private.weekly_commission_cents(pitacco_private.weekly_commission_base('proprio',true,false,false,10000,0,0,0))=500;
 assert pitacco_private.weekly_commission_cents(pitacco_private.weekly_commission_base('proprio',true,false,false,10000,995,1005,2000))=300;
 assert pitacco_private.weekly_commission_cents(pitacco_private.weekly_commission_base('proprio',true,false,false,9,0,0,0) * 2)=1;
 assert pitacco_private.weekly_commission_base('ifood',true,false,false,10000,0,0,0)=0;
 assert pitacco_private.weekly_commission_base('99food',true,false,false,10000,0,0,0)=0;
 assert pitacco_private.weekly_commission_base('keeta',true,false,false,10000,0,0,0)=0;
 assert pitacco_private.weekly_commission_base('proprio',true,false,true,10000,0,0,0)=0;
 assert pitacco_private.weekly_commission_base('proprio',false,false,false,10000,0,0,0)=0;
 assert pitacco_private.weekly_commission_base('proprio',true,true,false,10000,0,0,0)=0;
 assert pitacco_private.weekly_commission_base('proprio',true,false,false,10000,0,0,10000)=0;
 assert not has_function_privilege('anon','public.pitacco_owner_commercial_plans()','execute');
end $$;

insert into auth.users(id,email) values
 ('10000000-0000-0000-0000-000000000001','commercial-owner@example.invalid'),
 ('10000000-0000-0000-0000-000000000002','commercial-manager@example.invalid');
insert into pitacco_private.platform_owner(user_id,login_name_hash)
values ('10000000-0000-0000-0000-000000000001',sha256(convert_to('00000000001','UTF8')));
set local role authenticated;
select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000002',true);
do $$ begin
 begin
  perform public.pitacco_owner_commercial_plans();
  raise exception 'Funcionário não deve consultar o catálogo administrativo';
 exception when insufficient_privilege then null;
 end;
end $$;
select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000001',true);
do $$
declare plans jsonb := public.pitacco_owner_commercial_plans();
begin
 assert plans#>>'{0,commission_basis_points}'='500';
 assert plans#>>'{0,monthly_cents}'='0';
 assert plans#>>'{1,monthly_cents}'='5990';
 assert plans#>>'{1,trial_days}'='30';
 assert plans#>>'{1,commission_basis_points}'='0';
end $$;
rollback;
