-- Central de suporte: mensagens auditáveis e operações autorizadas por RPC.
create table public.pitacco_support_tickets (
 id uuid primary key default gen_random_uuid(),
 store_id uuid not null references public.stores(id) on delete cascade,
 opened_by uuid not null references auth.users(id),
 category text not null check (category in ('pedidos','impressoes','entregas','financeiro','integracoes','acesso','outros')),
 subject text not null check (char_length(subject) between 8 and 160),
 description text not null check (char_length(description) between 15 and 3000),
 status text not null default 'open' check (status in ('open','in_progress','waiting_store','resolved','closed')),
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);
create index pitacco_support_tickets_recent_idx on public.pitacco_support_tickets(store_id,updated_at desc);
create index pitacco_support_tickets_status_idx on public.pitacco_support_tickets(status,updated_at desc);
alter table public.pitacco_support_tickets enable row level security;
revoke all on public.pitacco_support_tickets from public,anon,authenticated;

create table public.pitacco_support_messages (
 id uuid primary key default gen_random_uuid(),
 ticket_id uuid not null references public.pitacco_support_tickets(id) on delete cascade,
 sender_id uuid not null references auth.users(id),
 body text not null check (char_length(body) between 4 and 3000),
 event_type text not null default 'message' check (event_type in ('message','status')),
 created_at timestamptz not null default now()
);
create index pitacco_support_messages_timeline on public.pitacco_support_messages(ticket_id,created_at,id);
alter table public.pitacco_support_messages enable row level security;
revoke all on public.pitacco_support_messages from public,anon,authenticated;

create function public.pitacco_support_create(
 p_store uuid,p_category text,p_subject text,p_description text
) returns uuid language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); ticket uuid;
begin
 if actor is null or p_store is null or
  not (public.is_store_manager(p_store) or public.pitacco_is_platform_owner()) then
  raise exception 'Acesso não autorizado ao suporte desta loja' using errcode='42501';
 end if;
 if p_category is null or p_category not in ('pedidos','impressoes','entregas','financeiro','integracoes','acesso','outros')
    or length(trim(coalesce(p_subject,''))) not between 8 and 160
    or length(trim(coalesce(p_description,''))) not between 15 and 3000 then
   raise exception 'Confira o assunto e a descrição do chamado';
 end if;
 -- Limite simples de abuso, inclusive para a interface de proprietário.
 if (select count(*) from public.pitacco_support_tickets
     where opened_by=actor and created_at>now()-interval '24 hours')>=15 then
   raise exception 'Limite diário de chamados atingido';
 end if;
 insert into public.pitacco_support_tickets(store_id,opened_by,category,subject,description)
 values(p_store,actor,p_category,trim(p_subject),trim(p_description))
 returning id into ticket;
 insert into public.pitacco_support_messages(ticket_id,sender_id,body)
 values(ticket,actor,trim(p_description));
 return ticket;
end $$;
revoke all on function public.pitacco_support_create(uuid,text,text,text) from public,anon,authenticated;
grant execute on function public.pitacco_support_create(uuid,text,text,text) to authenticated;

create function public.pitacco_support_list(
 p_store uuid default null,p_status text default null,p_page integer default 0
) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare actor uuid:=auth.uid(); owner boolean; rows jsonb;
begin
 if actor is null then raise exception 'É necessário entrar na conta' using errcode='42501'; end if;
 owner:=public.pitacco_is_platform_owner();
 if p_store is null and not owner then raise exception 'Informe uma loja autorizada' using errcode='42501';end if;
 if p_store is not null and not (owner or public.is_store_manager(p_store)) then
  raise exception 'Acesso não autorizado ao suporte desta loja' using errcode='42501';end if;
 if (p_status is not null and p_status not in ('open','in_progress','waiting_store','resolved','closed'))
 or p_page is null or p_page not between 0 and 10000 then
  raise exception 'Filtros de suporte inválidos';
 end if;
 select coalesce(jsonb_agg(to_jsonb(row) order by row.updated_at desc,row.id desc),'[]'::jsonb)
 into rows from (
  select t.id,t.store_id,s.name as store_name,t.category,t.subject,t.status,
    t.created_at,t.updated_at,
    (select count(*) from public.pitacco_support_messages m where m.ticket_id=t.id) as messages
  from public.pitacco_support_tickets t join public.stores s on s.id=t.store_id
  where (p_store is null or t.store_id=p_store) and (p_status is null or t.status=p_status)
  order by t.updated_at desc,t.id desc offset p_page*25 limit 26
 ) row;
 return jsonb_build_object('rows',case when jsonb_array_length(rows)>25 then rows-25 else rows end,
  'has_more',jsonb_array_length(rows)>25);
