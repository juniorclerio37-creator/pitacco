begin;
insert into auth.users(id,email) values
 ('10000000-0000-0000-0000-000000000001','old-trial@example.invalid'),
 ('10000000-0000-0000-0000-000000000002','new-trial@example.invalid'),
 ('10000000-0000-0000-0000-000000000003','duplicate-trial@example.invalid');
insert into public.stores(id,name) values ('20000000-0000-0000-0000-000000000001','Existing Store');
insert into public.pitacco_signup_trials(user_id,first_store_id,started_at,ends_at)
 values ('10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001',now(),now()+interval '30 days');
set local role authenticated;
select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000002',true);
do $regression$
declare new_trial record; repeated_trial record;
begin
 select * into new_trial from public.pitacco_register_store('Loja Nova','12345678901');
 assert new_trial.trial_ends_at=now()+interval '7 days', 'New stores receive seven days';
 select * into repeated_trial from public.pitacco_register_store('Loja Nova','12345678901');
 assert new_trial=repeated_trial, 'Repeating signup keeps the same store and deadline';
 assert (select monthly_amount=59.90 and due_date=current_date+7 from public.subscriptions where store_id=new_trial.store_id), 'New subscriptions have the agreed price and date';
end
$regression$;
select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000003',true);
do $regression$
begin
 begin
  perform public.pitacco_register_store('Outra Loja','12345678901');
  raise exception 'Expected duplicate identity rejection';
 exception when raise_exception then
  if sqlerrm not like 'Este CPF/CNPJ já utilizou o período de teste.%' then raise; end if;
 end;
end
$regression$;
select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000001',true);
do $regression$
begin
 assert (select trial_ends_at from public.pitacco_register_store('Loja Existente','12345678902'))=now()+interval '30 days', 'Previously granted trials keep the original date';
end
$regression$;
rollback;
