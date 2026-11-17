create table if not exists pitacco_private.delivery_quote_rate_limits (
 scope text not null check(length(scope) between 10 and 180),
 window_start timestamptz not null,
 attempts integer not null default 1 check(attempts between 1 and 10000),
 primary key(scope,window_start)
);
revoke all on pitacco_private.delivery_quote_rate_limits from public,anon,authenticated;
create or replace function public.pitacco_service_delivery_quote_limit(p_scope text,p_max integer,p_minutes integer)
returns boolean language plpgsql security definer set search_path='' as $$
declare bucket timestamptz; counter integer;
begin
 if current_user<>'service_role' then raise exception 'Somente serviço autorizado' using errcode='42501'; end if;
 if p_max not between 1 and 1000 or p_minutes not in (1,60,1440)
  or length(p_scope) not between 10 and 180 then raise exception 'Parâmetros inválidos';end if;
 bucket:=to_timestamp(floor(extract(epoch from now())/(p_minutes*60))*(p_minutes*60));
 insert into pitacco_private.delivery_quote_rate_limits(scope,window_start,attempts)
 values(p_scope,bucket,1)
 on conflict(scope,window_start) do update
  set attempts=pitacco_private.delivery_quote_rate_limits.attempts+1
  where pitacco_private.delivery_quote_rate_limits.attempts<p_max
 returning attempts into counter;
 return counter is not null;
end $$;
revoke all on function public.pitacco_service_delivery_quote_limit(text,integer,integer) from public,anon,authenticated;
grant execute on function public.pitacco_service_delivery_quote_limit(text,integer,integer) to service_role;
