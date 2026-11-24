
-- Version the offer rather than changing terms already accepted.
insert into pitacco_private.plan_catalog_versions(revision,plans)
select '2026-11-24-v4',jsonb_agg(case when x->>'code'='free' then x||jsonb_build_object('commission_basis_points',200,'commission_scope','all_sales','description','Todas as funcionalidades disponíveis. Comissão de 2% sobre produtos e complementos de vendas elegíveis de todos os canais, inclusive marketplaces, balcão e cardápio digital.') else x end order by ord)
from pitacco_private.plan_catalog_versions v cross join lateral jsonb_array_elements(v.plans) with ordinality as t(x,ord)
where v.revision='2026-11-24-v3' group by v.revision;
update public.pitacco_plan_catalog_signal set revision='2026-11-24-v4' where singleton and revision='2026-11-24-v3';
do $patch$
declare d text; a text;
begin
 select pg_get_functiondef('public.pitacco_register_store_plan(text,text,text,text)'::regprocedure) into d;
 a:='(offer->>''commission_basis_points'')::int<>500';
 if position(a in d)=0 then raise exception 'Signup guard changed';end if;
 d:=replace(d,a,'((offer->>''commission_basis_points'')::int is distinct from 200 or offer->>''commission_scope'' is distinct from ''all_sales'')');
 execute d;
 select pg_get_functiondef('pitacco_private.schedule_fixo_to_flex(uuid,text,uuid)'::regprocedure) into d;
 a:='(offer->>''commission_basis_points'')::int is distinct from 500';
 if position(a in d)=0 then raise exception 'Migration guard changed';end if;
 d:=replace(d,a,'(case when offer->>''commission_scope''=''all_sales'' then (offer->>''commission_basis_points'')::int is distinct from 200 else (offer->>''commission_basis_points'')::int is distinct from 500 end)');
 execute d;
 select pg_get_functiondef('pitacco_private.refresh_flex_commission_closings()'::regprocedure) into d;
 a:='o.source=''proprio''';
 if position(a in d)=0 then raise exception 'Commission scope changed';end if;
 d:=replace(d,a,'(o.source=''proprio'' or c.terms->>''commission_scope''=''all_sales'')');
 execute d;
 select pg_get_functiondef('pitacco_private.commercial_amount_calculate(uuid,date)'::regprocedure) into d;
 if position(a in d)=0 then raise exception 'Preview scope changed';end if;
 d:=replace(d,a,'(o.source=''proprio'' or c.terms->>''commission_scope''=''all_sales'')');
 execute d;
end $patch$;

