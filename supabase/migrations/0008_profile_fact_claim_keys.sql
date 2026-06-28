create or replace function public.profile_fact_claim_key(
  p_subject text,
  p_kind text,
  p_text text
)
returns text
language plpgsql
immutable
as $$
declare
  v_subject text;
  v_kind text;
  v_text text;
  v_claim text;
begin
  v_subject := lower(regexp_replace(coalesce(nullif(btrim(p_subject), ''), '你'), '[[:space:]]+', '', 'g'));
  v_kind := coalesce(nullif(btrim(p_kind), ''), 'other');
  v_text := lower(
    regexp_replace(
      coalesce(p_text, ''),
      '[[:space:][:punct:]。！？？，；：、（）【】「」『』]+',
      '',
      'g'
    )
  );

  if v_kind = 'identity' and v_text ~ '^(你|我)?(叫|名字是|是)' then
    v_claim := 'name';
  elsif position('男朋友' in v_text) > 0 then
    v_claim := 'partner:boyfriend';
  elsif position('女朋友' in v_text) > 0 then
    v_claim := 'partner:girlfriend';
  elsif position('减肥' in v_text) > 0 then
    v_claim := 'health:weight_loss';
  elsif position('健身' in v_text) > 0 then
    v_claim := 'health:fitness';
  elsif position('吉他' in v_text) > 0 then
    v_claim := 'interest:guitar';
  else
    v_claim := regexp_replace(
      v_text,
      '^(你|我|现在|目前|最近|正在|一直|已经|开始|有|是|在)+',
      '',
      'g'
    );
  end if;

  return md5(v_subject || '|' || v_kind || '|' || coalesce(nullif(v_claim, ''), v_text));
end;
$$;

-- Backfill obvious atomic facts from old compound rows before deduping.
with boyfriend_candidates as (
  select
    user_id,
    max(greatest(importance, 0.75)) as importance,
    (array_remove(array_agg(source_entry_id order by last_observed_at desc), null))[1] as source_entry_id,
    coalesce(array_agg(distinct source_message_id) filter (where source_message_id is not null), '{}'::text[]) as source_message_ids,
    min(first_observed_at) as first_observed_at,
    max(last_observed_at) as last_observed_at
  from public.profile_facts
  left join lateral unnest(source_message_ids) as source_message_id on true
  where text like '%男朋友%'
  group by user_id
)
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
select
  user_id,
  'relationship',
  '你',
  '你有男朋友',
  public.profile_fact_claim_key('你', 'relationship', '你有男朋友'),
  greatest(importance, 0.75),
  source_entry_id,
  source_message_ids,
  first_observed_at,
  last_observed_at
from boyfriend_candidates
on conflict (user_id, fact_key)
do update set
  importance = greatest(public.profile_facts.importance, excluded.importance),
  source_message_ids = (
    select coalesce(array_agg(distinct source_message_id), excluded.source_message_ids)
    from unnest(public.profile_facts.source_message_ids || excluded.source_message_ids) as merged(source_message_id)
  ),
  last_observed_at = greatest(public.profile_facts.last_observed_at, excluded.last_observed_at);

with fitness_candidates as (
  select
    user_id,
    max(greatest(importance, 0.65)) as importance,
    (array_remove(array_agg(source_entry_id order by last_observed_at desc), null))[1] as source_entry_id,
    coalesce(array_agg(distinct source_message_id) filter (where source_message_id is not null), '{}'::text[]) as source_message_ids,
    min(first_observed_at) as first_observed_at,
    max(last_observed_at) as last_observed_at
  from public.profile_facts
  left join lateral unnest(source_message_ids) as source_message_id on true
  where text like '%健身%' and text like '%减肥%'
  group by user_id
)
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
select
  user_id,
  'health',
  '你',
  '你在健身',
  public.profile_fact_claim_key('你', 'health', '你在健身'),
  greatest(importance, 0.65),
  source_entry_id,
  source_message_ids,
  first_observed_at,
  last_observed_at
from fitness_candidates
on conflict (user_id, fact_key)
do update set
  importance = greatest(public.profile_facts.importance, excluded.importance),
  source_message_ids = (
    select coalesce(array_agg(distinct source_message_id), excluded.source_message_ids)
    from unnest(public.profile_facts.source_message_ids || excluded.source_message_ids) as merged(source_message_id)
  ),
  last_observed_at = greatest(public.profile_facts.last_observed_at, excluded.last_observed_at);

update public.profile_facts
set text = btrim(regexp_replace(text, '[，,；;].*$', ''))
where kind = 'identity'
  and text ~ '^(你)?叫'
  and text ~ '[，,；;]';

update public.profile_facts
set
  kind = 'health',
  subject = '你',
  text = '你在减肥'
where text like '%减肥%';

drop table if exists profile_fact_rekey;
create temporary table profile_fact_rekey on commit drop as
select
  id,
  user_id,
  public.profile_fact_claim_key(subject, kind, text) as new_fact_key
from public.profile_facts;

drop table if exists profile_fact_ranked;
create temporary table profile_fact_ranked on commit drop as
select
  pf.id,
  pf.user_id,
  r.new_fact_key,
  row_number() over (
    partition by pf.user_id, r.new_fact_key
    order by
      case when pf.text ~ '[，,；;]' then 1 else 0 end,
      char_length(pf.text),
      pf.importance desc,
      pf.last_observed_at desc,
      pf.created_at desc,
      pf.id
  ) as fact_rank
from public.profile_facts pf
join profile_fact_rekey r on r.id = pf.id;

with merged as (
  select
    keeper.id as keeper_id,
    max(pf.importance) as importance,
    min(pf.first_observed_at) as first_observed_at,
    max(pf.last_observed_at) as last_observed_at,
    (array_remove(array_agg(pf.source_entry_id order by pf.last_observed_at desc), null))[1] as source_entry_id,
    coalesce(array_agg(distinct source_message_id) filter (where source_message_id is not null), '{}'::text[]) as source_message_ids
  from profile_fact_ranked keeper
  join profile_fact_ranked grouped
    on grouped.user_id = keeper.user_id
   and grouped.new_fact_key = keeper.new_fact_key
  join public.profile_facts pf on pf.id = grouped.id
  left join lateral unnest(pf.source_message_ids) as source_message_id on true
  where keeper.fact_rank = 1
  group by keeper.id
)
update public.profile_facts pf
set
  importance = merged.importance,
  first_observed_at = merged.first_observed_at,
  last_observed_at = merged.last_observed_at,
  source_entry_id = coalesce(merged.source_entry_id, pf.source_entry_id),
  source_message_ids = case
    when cardinality(merged.source_message_ids) > 0 then merged.source_message_ids
    else pf.source_message_ids
  end
from merged
where pf.id = merged.keeper_id;

delete from public.profile_facts
where id in (
  select id
  from profile_fact_ranked
  where fact_rank > 1
);

update public.profile_facts pf
set fact_key = r.new_fact_key
from profile_fact_rekey r
where pf.id = r.id
  and pf.fact_key is distinct from r.new_fact_key;

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

revoke all on function public.profile_fact_claim_key(text, text, text) from public;
grant execute on function public.profile_fact_claim_key(text, text, text) to authenticated, service_role;

revoke all on function public.commit_archive_entries(uuid, jsonb) from public;
grant execute on function public.commit_archive_entries(uuid, jsonb) to authenticated, service_role;
