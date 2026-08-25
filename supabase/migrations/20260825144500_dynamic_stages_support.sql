alter table public.stages drop constraint if exists stages_number_check;
alter table public.stages add constraint stages_number_check check (number >= 1 and number <= 30);

create policy stages_insert_editor_shamatha
on public.stages
for insert
to authenticated
with check ((select private.is_editor()));

create or replace function public.add_shamatha_stage()
returns public.stages
language plpgsql
security invoker
set search_path = ''
as $$
declare
  next_number smallint;
  created_stage public.stages;
begin
  if not private.is_editor() then
    raise exception 'Acesso restrito ao editor.' using errcode = '42501';
  end if;

  lock table public.stages in share row exclusive mode;
  select (coalesce(max(number), 0) + 1)::smallint
    into next_number
    from public.stages;

  if next_number > 30 then
    raise exception 'O caminho atingiu o limite de 30 etapas.' using errcode = '22023';
  end if;

  insert into public.stages (
    number, stage_name, unit_name, objective,
    sessions_required, deadline_days, min_session_seconds,
    video_url, audio_url, audio_path, audio_name,
    advancement_requirement, updated_at
  ) values (
    next_number,
    'Etapa ' || next_number,
    'Nova unidade',
    '',
    3, 7, 300,
    '', '', '', '',
    'deadline', now()
  )
  returning * into created_stage;

  return created_stage;
end;
$$;

revoke all on function public.add_shamatha_stage() from public;
revoke all on function public.add_shamatha_stage() from anon;
grant execute on function public.add_shamatha_stage() to authenticated;
