-- Alertas administrativos centralizados. Nunca executar ações operacionais ao detectar falhas.
-- Incidentes persistentes já existem; esta migração apenas acelera eventos com erro explícito
-- e fornece resumo exclusivo ao proprietário. Sem telefone, token ou endereço nas notificações.
create or replace function pitacco_private.capture_immediate_failure()
returns trigger language plpgsql security definer set search_path='' as $$
declare
  v_code text;
  v_failed boolean:=false;
begin
  case tg_table_name
    when 'print_jobs' then
      v_code:='print_error';
      v_failed:=new.state='error';
    when 'marketplace_acceptance_requests' then
      v_code:='marketplace_acceptance_failed';
      v_failed:=new.state='rejected';
    when 'external_delivery_requests' then
      v_code:='delivery_partner_failed';
      v_failed:=new.status='falhou';
    when 'orders' then
      v_code:='payment_failed';
      v_failed:=new.receipt->>'payment_status' in ('failed','falhou');
    else return new;
  end case;
  if not v_failed then return new; end if;

  insert into public.pitacco_operational_incidents
   (store_id,code,entity_id,last_seen_at)
  values (new.store_id,v_code,new.id,clock_timestamp())
  on conflict (store_id,code,entity_id) do update set
    status='open',resolved_at=null,last_seen_at=excluded.last_seen_at,
    detections=public.pitacco_operational_incidents.detections+1,
    acknowledged_at=case when public.pitacco_operational_incidents.status='resolved'
      then null else public.pitacco_operational_incidents.acknowledged_at end,
    acknowledged_by=case when public.pitacco_operational_incidents.status='resolved'
      then null else public.pitacco_operational_incidents.acknowledged_by end;
  return new;
end $$;
revoke all on function pitacco_private.capture_immediate_failure() from public,anon,authenticated;

create trigger pitacco_capture_print_failure
 after insert or update of state on public.print_jobs
 for each row when (new.state='error')
 execute function pitacco_private.capture_immediate_failure();
create trigger pitacco_capture_marketplace_acceptance_failure
 after insert or update of state on public.marketplace_acceptance_requests
 for each row when (new.state='rejected')
 execute function pitacco_private.capture_immediate_failure();
create trigger pitacco_capture_delivery_partner_failure
 after insert or update of status on public.external_delivery_requests
 for each row when (new.status='falhou')
 execute function pitacco_private.capture_immediate_failure();
create trigger pitacco_capture_payment_failure
 after insert or update of receipt on public.orders
 for each row when (new.receipt->>'payment_status' in ('failed','falhou'))
 execute function pitacco_private.capture_immediate_failure();

-- Chamada de leitura, de escopo global, vetada a lojistas e entregadores.
-- A interface administrativa consulta a cada poucos segundos enquanto aberta.
create or replace function public.pitacco_owner_incident_pulse()
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_result jsonb;
begin
  if auth.uid() is null or not public.pitacco_is_platform_owner() then
    raise exception 'Monitoramento exclusivo do administrador do Pitacco'
      using errcode='42501';
  end if;
  select jsonb_build_object(
    'checked_at',now(),
    'open',count(*) filter(where i.status='open'),
    'unacknowledged',count(*) filter(where i.status='open' and i.acknowledged_at is null),
    'urgent',count(*) filter(where i.status='open' and i.acknowledged_at is null and
      i.code in ('print_error','marketplace_acceptance_failed','delivery_partner_failed',
       'payment_failed','acceptance_late','delivery_late')),
    'events',coalesce((
      select jsonb_agg(to_jsonb(r) order by r.first_seen_at desc)
      from (
        select i.id,i.code,i.status,i.first_seen_at,i.last_seen_at,
          i.acknowledged_at,s.name as store_name,
          case when i.code in ('print_error','marketplace_acceptance_failed',
               'delivery_partner_failed','payment_failed') then 'critical'
           when i.code in ('acceptance_late','delivery_late') then 'high'
           else 'warning' end as severity
        from public.pitacco_operational_incidents i
        join public.stores s on s.id=i.store_id
        where i.status='open' and i.acknowledged_at is null
        order by i.first_seen_at desc,i.id desc limit 12
      ) r
    ),'[]'::jsonb)
  ) into v_result from public.pitacco_operational_incidents i;
  return v_result;
end $$;
revoke all on function public.pitacco_owner_incident_pulse() from public,anon,authenticated;
grant execute on function public.pitacco_owner_incident_pulse() to authenticated;
