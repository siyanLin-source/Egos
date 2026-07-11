-- 用户设置：目前只有时区（提醒时间解析 + 对话时间感都靠它）。
-- 首次问候时由客户端时区自动回填；没有记录时代码侧兜底 Asia/Shanghai。
-- ⚠️ 迁移文件产出 ≠ 已生效：需要在 Supabase SQL Editor 手动执行并确认。

create table if not exists public.user_settings (
  user_id uuid primary key references auth.users(id) on delete cascade,
  timezone text not null default 'Asia/Shanghai' check (
    char_length(btrim(timezone)) > 0
    and char_length(timezone) <= 64
  ),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists user_settings_set_updated_at on public.user_settings;
create trigger user_settings_set_updated_at
before update on public.user_settings
for each row execute function public.set_updated_at();

alter table public.user_settings enable row level security;

drop policy if exists "Users can read own settings" on public.user_settings;
create policy "Users can read own settings"
on public.user_settings
for select
to authenticated
using (auth.uid() = user_id);

drop policy if exists "Users can insert own settings" on public.user_settings;
create policy "Users can insert own settings"
on public.user_settings
for insert
to authenticated
with check (auth.uid() = user_id);

drop policy if exists "Users can update own settings" on public.user_settings;
create policy "Users can update own settings"
on public.user_settings
for update
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "Users can delete own settings" on public.user_settings;
create policy "Users can delete own settings"
on public.user_settings
for delete
to authenticated
using (auth.uid() = user_id);
