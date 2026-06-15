create type public.message_sender as enum ('user', 'ai');

create table public.messages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  sender public.message_sender not null,
  content text not null check (char_length(content) > 0),
  image_url text,
  created_at timestamptz not null default now()
);

alter table public.messages enable row level security;

create index messages_user_created_at_idx
  on public.messages (user_id, created_at asc);

create policy "Users can read own messages"
on public.messages
for select
to authenticated
using (auth.uid() = user_id);

create policy "Users can insert own messages"
on public.messages
for insert
to authenticated
with check (auth.uid() = user_id);

create policy "Users can delete own messages"
on public.messages
for delete
to authenticated
using (auth.uid() = user_id);

-- No update policy: Message is immutable source material.
