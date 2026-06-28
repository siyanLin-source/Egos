-- One-off cleanup for profile_facts generated before the Sprint 3 fact gate.
-- This is not a migration. Run the SELECT first in Supabase SQL editor, review
-- the returned rows, then run the DELETE block only if the candidates look right.
--
-- Replace the email with the current app user's email if needed.

-- 1) Inspect obvious dirty candidates.
with target_user as (
  select id
  from auth.users
  where email = 'siyan.lin103@gmail.com'
),
candidates as (
  select
    fact.id,
    fact.kind,
    fact.subject,
    fact.text,
    fact.importance,
    fact.source_entry_id,
    fact.last_observed_at
  from public.profile_facts as fact
  join target_user on target_user.id = fact.user_id
  where
    -- Organization/role/background details that are not durable facts about the user.
    fact.text ~ '(工程部|财务部|人事|行政|市场|销售|部门|经理|主管|领导|同事|向总|填表|车被撞|保险)'
    or fact.subject ~ '(工程部|财务部|人事|行政|市场|销售|部门|经理|主管|领导|同事|向总)'
    or (
      fact.subject <> '你'
      and fact.kind not in ('pet', 'identity')
      and fact.text !~ '(Voli|小猫咪|猫|狗|男朋友|女朋友)'
    )
)
select *
from candidates
order by last_observed_at desc;

-- 2) Delete only the obvious dirty candidates.
-- Keep this WHERE conservative: it removes company/role/background scraps,
-- not valid durable facts like name, boyfriend, pets, fitness, or preferences.
/*
with target_user as (
  select id
  from auth.users
  where email = 'siyan.lin103@gmail.com'
),
candidates as (
  select fact.id
  from public.profile_facts as fact
  join target_user on target_user.id = fact.user_id
  where
    fact.text ~ '(工程部|财务部|人事|行政|市场|销售|部门|经理|主管|领导|同事|向总|填表|车被撞|保险)'
    or fact.subject ~ '(工程部|财务部|人事|行政|市场|销售|部门|经理|主管|领导|同事|向总)'
)
delete from public.profile_facts as fact
using candidates
where fact.id = candidates.id
returning
  fact.id,
  fact.kind,
  fact.subject,
  fact.text,
  fact.source_entry_id;
*/
