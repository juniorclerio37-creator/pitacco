begin;
do $$begin
 assert pitacco_private.incident_whatsapp_number('(21) 99999-1234')='5521999991234';
 assert pitacco_private.incident_whatsapp_number('+55 (21) 99999-1234')='5521999991234';
 assert pitacco_private.incident_whatsapp_number('0800 123 4567') is null;
 assert pitacco_private.incident_whatsapp_number('21 99999-1234,123') is null;
 assert not has_function_privilege('anon','public.pitacco_incident_whatsapp_contacts(uuid)','EXECUTE');
end $$;
insert into auth.users(id,email) values('a0000000-0000-4000-8000-000000000091','incident-manager@example.invalid'),('a0000000-0000-4000-8000-000000000092','incident-outsider@example.invalid');
insert into public.stores(id,name,phone) values('a0000000-0000-4000-8000-000000000093','Incident Test','21999991234');
insert into public.store_members values('a0000000-0000-4000-8000-000000000093','a0000000-0000-4000-8000-000000000091','gestor');
set local role authenticated;
select set_config('request.jwt.claim.sub','a0000000-0000-4000-8000-000000000092',true);
do $$begin
 assert not exists(select 1 from public.pitacco_incident_whatsapp_contacts('a0000000-0000-4000-8000-000000000093'));
 begin perform public.pitacco_set_incident_whatsapp('a0000000-0000-4000-8000-000000000093','21988881234');raise exception 'Unexpected permission';exception when insufficient_privilege then null;end;
end $$;
select set_config('request.jwt.claim.sub','a0000000-0000-4000-8000-000000000091',true);
do $$begin
 perform public.pitacco_set_incident_whatsapp('a0000000-0000-4000-8000-000000000093','21988881234');
 assert public.pitacco_incident_whatsapp_settings('a0000000-0000-4000-8000-000000000093')->>'number'='5521988881234';
 perform public.pitacco_set_incident_whatsapp('a0000000-0000-4000-8000-000000000093','');
 assert public.pitacco_incident_whatsapp_settings('a0000000-0000-4000-8000-000000000093')->>'number' is null;
end $$;
rollback;
