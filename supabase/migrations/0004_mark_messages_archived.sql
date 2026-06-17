create or replace function public.mark_messages_archived(
  p_user_id uuid,
  p_message_ids text[]
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.role() is distinct from 'service_role'
    and auth.uid() is distinct from p_user_id then
    raise exception 'not allowed';
  end if;

  if not pg_try_advisory_xact_lock(hashtext(p_user_id::text)) then
    return;
  end if;

  update public.messages
  set archived_at = now()
  where user_id = p_user_id
    and archived_at is null
    and id::text = any(p_message_ids);
end;
$$;

revoke all on function public.mark_messages_archived(uuid, text[]) from public;
grant execute on function public.mark_messages_archived(uuid, text[]) to authenticated, service_role;