end $$;
revoke all on function public.pitacco_support_list(uuid,text,integer) from public,anon,authenticated;
grant execute on function public.pitacco_support_list(uuid,text,integer) to authenticated;

create function public.pitacco_support_details(p_ticket uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare actor uuid:=auth.uid(); ticket public.pitacco_support_tickets%rowtype; messages jsonb;
begin
 if actor is null then raise exception 'Acesso não autorizado' using errcode='42501';end if;
 select * into ticket from public.pitacco_support_tickets where id=p_ticket;
 if not found or not (public.pitacco_is_platform_owner() or public.is_store_manager(ticket.store_id)) then
  raise exception 'Chamado indisponível' using errcode='42501';end if;
 select coalesce(jsonb_agg(jsonb_build_object('id',m.id,'body',m.body,'event_type',m.event_type,
  'created_at',m.created_at,'from_admin',exists(select 1 from pitacco_private.platform_owner po where po.user_id=m.sender_id))
  order by m.created_at,m.id),'[]'::jsonb) into messages
 from public.pitacco_support_messages m where m.ticket_id=p_ticket;
 return jsonb_build_object('ticket',jsonb_build_object('id',ticket.id,'store_id',ticket.store_id,
  'category',ticket.category,'subject',ticket.subject,'description',ticket.description,
  'status',ticket.status,'created_at',ticket.created_at,'updated_at',ticket.updated_at),
  'messages',messages);
end $$;
revoke all on function public.pitacco_support_details(uuid) from public,anon,authenticated;
grant execute on function public.pitacco_support_details(uuid) to authenticated;

create function public.pitacco_support_reply(p_ticket uuid,p_message text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); ticket public.pitacco_support_tickets%rowtype; owner boolean;
begin
 if actor is null or length(trim(coalesce(p_message,''))) not between 4 and 3000 then
  raise exception 'Mensagem inválida ou sem autorização' using errcode='42501';end if;
 select * into ticket from public.pitacco_support_tickets where id=p_ticket for update;
 owner:=public.pitacco_is_platform_owner();
 if not found or not (owner or public.is_store_manager(ticket.store_id)) then
  raise exception 'Chamado indisponível' using errcode='42501';end if;
 if ticket.status='closed' then raise exception 'Chamado encerrado. Abra um novo chamado';end if;
 insert into public.pitacco_support_messages(ticket_id,sender_id,body)
 values(p_ticket,actor,trim(p_message));
 update public.pitacco_support_tickets set status=case when owner then 'waiting_store' else 'open' end,
  updated_at=now() where id=p_ticket;
 return jsonb_build_object('sent',true);
end $$;
revoke all on function public.pitacco_support_reply(uuid,text) from public,anon,authenticated;
grant execute on function public.pitacco_support_reply(uuid,text) to authenticated;

create function public.pitacco_owner_support_status(p_ticket uuid,p_status text,p_reason text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); ticket public.pitacco_support_tickets%rowtype;
begin
 if actor is null or not public.pitacco_is_platform_owner() then
  raise exception 'Acesso exclusivo do proprietário' using errcode='42501';end if;
 if p_status not in ('open','in_progress','waiting_store','resolved','closed')
  or length(trim(coalesce(p_reason,''))) not between 5 and 1000 then
  raise exception 'Informe a situação e o motivo da alteração';end if;
 select * into ticket from public.pitacco_support_tickets where id=p_ticket for update;
 if not found then raise exception 'Chamado não encontrado';end if;
 if ticket.status=p_status then raise exception 'O chamado já está nessa situação';end if;
 update public.pitacco_support_tickets set status=p_status,updated_at=now() where id=p_ticket;
 insert into public.pitacco_support_messages(ticket_id,sender_id,body,event_type)
 values(p_ticket,actor,'Situação: '||ticket.status||' → '||p_status||'. '||trim(p_reason),'status');
 return jsonb_build_object('updated',true,'status',p_status);
end $$;
revoke all on function public.pitacco_owner_support_status(uuid,text,text) from public,anon,authenticated;
grant execute on function public.pitacco_owner_support_status(uuid,text,text) to authenticated;
