alter table public.entries
  add column if not exists is_crisis boolean not null default false;

create index if not exists entries_user_non_crisis_created_at_idx
  on public.entries (user_id, created_at desc)
  where is_crisis = false;

update public.entries as entry
set is_crisis = true
where entry.is_crisis = false
  and (
    regexp_replace(entry.summary, '\s+', '', 'g') ~
      '(想死|不想活|活不下去|自杀|自尽|轻生|了结自己|结束生命|去死|自残|自伤|割腕|跳楼|绝望)'
    or exists (
      select 1
      from public.messages as message
      where message.user_id = entry.user_id
        and message.id::text = any(entry.message_ids)
        and regexp_replace(message.content, '\s+', '', 'g') ~
          '(想死|不想活|活不下去|自杀|自尽|轻生|了结自己|结束生命|去死|自残|自伤|割腕|跳楼|绝望)'
    )
  );

delete from public.profile_facts as fact
using public.entries as entry
where fact.source_entry_id = entry.id
  and entry.is_crisis = true;

with crisis_entries as (
  select id::text as id
  from public.entries
  where is_crisis = true
)
update public.topics as topic
set facts = coalesce(
  (
    select jsonb_agg(fact.value)
    from jsonb_array_elements(topic.facts) as fact(value)
    where not exists (
      select 1
      from crisis_entries
      where crisis_entries.id = fact.value ->> 'source_entry_id'
    )
  ),
  '[]'::jsonb
)
where exists (
  select 1
  from jsonb_array_elements(topic.facts) as fact(value)
  join crisis_entries on crisis_entries.id = fact.value ->> 'source_entry_id'
);

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
  v_profile_fact jsonb;
  v_profile_fact_text text;
  v_profile_fact_kind text;
  v_profile_fact_subject text;
  v_profile_fact_importance float;
  v_profile_fact_claim_key text;
  v_profile_fact_key text;
  v_archived_at timestamptz := now();
  v_created_at timestamptz;
  v_is_crisis boolean;
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
    v_is_crisis := coalesce(nullif(v_item ->> 'is_crisis', '')::boolean, false);

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
      is_crisis,
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
      v_is_crisis,
      v_created_at
    )
    returning * into v_entry;

    if v_is_crisis then
      return next v_entry;
      continue;
    end if;

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

    for v_profile_fact in
      select value
      from jsonb_array_elements(coalesce(v_item -> 'profile_facts', '[]'::jsonb)) as profile_fact(value)
    loop
      if jsonb_typeof(v_profile_fact) is distinct from 'object' then
        continue;
      end if;

      v_profile_fact_text := btrim(coalesce(v_profile_fact ->> 'text', ''));

      if v_profile_fact_text = '' then
        continue;
      end if;

      v_profile_fact_kind := coalesce(nullif(v_profile_fact ->> 'kind', ''), 'other');

      if v_profile_fact_kind not in (
        'identity',
        'relationship',
        'pet',
        'interest',
        'preference',
        'routine',
        'goal',
        'health',
        'work',
        'school',
        'place',
        'other'
      ) then
        v_profile_fact_kind := 'other';
      end if;

      v_profile_fact_subject := coalesce(nullif(btrim(v_profile_fact ->> 'subject'), ''), '你');
      v_profile_fact_importance := greatest(
        0.0,
        least(
          1.0,
          coalesce(nullif(v_profile_fact ->> 'importance', '')::float, 0.5)
        )
      );
      v_profile_fact_claim_key := nullif(
        regexp_replace(lower(btrim(coalesce(v_profile_fact ->> 'claim_key', ''))), '[[:space:]]+', '', 'g'),
        ''
      );

      if v_profile_fact_claim_key is null then
        v_profile_fact_key := public.profile_fact_claim_key(
          v_profile_fact_subject,
          v_profile_fact_kind,
          v_profile_fact_text
        );
      else
        v_profile_fact_key := md5(
          regexp_replace(lower(v_profile_fact_subject), '[[:space:]]+', '', 'g')
          || '|'
          || v_profile_fact_kind
          || '|'
          || v_profile_fact_claim_key
        );
      end if;

      insert into public.profile_facts (
        user_id,
        kind,
        subject,
        text,
        fact_key,
        importance,
        source_entry_id,
        source_message_ids,
        first_observed_at,
        last_observed_at
      )
      values (
        p_user_id,
        v_profile_fact_kind,
        v_profile_fact_subject,
        v_profile_fact_text,
        v_profile_fact_key,
        v_profile_fact_importance,
        v_entry.id,
        v_message_ids,
        v_entry.created_at,
        v_entry.created_at
      )
      on conflict (user_id, fact_key)
      do update set
        subject = excluded.subject,
        text = excluded.text,
        importance = greatest(public.profile_facts.importance, excluded.importance),
        source_entry_id = excluded.source_entry_id,
        source_message_ids = (
          select coalesce(array_agg(distinct source_message_id), excluded.source_message_ids)
          from unnest(public.profile_facts.source_message_ids || excluded.source_message_ids) as merged(source_message_id)
        ),
        last_observed_at = greatest(public.profile_facts.last_observed_at, excluded.last_observed_at);
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
