create or replace function public.commit_archive_entries(
  p_user_id uuid,
  p_entries jsonb
)
returns setof public.entries
language plpgsql
security definer
set search_path = public
as $$
declare
  v_item jsonb;
  v_entry public.entries;
  v_message_count int;
  v_all_message_ids text[];
  v_message_ids text[];
  v_people text[];
  v_places text[];
  v_pets text[];
  v_keywords text[];
  v_name text;
  v_fact jsonb;
  v_archived_at timestamptz := now();
  v_created_at timestamptz;
begin
  if auth.role() is distinct from 'service_role'
    and auth.uid() is distinct from p_user_id then
    raise exception 'not allowed';
  end if;

  if not pg_try_advisory_xact_lock(hashtext(p_user_id::text)) then
    return;
  end if;

  select coalesce(array_agg(distinct message_id.value), '{}'::text[])
    into v_all_message_ids
  from jsonb_array_elements(coalesce(p_entries, '[]'::jsonb)) as entry_item(value)
  cross join lateral jsonb_array_elements_text(
    coalesce(entry_item.value -> 'message_ids', '[]'::jsonb)
  ) as message_id(value);

  if cardinality(v_all_message_ids) = 0 then
    return;
  end if;

  select count(*)
    into v_message_count
  from public.messages
  where user_id = p_user_id
    and archived_at is null
    and id::text = any(v_all_message_ids);

  if v_message_count <> cardinality(v_all_message_ids) then
    return;
  end if;

  for v_item in
    select value
    from jsonb_array_elements(coalesce(p_entries, '[]'::jsonb)) as entry_item(value)
  loop
    select coalesce(array_agg(value), '{}'::text[])
      into v_message_ids
    from jsonb_array_elements_text(coalesce(v_item -> 'message_ids', '[]'::jsonb)) as value;

    if cardinality(v_message_ids) = 0 then
      continue;
    end if;

    select coalesce(array_agg(btrim(value)), '{}'::text[])
      into v_people
    from jsonb_array_elements_text(coalesce(v_item -> 'people', '[]'::jsonb)) as value
    where btrim(value) <> '';

    select coalesce(array_agg(btrim(value)), '{}'::text[])
      into v_places
    from jsonb_array_elements_text(coalesce(v_item -> 'places', '[]'::jsonb)) as value
    where btrim(value) <> '';

    select coalesce(array_agg(btrim(value)), '{}'::text[])
      into v_pets
    from jsonb_array_elements_text(coalesce(v_item -> 'pets', '[]'::jsonb)) as value
    where btrim(value) <> '';

    select coalesce(array_agg(btrim(value)), '{}'::text[])
      into v_keywords
    from jsonb_array_elements_text(coalesce(v_item -> 'keywords', '[]'::jsonb)) as value
    where btrim(value) <> '';

    v_created_at := coalesce(nullif(v_item ->> 'created_at', '')::timestamptz, now());

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
      v_item ->> 'summary',
      v_item ->> 'emotion',
      (v_item ->> 'emotion_intensity')::float,
      v_item ->> 'category',
      v_people,
      v_places,
      v_keywords,
      v_message_ids,
      v_created_at
    )
    returning * into v_entry;

    for v_name in
      select distinct unnest(v_people)
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
      select distinct unnest(v_places)
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

    for v_name in
      select distinct unnest(v_pets)
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
        'pet',
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

    return next v_entry;
  end loop;

  update public.messages
  set archived_at = v_archived_at
  where user_id = p_user_id
    and archived_at is null
    and id::text = any(v_all_message_ids);
end;
$$;

revoke all on function public.commit_archive_entries(uuid, jsonb) from public;
grant execute on function public.commit_archive_entries(uuid, jsonb) to authenticated, service_role;
