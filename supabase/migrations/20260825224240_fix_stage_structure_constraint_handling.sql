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
