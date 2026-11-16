
-- The commercial catalog is independent of the legacy entitlement resolver.
-- Existing subscriptions and store rows are intentionally left untouched.
create function public.pitacco_owner_commercial_plans()
returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if not public.pitacco_is_platform_owner() then
  raise exception 'Acesso exclusivo do proprietário do Pitacco' using errcode='42501';
 end if;
 return jsonb_build_array(
  jsonb_build_object('code','free','name','Pitacco Grátis','monthly_cents',0,'trial_days',0,
   'commission_basis_points',500,'billing_cycle','weekly','grace_hours',48,'due_iso_weekday',3),
  jsonb_build_object('code','complete','name','Pitacco Completo','monthly_cents',5990,'trial_days',30,
   'commission_basis_points',0,'billing_cycle','monthly')
 );
end $$;
revoke all on function public.pitacco_owner_commercial_plans() from public,anon,authenticated;
grant execute on function public.pitacco_owner_commercial_plans() to authenticated;

create function pitacco_private.weekly_commission_period(p_instant timestamptz)
returns table (week_start date, period_start timestamptz, period_end timestamptz, due_at timestamptz, grace_until timestamptz)
language sql stable strict set search_path='' as $$
 with local_day as (select (p_instant at time zone 'America/Sao_Paulo')::date as day),
 week as (select day-((extract(isodow from day)::integer+4)%7) as starts from local_day),
 period as (select starts,starts::timestamp at time zone 'America/Sao_Paulo' as first,
  (starts+7)::timestamp at time zone 'America/Sao_Paulo' as last,
  ((starts+7)+time '23:59') at time zone 'America/Sao_Paulo' as due from week)
 select starts,first,last,due,due+interval '48 hours' from period;
$$;
revoke all on function pitacco_private.weekly_commission_period(timestamptz) from public,anon,authenticated;

-- Monetary inputs represent product lines in integer cents after fulfillment.
-- Delivery and gratuity are structurally excluded from this calculation.
create function pitacco_private.weekly_commission_base(
 p_source text,p_completed boolean,p_cancelled boolean,p_test boolean,p_product_cents bigint,
 p_discount_cents bigint,p_cancelled_product_cents bigint,p_refunded_product_cents bigint
) returns bigint language plpgsql immutable strict set search_path='' as $$
begin
 if least(p_product_cents,p_discount_cents,p_cancelled_product_cents,p_refunded_product_cents)<0 then
  raise exception 'Valor de comissão inválido' using errcode='22023';
 end if;
 if p_source<>'proprio' or not p_completed or p_cancelled or p_test then return 0; end if;
 return greatest(0,p_product_cents::numeric-p_discount_cents-p_cancelled_product_cents-p_refunded_product_cents)::bigint;
end $$;
revoke all on function pitacco_private.weekly_commission_base(text,boolean,boolean,boolean,bigint,bigint,bigint,bigint) from public,anon,authenticated;

create function pitacco_private.weekly_commission_cents(p_total_base_cents numeric)
returns bigint language sql immutable strict set search_path='' as $$
 select round(p_total_base_cents*0.05)::bigint
$$;
revoke all on function pitacco_private.weekly_commission_cents(numeric) from public,anon,authenticated;
