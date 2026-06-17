alter table public.messages
add column archived_at timestamptz;

create index messages_user_unarchived_created_at_idx
  on public.messages (user_id, created_at asc)
  where archived_at is null;

drop index if exists public.topics_user_type_name_idx;

create or replace function public.commit_archive_entry(
  p_user_id uuid,
  p_summary text,
  p_emotion varchar,
  p_emotion_intensity float,
  p_category varchar,
  p_people text[],
  p_places text[],
  p_keywords text[],
  p_message_ids text[],
  p_created_at timestamptz
)
returns public.entries
language plpgsql
security definer
set search_path = public
as $$
declare
  v_entry public.entries;
  v_message_count int;
  v_name text;
  v_fact jsonb;
  v_archived_at timestamptz := now();
begin
  if auth.role() is distinct from 'service_role'
    and auth.uid() is distinct from p_user_id then
    raise exception 'not allowed';
  end if;

  if not pg_try_advisory_xact_lock(hashtext(p_user_id::text)) then
    return null;
  end if;

  select count(*)
    into v_message_count
  from public.messages
  where user_id = p_user_id
    and archived_at is null
    and id::text = any(p_message_ids);

  if v_message_count <> cardinality(p_message_ids) then
    return null;
  end if;

  insert into public.entries (
    user_id,
    summary,
    emotion,
    emotion_intensity,
    category,
    people,
    places,
    keywords,
    message_ids,
    created_at
  )
  values (
    p_user_id,
    p_summary,
    p_emotion,
    p_emotion_intensity,
    p_category,
    p_people,
    p_places,
    p_keywords,
    p_message_ids,
    p_created_at
  )
  returning * into v_entry;

  for v_name in
    select distinct btrim(value)
    from unnest(p_people) as value
    where btrim(value) <> ''
  loop
    v_fact := jsonb_build_array(
      jsonb_build_object(
        'text', v_entry.summary,
        'source_entry_id', v_entry.id,
        'created_at', v_entry.created_at
      )
    );

    insert into public.topics (
      user_id,
      type,
      name,
      first_mentioned_at,
      last_mentioned_at,
      mention_count,
      facts
    )
    values (
      p_user_id,
      'person',
      v_name,
      v_entry.created_at,
      v_entry.created_at,
      1,
      v_fact
    )
    on conflict (user_id, type, name)
    do update set
      last_mentioned_at = excluded.last_mentioned_at,
      mention_count = public.topics.mention_count + 1,
      facts = public.topics.facts || excluded.facts;
  end loop;

  for v_name in
    select distinct btrim(value)
    from unnest(p_places) as value
    where btrim(value) <> ''
  loop
    v_fact := jsonb_build_array(
      jsonb_build_object(
        'text', v_entry.summary,
        'source_entry_id', v_entry.id,
        'created_at', v_entry.created_at
      )
    );

    insert into public.topics (
      user_id,
      type,
      name,
      first_mentioned_at,
      last_mentioned_at,
      mention_count,
      facts
    )
    values (
      p_user_id,
      'place',
      v_name,
      v_entry.created_at,
      v_entry.created_at,
      1,
      v_fact
    )
    on conflict (user_id, type, name)
    do update set
      last_mentioned_at = excluded.last_mentioned_at,
      mention_count = public.topics.mention_count + 1,
      facts = public.topics.facts || excluded.facts;
  end loop;

  update public.messages
  set archived_at = v_archived_at
  where user_id = p_user_id
    and archived_at is null
    and id::text = any(p_message_ids);

  return v_entry;
end;
$$;

revoke all on function public.commit_archive_entry(
  uuid,
  text,
  varchar,
  float,
  varchar,
  text[],
  text[],
  text[],
  text[],
  timestamptz
) from public;

grant execute on function public.commit_archive_entry(
  uuid,
  text,
  varchar,
  float,
  varchar,
  text[],
  text[],
  text[],
  text[],
  timestamptz
) to authenticated, service_role;

create or replace function public.list_idle_archive_users(
  p_idle_before timestamptz,
  p_limit int default 50
)
returns table(user_id uuid)
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'not allowed';
  end if;

  return query
  select messages.user_id
  from public.messages
  where archived_at is null
  group by messages.user_id
  having max(created_at) < p_idle_before
  order by max(created_at) asc
  limit p_limit;
end;
$$;

revoke all on function public.list_idle_archive_users(timestamptz, int) from public;
grant execute on function public.list_idle_archive_users(timestamptz, int) to service_role;
