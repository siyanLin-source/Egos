create table if not exists public.conversations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists conversations_user_created_at_idx
  on public.conversations (user_id, created_at desc);

drop trigger if exists conversations_set_updated_at on public.conversations;
create trigger conversations_set_updated_at
before update on public.conversations
for each row execute function public.set_updated_at();

alter table public.conversations enable row level security;

drop policy if exists "Users can read own conversations" on public.conversations;
create policy "Users can read own conversations"
on public.conversations
for select
to authenticated
using (auth.uid() = user_id);

drop policy if exists "Users can insert own conversations" on public.conversations;
create policy "Users can insert own conversations"
on public.conversations
for insert
to authenticated
with check (auth.uid() = user_id);

drop policy if exists "Users can update own conversations" on public.conversations;
create policy "Users can update own conversations"
on public.conversations
for update
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "Users can delete own conversations" on public.conversations;
create policy "Users can delete own conversations"
on public.conversations
for delete
to authenticated
using (auth.uid() = user_id);

alter table public.messages
add column if not exists conversation_id uuid references public.conversations(id) on delete restrict;

create index if not exists messages_user_conversation_created_at_idx
  on public.messages (user_id, conversation_id, created_at asc);

with message_users as (
  select
    user_id,
    min(created_at) as first_message_at,
    max(created_at) as last_message_at
  from public.messages
  group by user_id
)
insert into public.conversations (user_id, title, created_at, updated_at)
select
  message_users.user_id,
  '初始对话',
  message_users.first_message_at,
  message_users.last_message_at
from message_users
where not exists (
  select 1
  from public.conversations existing
  where existing.user_id = message_users.user_id
);

with first_conversation as (
  select distinct on (user_id)
    user_id,
    id
  from public.conversations
  order by user_id, created_at asc, id
)
update public.messages message
set conversation_id = first_conversation.id
from first_conversation
where message.user_id = first_conversation.user_id
  and message.conversation_id is null;

alter table public.messages
alter column conversation_id set not null;

create table if not exists public.user_conversation_state (
  user_id uuid primary key references auth.users(id) on delete cascade,
  current_conversation_id uuid references public.conversations(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists user_conversation_state_set_updated_at on public.user_conversation_state;
create trigger user_conversation_state_set_updated_at
before update on public.user_conversation_state
for each row execute function public.set_updated_at();

with latest_conversation as (
  select distinct on (user_id)
    user_id,
    id
  from public.conversations
  order by user_id, created_at desc, id desc
)
insert into public.user_conversation_state (user_id, current_conversation_id)
select user_id, id
from latest_conversation
on conflict (user_id)
do update set
  current_conversation_id = coalesce(
    public.user_conversation_state.current_conversation_id,
    excluded.current_conversation_id
  );

alter table public.user_conversation_state enable row level security;

drop policy if exists "Users can read own conversation state" on public.user_conversation_state;
create policy "Users can read own conversation state"
on public.user_conversation_state
for select
to authenticated
using (auth.uid() = user_id);

drop policy if exists "Users can insert own conversation state" on public.user_conversation_state;
create policy "Users can insert own conversation state"
on public.user_conversation_state
for insert
to authenticated
with check (auth.uid() = user_id);

drop policy if exists "Users can update own conversation state" on public.user_conversation_state;
create policy "Users can update own conversation state"
on public.user_conversation_state
for update
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "Users can delete own conversation state" on public.user_conversation_state;
create policy "Users can delete own conversation state"
on public.user_conversation_state
for delete
to authenticated
using (auth.uid() = user_id);

create or replace function public.ensure_message_conversation_owner()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.conversation_id is null then
    raise exception 'conversation_id is required';
  end if;

  if not exists (
    select 1
    from public.conversations conversation
    where conversation.id = new.conversation_id
      and conversation.user_id = new.user_id
  ) then
    raise exception 'conversation_id must belong to message user';
  end if;

  return new;
end;
$$;

drop trigger if exists messages_ensure_conversation_owner on public.messages;
create trigger messages_ensure_conversation_owner
before insert or update of conversation_id, user_id on public.messages
for each row execute function public.ensure_message_conversation_owner();

create or replace function public.ensure_user_conversation_state_owner()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.current_conversation_id is not null and not exists (
    select 1
    from public.conversations conversation
    where conversation.id = new.current_conversation_id
      and conversation.user_id = new.user_id
  ) then
    raise exception 'current_conversation_id must belong to state user';
  end if;

  return new;
end;
$$;

drop trigger if exists user_conversation_state_ensure_owner on public.user_conversation_state;
create trigger user_conversation_state_ensure_owner
before insert or update of current_conversation_id, user_id on public.user_conversation_state
for each row execute function public.ensure_user_conversation_state_owner();

revoke all on function public.ensure_message_conversation_owner() from public;
revoke all on function public.ensure_user_conversation_state_owner() from public;
