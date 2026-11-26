
alter table public.stores add column if not exists address_complement text;
create table pitacco_private.store_registration_key(singleton boolean primary key default true check(singleton),secret text not null);
insert into pitacco_private.store_registration_key(secret) values(encode(extensions.gen_random_bytes(32),'hex'));
alter table pitacco_private.store_registration_key enable row level security;
revoke all on pitacco_private.store_registration_key from public,anon,authenticated;
create table pitacco_private.store_registration(store_id uuid primary key references public.stores(id),person_type text check(person_type in ('cpf','cnpj')),document_cipher bytea,legal_name text,responsible_name text,administrative_phone text,administrative_email text,updated_at timestamptz not null default now());
alter table pitacco_private.store_registration enable row level security;
revoke all on pitacco_private.store_registration from public,anon,authenticated;
create function pitacco_private.store_registration_document(p_store uuid) returns text language sql stable set search_path='' as $$
 select extensions.pgp_sym_decrypt(r.document_cipher,k.secret) from pitacco_private.store_registration r cross join pitacco_private.store_registration_key k where r.store_id=p_store and k.singleton and r.document_cipher is not null
$$;
revoke all on function pitacco_private.store_registration_document(uuid) from public,anon,authenticated,service_role;
create function public.pitacco_store_registration(p_store uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
 if auth.uid() is null or not (public.pitacco_is_platform_owner() or public.pitacco_can_manage_store(p_store)) then raise exception 'Sem permissão' using errcode='42501';end if;
 select jsonb_build_object('name',s.name,'description',s.description,'whatsapp',s.phone,'address',s.address,'address_number',s.address_number,'address_complement',s.address_complement,'neighborhood',s.neighborhood,'city',s.city,'state',s.state,'postal_code',s.postal_code,'person_type',coalesce(r.person_type,(select t.identity_kind from pitacco_private.trial_identity_registry t where t.first_store_id=s.id limit 1),(select t.identity_kind from pitacco_private.commercial_fiscal_identity t where t.store_id=s.id)),'document',pitacco_private.store_registration_document(s.id),'legal_name',r.legal_name,'responsible_name',r.responsible_name,'administrative_phone',r.administrative_phone,'administrative_email',r.administrative_email,'payer_registered',exists(select 1 from pitacco_private.asaas_commercial_customers a where a.store_id=s.id)) into result
 from public.stores s left join pitacco_private.store_registration r on r.store_id=s.id where s.id=p_store;
 if result is null then raise exception 'Loja não encontrada';end if;
 return result;
end $$;
revoke all on function public.pitacco_store_registration(uuid) from public,anon,authenticated;
grant execute on function public.pitacco_store_registration(uuid) to authenticated;
create function public.pitacco_save_store_registration(p_store uuid,p_data jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare doc text; old_doc text; kind text; h text; pepper_value text; key_value text; wa text; tel text; email text; responsible text; legal text;
begin
 if auth.uid() is null or not public.pitacco_can_manage_store(p_store) then raise exception 'Sem permissão' using errcode='42501';end if;
 perform 1 from public.stores where id=p_store for update;
 if not found then raise exception 'Loja não encontrada';end if;
 if p_data is null or jsonb_typeof(p_data)<>'object' then raise exception 'Cadastro inválido';end if;
 old_doc:=pitacco_private.store_registration_document(p_store);
 doc:=regexp_replace(coalesce(nullif(p_data->>'document',''),old_doc,''),'[^0-9]','','g');
 kind:=p_data->>'person_type'; if kind not in ('cpf','cnpj') or kind is null or not pitacco_private.valid_document(doc) or length(doc)<>(case when kind='cpf' then 11 else 14 end) then raise exception 'CPF ou CNPJ inválido';end if;
 if old_doc is not null and old_doc<>doc then raise exception 'Alteração de titularidade exige conciliação com o suporte';end if;
 select pepper into pepper_value from pitacco_private.identity_secret where id=true;
 h:=encode(extensions.hmac(doc,pepper_value,'sha256'),'hex');
 if exists(select 1 from pitacco_private.trial_identity_registry t where t.first_store_id=p_store and t.identity_hash<>h) or exists(select 1 from pitacco_private.commercial_fiscal_identity t where t.store_id=p_store and t.identity_hash<>h) then raise exception 'Documento diverge do cadastro anterior';end if;
 if old_doc is null and exists(select 1 from pitacco_private.asaas_commercial_customers a where a.store_id=p_store) and not exists(select 1 from pitacco_private.trial_identity_registry t where t.first_store_id=p_store and t.identity_hash=h) and not exists(select 1 from pitacco_private.commercial_fiscal_identity t where t.store_id=p_store and t.identity_hash=h) then raise exception 'Confirme a titularidade com o suporte';end if;
 wa:=regexp_replace(coalesce(p_data->>'whatsapp',''),'[^0-9]','','g');tel:=regexp_replace(coalesce(p_data->>'administrative_phone',''),'[^0-9]','','g');
 email:=lower(btrim(coalesce(p_data->>'administrative_email','')));responsible:=btrim(coalesce(p_data->>'responsible_name',''));legal:=btrim(coalesce(p_data->>'legal_name',''));
 if length(wa) not between 10 and 13 or length(tel) not between 10 and 13 or length(email)>180 or email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' or length(responsible) not between 3 and 180 or (kind='cnpj' and length(legal) not between 3 and 180) then raise exception 'Confira os dados de contato e titularidade';end if;
 if exists(select 1 from unnest(array['address','address_number','neighborhood','city','state','postal_code']) k where length(btrim(coalesce(p_data->>k,'')))=0) or length(regexp_replace(coalesce(p_data->>'postal_code',''),'[^0-9]','','g'))<>8 then raise exception 'Informe o endereço completo da loja';end if;
 select secret into key_value from pitacco_private.store_registration_key where singleton;
 perform public.pitacco_update_store_identity(p_store,p_data||jsonb_build_object('phone',wa));
 update public.stores set address_complement=nullif(left(btrim(p_data->>'address_complement'),180),'') where id=p_store;
 insert into pitacco_private.store_registration(store_id,person_type,document_cipher,legal_name,responsible_name,administrative_phone,administrative_email)
 values(p_store,kind,extensions.pgp_sym_encrypt(doc,key_value),case when kind='cnpj' then legal else null end,responsible,tel,email)
 on conflict(store_id) do update set person_type=excluded.person_type,document_cipher=excluded.document_cipher,legal_name=excluded.legal_name,responsible_name=excluded.responsible_name,administrative_phone=excluded.administrative_phone,administrative_email=excluded.administrative_email,updated_at=now();
 insert into pitacco_private.commercial_fiscal_identity(store_id,identity_kind,identity_hash,document_last4,verified_by) values(p_store,kind,h,right(doc,4),auth.uid()) on conflict(store_id) do nothing;
 return jsonb_build_object('saved',true);
end $$;
revoke all on function public.pitacco_save_store_registration(uuid,jsonb) from public,anon,authenticated;
grant execute on function public.pitacco_save_store_registration(uuid,jsonb) to authenticated;
do $patch$ declare f text; begin
 select pg_get_functiondef('public.pitacco_register_store(text,text)'::regprocedure) into f;
 if strpos(f,'values(v_kind,v_hash,v_uid,v_store,now(),right(v_doc,4));')=0 then raise exception 'Signup anchor missing';end if;
 execute replace(f,'values(v_kind,v_hash,v_uid,v_store,now(),right(v_doc,4));','values(v_kind,v_hash,v_uid,v_store,now(),right(v_doc,4)); insert into pitacco_private.store_registration(store_id,person_type,document_cipher,responsible_name,administrative_email) select v_store,v_kind,extensions.pgp_sym_encrypt(v_doc,k.secret),nullif(u.raw_user_meta_data->>''full_name'',''''),u.email from pitacco_private.store_registration_key k cross join auth.users u where k.singleton and u.id=v_uid on conflict(store_id) do nothing;');
end $patch$;
create function public.pitacco_asaas_registered_payer(p_actor uuid,p_store uuid,p_invoice uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare sid uuid; result jsonb;
begin
 sid:=p_store;
 if p_invoice is not null then select b.store_id into sid from pitacco_private.commercial_invoices i join pitacco_private.commercial_closings b using(contract_id,kind,period_end) where i.id=p_invoice;end if;
 if sid is null or not (exists(select 1 from public.store_members where store_id=sid and user_id=p_actor and role='gestor') or exists(select 1 from pitacco_private.platform_owner where user_id=p_actor)) then raise exception 'Sem permissão' using errcode='42501';end if;
 select jsonb_build_object('document',pitacco_private.store_registration_document(sid),'name',coalesce(case when r.person_type='cnpj' then r.legal_name else r.responsible_name end,s.name),'email',r.administrative_email,'phone',r.administrative_phone,'address',s.address,'addressNumber',s.address_number,'complement',s.address_complement,'province',s.neighborhood,'postalCode',s.postal_code) into result from public.stores s left join pitacco_private.store_registration r on r.store_id=s.id where s.id=sid;
 return result;
end $$;
revoke all on function public.pitacco_asaas_registered_payer(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.pitacco_asaas_registered_payer(uuid,uuid,uuid) to service_role;
do $patch$ declare f text; begin
 select pg_get_functiondef('public.pitacco_asaas_prepare_customer(uuid,uuid,text)'::regprocedure) into f;
 f:=replace(f,'then raise exception ''Identidade fiscal requer validação pelo suporte'';end if;','and not exists(select 1 from pitacco_private.commercial_fiscal_identity t where t.store_id=s and t.identity_hash=encode(extensions.hmac(doc,pepper_value,''sha256''),''hex'')) then raise exception ''Identidade fiscal requer validação pelo suporte'';end if;');execute f;
 select pg_get_functiondef('public.pitacco_asaas_prepare_store_customer(uuid,uuid,text)'::regprocedure) into f;
 f:=replace(f,'then raise exception ''Identidade fiscal requer validação pelo suporte'';end if;','and not exists(select 1 from pitacco_private.commercial_fiscal_identity t where t.store_id=p_store and t.identity_hash=encode(extensions.hmac(doc,pepper_value,''sha256''),''hex'')) then raise exception ''Identidade fiscal requer validação pelo suporte'';end if;');execute f;
 select pg_get_functiondef('public.pitacco_commercial_invoices(uuid,integer)'::regprocedure) into f;
 if strpos(f,'as asaas_customer_linked,claim.id')=0 then raise exception 'Invoice anchor missing';end if;
 execute replace(f,'as asaas_customer_linked,claim.id','as asaas_customer_linked,exists(select 1 from pitacco_private.store_registration r where r.store_id=b.store_id and r.document_cipher is not null) as payer_document_ready,claim.id');
 select pg_get_functiondef('public.get_public_menu(text)'::regprocedure) into f;
 execute replace(f,'''slug'',cfg.slug,''route_pricing''','''slug'',cfg.slug,''whatsapp'',(select phone from public.stores where id=cfg.store_id),''route_pricing''');
end $patch$;
notify pgrst,'reload schema';
