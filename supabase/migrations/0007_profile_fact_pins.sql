-- "想记住的事"：让用户把某条画像事实置顶/收藏。
alter table public.profile_facts
  add column if not exists pinned boolean not null default false;

create index if not exists profile_facts_user_pinned_idx
  on public.profile_facts (user_id, last_observed_at desc)
  where pinned;
