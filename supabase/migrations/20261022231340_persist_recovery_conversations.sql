-- Account-owned plaintext conversations. Provider results and booking data stay out of this table.
create table public.recovery_conversations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  title text not null check (char_length(title) between 1 and 120),
  messages jsonb not null default '[]'::jsonb,
  trip jsonb,
  revision integer not null default 0 check (revision >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint recovery_conversations_messages_bound check (
    case when jsonb_typeof(messages) = 'array'
      then jsonb_array_length(messages) <= 1000 and octet_length(messages::text) <= 1100000
      else false
    end
  ),
  constraint recovery_conversations_trip_bound check (
    trip is null or (jsonb_typeof(trip) = 'object' and octet_length(trip::text) <= 16384)
  )
);

create index recovery_conversations_user_recent_idx
  on public.recovery_conversations (user_id, updated_at desc, id);

alter table public.recovery_conversations enable row level security;

revoke all on table public.recovery_conversations from public, anon, authenticated;
grant select, insert, update, delete on table public.recovery_conversations to authenticated;

create policy recovery_conversations_select_own
  on public.recovery_conversations for select to authenticated
  using ((select auth.uid()) = user_id);

create policy recovery_conversations_insert_own
  on public.recovery_conversations for insert to authenticated
  with check ((select auth.uid()) = user_id);

create policy recovery_conversations_update_own
  on public.recovery_conversations for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy recovery_conversations_delete_own
  on public.recovery_conversations for delete to authenticated
  using ((select auth.uid()) = user_id);

-- The trigger runs with the caller's privileges; it cannot bypass ownership policies.
create function public.guard_recovery_conversation()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  message jsonb;
begin
  if tg_op = 'UPDATE' then
    if new.id is distinct from old.id or new.user_id is distinct from old.user_id then
      raise exception 'Conversation identity cannot be changed.' using errcode = '23514';
    end if;
    -- Clients also filter on the previous revision, so concurrent stale writes affect zero rows.
    if new.revision <> old.revision + 1 then
      raise exception 'Conversation revision must advance by one.' using errcode = '23514';
    end if;
    new.created_at := old.created_at;
  else
    if new.revision <> 0 then
      raise exception 'A new conversation must start at revision zero.' using errcode = '23514';
    end if;
    new.created_at := clock_timestamp();
  end if;
  new.updated_at := clock_timestamp();

  if jsonb_typeof(new.messages) is distinct from 'array' then
    raise exception 'Conversation messages must be an array.' using errcode = '23514';
  end if;
  if jsonb_array_length(new.messages) > 1000 or octet_length(new.messages::text) > 1100000 then
    raise exception 'Conversation history is too large.' using errcode = '23514';
  end if;
  for message in select value from jsonb_array_elements(new.messages) loop
    if jsonb_typeof(message) is distinct from 'object' then
      raise exception 'A conversation message must be an object.' using errcode = '23514';
    end if;
    if (message - array['id', 'role', 'content', 'revision']) <> '{}'::jsonb
      or jsonb_typeof(message -> 'id') is distinct from 'string'
      or char_length(message ->> 'id') not between 1 and 120
      or jsonb_typeof(message -> 'role') is distinct from 'string'
      or message ->> 'role' not in ('user', 'assistant')
      or jsonb_typeof(message -> 'content') is distinct from 'string'
      or char_length(message ->> 'content') > 1000
      or jsonb_typeof(message -> 'revision') is distinct from 'number'
      or (message ->> 'revision') !~ '^[0-9]+$'
    then
      raise exception 'Invalid plaintext conversation message.' using errcode = '23514';
    end if;
  end loop;
  return new;
end;
$$;

revoke all on function public.guard_recovery_conversation() from public, anon, authenticated;

create trigger guard_recovery_conversation
  before insert or update on public.recovery_conversations
  for each row execute function public.guard_recovery_conversation();
