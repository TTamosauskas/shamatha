create or replace function private.purge_shamatha_stage(p_stage_id uuid)
returns table(deleted_stage_id uuid, deleted_audio_path text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_target public.stages;
  v_delete_ids uuid[];
  v_id_keys text[];
  v_number_keys text[];
  v_delete_id uuid;
begin
  if auth.uid() is null or not private.is_editor() then
    raise exception 'Acesso restrito ao editor.' using errcode = '42501';
  end if;

  lock table public.stages in share row exclusive mode;

  select s.* into v_target
  from public.stages s
  where s.stage_id = p_stage_id and not s.is_active
  for update;

  if not found then
    raise exception 'Etapa removida não encontrada.' using errcode = 'P0002';
  end if;

  with recursive stage_tree as (
    select s.stage_id, s.parent_stage_id, s.number, s.audio_path, 0 as depth
    from public.stages s
    where s.stage_id = p_stage_id
    union all
    select child.stage_id, child.parent_stage_id, child.number, child.audio_path, parent.depth + 1
    from public.stages child
    join stage_tree parent on child.parent_stage_id = parent.stage_id
  )
  select array_agg(t.stage_id order by t.depth desc), array_agg(t.stage_id::text), array_agg(t.number::text)
  into v_delete_ids, v_id_keys, v_number_keys
  from stage_tree t;

  return query
    select s.stage_id, nullif(s.audio_path, '')
    from public.stages s
    where s.stage_id = any(v_delete_ids)
    order by s.number;

  with impacted as (
    select p.user_id, coalesce(p.data, '{}'::jsonb) as original
    from public.progress p
    where coalesce(p.data->'stagesById', '{}'::jsonb) ?| v_id_keys
       or coalesce(p.data->'childUnlocks', '{}'::jsonb) ?| v_id_keys
       or coalesce(p.data->'stages', '{}'::jsonb) ?| v_number_keys
       or p.data->>'currentStageId' = any(v_id_keys)
  ), cleaned_states as (
    select i.user_id, i.original,
      case when i.original ? 'stagesById'
        then jsonb_set(i.original, '{stagesById}', coalesce(i.original->'stagesById', '{}'::jsonb) - v_id_keys, false)
        else i.original end as cleaned
    from impacted i
  ), cleaned_unlocks as (
    select c.user_id, c.original,
      case when c.original ? 'childUnlocks'
        then jsonb_set(c.cleaned, '{childUnlocks}', coalesce(c.original->'childUnlocks', '{}'::jsonb) - v_id_keys, false)
        else c.cleaned end as cleaned
    from cleaned_states c
  ), cleaned_legacy as (
    select c.user_id, c.original,
      case when c.original ? 'stages'
        then jsonb_set(c.cleaned, '{stages}', coalesce(c.original->'stages', '{}'::jsonb) - v_number_keys, false)
        else c.cleaned end as cleaned
    from cleaned_unlocks c
  ), cleaned_current as (
    select c.user_id,
      case when c.original->>'currentStageId' = any(v_id_keys) then c.cleaned - 'currentStageId' else c.cleaned end as cleaned
    from cleaned_legacy c
  )
  update public.progress p
  set data = c.cleaned, updated_at = now()
  from cleaned_current c
  where p.user_id = c.user_id;

  foreach v_delete_id in array v_delete_ids loop
    delete from public.stages s where s.stage_id = v_delete_id;
  end loop;

  return;
end;
$$;

revoke all on function private.purge_shamatha_stage(uuid) from public, anon;
grant usage on schema private to authenticated;
grant execute on function private.purge_shamatha_stage(uuid) to authenticated;

create or replace function public.purge_shamatha_stage(p_stage_id uuid)
returns table(deleted_stage_id uuid, deleted_audio_path text)
language sql
security invoker
set search_path = ''
as $$
  select * from private.purge_shamatha_stage(p_stage_id);
$$;

revoke all on function public.purge_shamatha_stage(uuid) from public, anon;
grant execute on function public.purge_shamatha_stage(uuid) to authenticated;
