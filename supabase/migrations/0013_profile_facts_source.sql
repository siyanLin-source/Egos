-- 基本档案卡（称呼/生日/所在城市）：区分 AI 提取与用户手动编辑的画像事实。
-- 只补 source 列（confidence 等留给后续迁移，不在本次范围内扩散）。
-- 提取侧（commit_archive_entries RPC）不指定 source → 落默认值 'extracted'，无需改 RPC。
-- ⚠️ 迁移文件产出 ≠ 已生效：需要在 Supabase SQL Editor 手动执行并确认。

alter table public.profile_facts
  add column if not exists source text not null default 'extracted' check (
    source in ('extracted', 'user_edit')
  );
