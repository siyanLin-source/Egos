-- 提醒事项 v1：对话式创建（create_reminder 工具）+ 手动添加。
-- ⚠️ 迁移文件产出 ≠ 已生效：需要在 Supabase SQL Editor 手动执行并确认。

create table if not exists public.reminders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null check (
    char_length(btrim(title)) > 0
    and char_length(title) <= 200
  ),
  due_at timestamptz not null,
  location text,
  notes text,
  status text not null default 'pending' check (
    status in ('pending', 'done', 'dismissed')
  ),
  source text not null default 'chat' check (
    source in ('chat', 'manual')
  ),
  source_conversation_id uuid references public.conversations(id) on delete set null,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create index if not exists reminders_user_status_due_idx
  on public.reminders (user_id, status, due_at);

alter table public.reminders enable row level security;

-- RLS：仅本人可读写（照抄 entries 的策略写法）。
drop policy if exists "Users can read own reminders" on public.reminders;
create policy "Users can read own reminders"
on public.reminders
for select
to authenticated
using (auth.uid() = user_id);

drop policy if exists "Users can insert own reminders" on public.reminders;
create policy "Users can insert own reminders"
on public.reminders
for insert
to authenticated
with check (auth.uid() = user_id);

drop policy if exists "Users can update own reminders" on public.reminders;
create policy "Users can update own reminders"
on public.reminders
for update
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "Users can delete own reminders" on public.reminders;
create policy "Users can delete own reminders"
on public.reminders
for delete
to authenticated
using (auth.uid() = user_id);
