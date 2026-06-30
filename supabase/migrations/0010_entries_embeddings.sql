-- Sprint 2 收尾 + Sprint 3 地基：给 entries 加向量列，并提供向量检索 RPC。
-- 需要 pgvector 扩展（Supabase: Database → Extensions → 启用 "vector"）。
-- text-embedding-3-small 是 1536 维。
create extension if not exists vector;

alter table public.entries
  add column if not exists embedding vector(1536);

-- 余弦距离的近邻索引。数据量小的时候顺序扫描也没问题，这个索引是为以后规模化准备的。
create index if not exists entries_embedding_idx
  on public.entries
  using hnsw (embedding vector_cosine_ops);

-- 把某条 entry 的向量写进去。归档时在应用层算好向量后调用。
-- 走 security definer + 显式 auth 校验，和 commit_archive_entries 同一套权限模型；
-- 只能写自己的（或 service_role 后台）。
create or replace function public.set_entry_embedding(
  p_user_id uuid,
  p_entry_id uuid,
  p_embedding float8[]
)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  if auth.role() is distinct from 'service_role'
    and auth.uid() is distinct from p_user_id then
    raise exception 'not allowed';
  end if;

  if p_embedding is null or cardinality(p_embedding) <> 1536 then
    raise exception 'embedding must have 1536 dimensions';
  end if;

  update public.entries
  set embedding = ('[' || array_to_string(p_embedding, ',') || ']')::vector
  where id = p_entry_id
    and user_id = p_user_id;
end;
$$;

revoke all on function public.set_entry_embedding(uuid, uuid, float8[]) from public;
grant execute on function public.set_entry_embedding(uuid, uuid, float8[])
  to authenticated, service_role;

-- Ask Your Life / 实时记忆召回的核心：按向量相似度找回这个用户自己的真实 entry。
-- 永远只返回 user 自己的、非危机的记录；可选时间窗过滤。
-- 返回 similarity = 1 - 余弦距离（越大越相似）。
create or replace function public.match_entries(
  p_user_id uuid,
  p_query_embedding float8[],
  p_match_count int default 8,
  p_since timestamptz default null,
  p_exclude_crisis boolean default true
)
returns table (
  id uuid,
  user_id uuid,
  summary text,
  emotion varchar,
  emotion_intensity float,
  category varchar,
  people text[],
  places text[],
  keywords text[],
  message_ids text[],
  is_crisis boolean,
  created_at timestamptz,
  updated_at timestamptz,
  similarity float
)
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_query vector;
begin
  if auth.role() is distinct from 'service_role'
    and auth.uid() is distinct from p_user_id then
    raise exception 'not allowed';
  end if;

  if p_query_embedding is null or cardinality(p_query_embedding) <> 1536 then
    raise exception 'query embedding must have 1536 dimensions';
  end if;

  v_query := ('[' || array_to_string(p_query_embedding, ',') || ']')::vector;

  return query
  select
    e.id,
    e.user_id,
    e.summary,
    e.emotion,
    e.emotion_intensity,
    e.category,
    e.people,
    e.places,
    e.keywords,
    e.message_ids,
    e.is_crisis,
    e.created_at,
    e.updated_at,
    1 - (e.embedding <=> v_query) as similarity
  from public.entries e
  where e.user_id = p_user_id
    and e.embedding is not null
    and (not p_exclude_crisis or e.is_crisis = false)
    and (p_since is null or e.created_at >= p_since)
  order by e.embedding <=> v_query
  limit greatest(1, least(coalesce(p_match_count, 8), 50));
end;
$$;

revoke all on function public.match_entries(uuid, float8[], int, timestamptz, boolean) from public;
grant execute on function public.match_entries(uuid, float8[], int, timestamptz, boolean)
  to authenticated, service_role;
