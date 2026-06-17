create table public.entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  summary text not null check (
    char_length(btrim(summary)) > 0
    and char_length(summary) <= 120
  ),
  emotion varchar(20) not null check (
    emotion in ('开心', '平静', '低落', '烦躁', '焦虑', '感动')
  ),
  emotion_intensity float not null check (
    emotion_intensity >= 0.0
    and emotion_intensity <= 1.0
  ),
  category varchar(20) not null check (
    category in ('人际关系', '家人', '美食', '工作', '健康', '想法', '地点', '宠物', '其他')
  ),
  people text[] not null default '{}'::text[],
  places text[] not null default '{}'::text[],
  keywords text[] not null default '{}'::text[],
  message_ids text[] not null check (cardinality(message_ids) > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.topics (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  type varchar(20) not null check (type in ('person', 'place', 'pet')),
  name varchar(100) not null check (char_length(btrim(name)) > 0),
  first_mentioned_at timestamptz not null default now(),
  last_mentioned_at timestamptz not null default now(),
  mention_count int not null default 1 check (mention_count >= 1),
  facts jsonb not null default '[]'::jsonb check (jsonb_typeof(facts) = 'array'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, type, name)
);

create index entries_user_created_at_idx
  on public.entries (user_id, created_at desc);

create index entries_user_emotion_idx
  on public.entries (user_id, emotion);

create index entries_user_category_idx
  on public.entries (user_id, category);

create index entries_message_ids_idx
  on public.entries using gin (message_ids);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger entries_set_updated_at
before update on public.entries
for each row execute function public.set_updated_at();

create trigger topics_set_updated_at
before update on public.topics
for each row execute function public.set_updated_at();

alter table public.entries enable row level security;
alter table public.topics enable row level security;

create policy "Users can read own entries"
on public.entries
for select
to authenticated
using (auth.uid() = user_id);

create policy "Users can insert own entries"
on public.entries
for insert
to authenticated
with check (auth.uid() = user_id);

create policy "Users can update own entries"
on public.entries
for update
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

create policy "Users can delete own entries"
on public.entries
for delete
to authenticated
using (auth.uid() = user_id);

create policy "Users can read own topics"
on public.topics
for select
to authenticated
using (auth.uid() = user_id);

create policy "Users can insert own topics"
on public.topics
for insert
to authenticated
with check (auth.uid() = user_id);

create policy "Users can update own topics"
on public.topics
for update
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

create policy "Users can delete own topics"
on public.topics
for delete
to authenticated
using (auth.uid() = user_id);
