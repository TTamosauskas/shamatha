alter table public.stages
  add column if not exists stage_id uuid not null default gen_random_uuid(),
  add column if not exists position smallint,
  add column if not exists is_active boolean not null default true;

update public.stages
set position = number
where position is null and is_active;

alter table public.stages drop constraint if exists stages_number_check;
alter table public.stages add constraint stages_number_check check (number >= 1);

alter table public.stages add constraint stages_stage_id_key unique (stage_id);
alter table public.stages add constraint stages_position_unique unique (position) deferrable initially immediate;
alter table public.stages add constraint stages_active_position_check
  check ((is_active and position between 1 and 30) or ((not is_active) and position is null));

create or replace function public.add_shamatha_stage()
returns public.stages
language plpgsql
security invoker
set search_path = ''
as $$
declare
  next_number smallint;
  next_position smallint;
  created_stage public.stages;
begin
  if not private.is_editor() then
    raise exception 'Acesso restrito ao editor.' using errcode = '42501';
  end if;

  lock table public.stages in share row exclusive mode;
  select (coalesce(max(number), 0) + 1)::smallint into next_number from public.stages;
  select (count(*) + 1)::smallint into next_position from public.stages where is_active;

  if next_position > 30 then
    raise exception 'O caminho atingiu o limite de 30 etapas.' using errcode = '22023';
  end if;

  insert into public.stages (
    number, position, is_active,
    stage_name, unit_name, objective,
    sessions_required, deadline_days, min_session_seconds,
    video_url, audio_url, audio_path, audio_name,
    advancement_requirement, updated_at
  ) values (
    next_number, next_position, true,
    'Etapa ' || next_position,
    'Nova unidade', '',
    3, 7, 300,
    '', '', '', '',
    'deadline', now()
  )
  returning * into created_stage;

  return created_stage;
end;
$$;

create or replace function public.reorder_shamatha_stages(p_stage_ids uuid[])
returns setof public.stages
language plpgsql
security invoker
set search_path = ''
as $$
declare
  active_count integer;
  supplied_count integer;
begin
  if not private.is_editor() then
    raise exception 'Acesso restrito ao editor.' using errcode = '42501';
  end if;

  lock table public.stages in share row exclusive mode;
  select count(*) into active_count from public.stages where is_active;
  supplied_count := coalesce(array_length(p_stage_ids, 1), 0);

  if supplied_count <> active_count then
    raise exception 'A nova ordem deve conter todas as etapas ativas.' using errcode = '22023';
  end if;

  if (select count(distinct x) from unnest(p_stage_ids) x) <> supplied_count then
    raise exception 'A nova ordem contém etapas repetidas.' using errcode = '22023';
  end if;

  if (select count(*) from public.stages where is_active and stage_id = any(p_stage_ids)) <> active_count then
    raise exception 'A nova ordem contém uma etapa inválida ou arquivada.' using errcode = '22023';
  end if;

  set constraints stages_position_unique deferred;

  with ordered as (
    select stage_id, ordinality::smallint as new_position
    from unnest(p_stage_ids) with ordinality as u(stage_id, ordinality)
  )
  update public.stages s
  set position = o.new_position,
      updated_at = now()
  from ordered o
  where s.stage_id = o.stage_id;

  return query
    select * from public.stages where is_active order by position;
end;
$$;

create or replace function public.archive_shamatha_stage(p_stage_id uuid)
returns public.stages
language plpgsql
security invoker
set search_path = ''
as $$
declare
  active_count integer;
  archived public.stages;
begin
  if not private.is_editor() then
    raise exception 'Acesso restrito ao editor.' using errcode = '42501';
  end if;

  lock table public.stages in share row exclusive mode;
  select count(*) into active_count from public.stages where is_active;
  if active_count <= 1 then
    raise exception 'O caminho precisa manter pelo menos uma etapa ativa.' using errcode = '22023';
  end if;

  select * into archived from public.stages where stage_id = p_stage_id and is_active for update;
  if not found then
    raise exception 'Etapa ativa não encontrada.' using errcode = 'P0002';
  end if;

  set constraints stages_position_unique deferred;

  update public.stages
  set is_active = false,
      position = null,
      updated_at = now()
  where stage_id = p_stage_id;

  with ordered as (
    select stage_id, row_number() over (order by position)::smallint as new_position
    from public.stages
    where is_active
  )
  update public.stages s
  set position = o.new_position,
      updated_at = now()
  from ordered o
  where s.stage_id = o.stage_id;

  select * into archived from public.stages where stage_id = p_stage_id;
  return archived;
end;
$$;

create or replace function public.restore_shamatha_stage(p_stage_id uuid)
returns public.stages
language plpgsql
security invoker
set search_path = ''
as $$
declare
  active_count integer;
  restored public.stages;
begin
  if not private.is_editor() then
    raise exception 'Acesso restrito ao editor.' using errcode = '42501';
  end if;

  lock table public.stages in share row exclusive mode;
  select count(*) into active_count from public.stages where is_active;
  if active_count >= 30 then
    raise exception 'O caminho atingiu o limite de 30 etapas.' using errcode = '22023';
  end if;

  select * into restored from public.stages where stage_id = p_stage_id and not is_active for update;
  if not found then
    raise exception 'Etapa removida não encontrada.' using errcode = 'P0002';
  end if;

  update public.stages
  set is_active = true,
      position = (active_count + 1)::smallint,
      updated_at = now()
  where stage_id = p_stage_id
  returning * into restored;

  return restored;
end;
$$;

revoke all on function public.reorder_shamatha_stages(uuid[]) from public, anon;
revoke all on function public.archive_shamatha_stage(uuid) from public, anon;
revoke all on function public.restore_shamatha_stage(uuid) from public, anon;
revoke all on function public.add_shamatha_stage() from public, anon;
grant execute on function public.reorder_shamatha_stages(uuid[]) to authenticated;
grant execute on function public.archive_shamatha_stage(uuid) to authenticated;
grant execute on function public.restore_shamatha_stage(uuid) to authenticated;
grant execute on function public.add_shamatha_stage() to authenticated;

grant select, update, insert on public.stages to authenticated;
