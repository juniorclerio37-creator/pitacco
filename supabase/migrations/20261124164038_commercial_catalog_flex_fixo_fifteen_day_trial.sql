do $policy$
declare d text; current_revision text; revised jsonb;
begin
 select revision into current_revision from public.pitacco_plan_catalog_signal where singleton for update;
 if current_revision is distinct from '2026-11-24-v1' then raise exception 'Catálogo mudou; verificar antes de alterar';end if;
 select jsonb_agg(case p->>'code'
 when 'free' then p||jsonb_build_object('name','Completo Flex','description','Todas as funcionalidades disponíveis. Comissão de 5% sobre produtos e complementos de pedidos próprios elegíveis.','trial_days',0)
 when 'complete' then p||jsonb_build_object('name','Completo Fixo','description','Todas as funcionalidades disponíveis. R$ 59,90 pré-pagos. Teste de 15 dias apenas para novos clientes elegíveis; migração sem teste, mediante pagamento confirmado.','trial_days',15,'grace_hours',0)
 else p end order by ord) into revised
 from pitacco_private.plan_catalog_versions v cross join lateral jsonb_array_elements(v.plans) with ordinality a(p,ord) where v.revision=current_revision;
 if revised is null then raise exception 'Catálogo indisponível';end if;
 insert into pitacco_private.plan_catalog_versions(revision,plans) values('2026-11-24-v2',revised);
 update public.pitacco_plan_catalog_signal set revision='2026-11-24-v2' where singleton;
 select pg_get_functiondef('public.pitacco_register_store(text,text)'::regprocedure) into d;
 if position('current_date+7)' in d)=0 or position('now()+interval ''7 days''' in d)=0 then raise exception 'Cadastro divergente';end if;
 execute replace(replace(d,'current_date+7)','current_date+15)'),'now()+interval ''7 days''','now()+interval ''15 days''');
 select pg_get_functiondef('public.pitacco_register_store(text)'::regprocedure) into d;
 if position('current_date+7)' in d)=0 then raise exception 'Cadastro legado divergente';end if;
 execute replace(d,'current_date+7)','current_date+15)');
end $policy$;
alter table public.pitacco_signup_trials alter column ends_at set default (now()+interval '15 days');
