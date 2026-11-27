-- Apply AFTER 021_whatsapp_notifications.sql and the store-manager membership function.
begin;
create or replace function public.pitacco_save_whatsapp_settings(
 p_store_id uuid,p_enabled boolean,p_phone text,p_templates jsonb,p_events jsonb
) returns void language plpgsql security definer set search_path='' as $$
declare allowed text[]:=array['accepted','preparing','ready','out_for_delivery','ready_for_pickup','delivered']; k text; v text;
begin
 if (select auth.uid()) is null or not public.is_store_manager(p_store_id) then raise exception 'Acesso negado à loja' using errcode='42501'; end if;
 if jsonb_typeof(p_templates)<>'object' or jsonb_typeof(p_events)<>'object' then raise exception 'Formato inválido'; end if;
 for k,v in select key,value from jsonb_each_text(p_templates) loop
  if not k=any(allowed) or length(v)>1024 then raise exception 'Modelo inválido'; end if;
 end loop;
 for k,v in select key,value from jsonb_each_text(p_events) loop
  if not k=any(allowed) or v not in ('true','false') then raise exception 'Etapa inválida'; end if;
 end loop;
 if length(coalesce(p_phone,''))>35 then raise exception 'Número inválido'; end if;
 insert into public.store_whatsapp_settings(store_id,enabled,business_phone_display,message_templates,event_enabled,updated_at)
 values(p_store_id,coalesce(p_enabled,false),nullif(trim(p_phone),''),p_templates,p_events,now())
 on conflict(store_id) do update set enabled=excluded.enabled,business_phone_display=excluded.business_phone_display,message_templates=excluded.message_templates,event_enabled=excluded.event_enabled,updated_at=now();
end $$;
revoke all on function public.pitacco_save_whatsapp_settings(uuid,boolean,text,jsonb,jsonb) from public,anon;
grant execute on function public.pitacco_save_whatsapp_settings(uuid,boolean,text,jsonb,jsonb) to authenticated;
-- This RPC stores preferences ONLY. It cannot connect WhatsApp or dispatch messages.
commit;
