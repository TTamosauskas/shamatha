-- Migração histórica aplicada antes da decisão de manter etapas principais ilimitadas.
-- É imediatamente supersedida por 20260827173654_remove_stage_count_limits.sql.

create or replace function public.add_shamatha_stage()
returns public.stages
language plpgsql
security invoker
set search_path=''
as $$
declare n smallint; p smallint; r public.stages;
begin
  if not private.is_editor() then raise exception 'Acesso restrito ao editor.' using errcode='42501'; end if;
  lock table public.stages in share row exclusive mode;
  select (coalesce(max(number),0)+1)::smallint into n from public.stages;
  select (count(*)+1)::smallint into p from public.stages where is_active and parent_stage_id is null;
  if p>9 then raise exception 'Os 9 estágios do elefante já estão definidos. Use etapas filhas para acrescentar aulas.' using errcode='22023'; end if;
  insert into public.stages(number,position,is_active,parent_stage_id,child_position,release_day,stage_name,unit_name,objective,sessions_required,deadline_days,min_session_seconds,video_url,audio_url,audio_path,audio_name,advancement_requirement,updated_at)
  values(n,p,true,null,null,null,'Etapa '||p,'Nova unidade','',3,7,300,'','','','','deadline',now()) returning * into r;
  return r;
end $$;

create or replace function public.restore_shamatha_stage(p_stage_id uuid)
returns public.stages
language plpgsql
security invoker
set search_path=''
as $$
declare active_count integer; r public.stages;
begin
  if not private.is_editor() then raise exception 'Acesso restrito ao editor.' using errcode='42501'; end if;
  lock table public.stages in share row exclusive mode;
  select count(*) into active_count from public.stages where is_active and parent_stage_id is null;
  if active_count>=9 then raise exception 'Os 9 estágios do elefante já estão definidos. Remova um estágio principal antes de restaurar outro.' using errcode='22023'; end if;
  select * into r from public.stages where stage_id=p_stage_id and not is_active and parent_stage_id is null for update;
  if not found then raise exception 'Etapa principal removida não encontrada.' using errcode='P0002'; end if;
  update public.stages set is_active=true,position=(active_count+1)::smallint,updated_at=now() where stage_id=p_stage_id returning * into r;
  return r;
end $$;
