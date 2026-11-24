-- Contacts are operational only, and returned only for authorized, active occurrences.
alter table public.stores add column if not exists occurrence_whatsapp text;
create or replace function pitacco_private.incident_whatsapp_number(p_phone text)
returns text language sql immutable set search_path='' as $$
 select case when n ~ '^[1-9][0-9](9[0-9]{8}|[2-9][0-9]{7})$' then '55'||n
 when n ~ '^55[1-9][0-9](9[0-9]{8}|[2-9][0-9]{7})$' then n else null end
 from (select regexp_replace(coalesce(p_phone,''),'[^0-9]','','g') n) x
 where coalesce(p_phone,'') ~ '^[+0-9 ().-]+$';
$$;
revoke all on function pitacco_private.incident_whatsapp_number(text) from public,anon,authenticated;
create or replace function public.pitacco_incident_whatsapp_contacts(p_store uuid default null)
returns table(incident_id uuid,phone text,order_number text,source text)
language sql stable security definer set search_path='' as $$
 select i.id,
 case when p_store is not null then pitacco_private.incident_whatsapp_number(c.phone)
 else coalesce(pitacco_private.incident_whatsapp_number(s.occurrence_whatsapp),pitacco_private.incident_whatsapp_number(s.phone)) end,
 coalesce(nullif(o.receipt->>'display_number',''),nullif(o.receipt->>'external_order_number',''),nullif(o.receipt->>'number',''),left(coalesce(i.order_id,i.delivery_id)::text,8)),
 coalesce(o.source,d.source,'proprio')
 from public.pitacco_delivery_incidents i
 join public.deliveries d on d.id=i.delivery_id and d.store_id=i.store_id and d.courier_id=i.courier_id
 join public.stores s on s.id=i.store_id
 join public.couriers c on c.id=i.courier_id
 left join public.orders o on o.id=i.order_id and o.store_id=i.store_id
 where auth.uid() is not null and i.state in ('open','acknowledged') and d.status not in ('cancelada','entregue')
 and ((p_store=i.store_id and public.is_store_manager(i.store_id))
 or (p_store is null and public.pitacco_courier_session_ready() and c.active and c.user_id=auth.uid()
 and (c.store_id=i.store_id or public.pitacco_courier_test_access(c.id,i.store_id))));
$$;
revoke all on function public.pitacco_incident_whatsapp_contacts(uuid) from public,anon,authenticated;
grant execute on function public.pitacco_incident_whatsapp_contacts(uuid) to authenticated;
create or replace function public.pitacco_incident_whatsapp_settings(p_store uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if auth.uid() is null or not public.is_store_manager(p_store) then raise exception 'Sem permissão' using errcode='42501';end if;
 return (select jsonb_build_object('number',occurrence_whatsapp,'default_number',phone) from public.stores where id=p_store);
end $$;
revoke all on function public.pitacco_incident_whatsapp_settings(uuid) from public,anon,authenticated;
grant execute on function public.pitacco_incident_whatsapp_settings(uuid) to authenticated;
create or replace function public.pitacco_set_incident_whatsapp(p_store uuid,p_phone text)
returns void language plpgsql security definer set search_path='' as $$
declare n text;
begin
 if auth.uid() is null or not public.is_store_manager(p_store) then raise exception 'Sem permissão' using errcode='42501';end if;
 if nullif(btrim(coalesce(p_phone,'')),'') is not null then
 n:=pitacco_private.incident_whatsapp_number(p_phone);
 if n is null then raise exception 'Informe um número brasileiro válido com DDD';end if;end if;
 update public.stores set occurrence_whatsapp=n where id=p_store;
end $$;
revoke all on function public.pitacco_set_incident_whatsapp(uuid,text) from public,anon,authenticated;
grant execute on function public.pitacco_set_incident_whatsapp(uuid,text) to authenticated;
