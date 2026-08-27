alter table public.stages alter column number type integer using number::integer;
alter table public.stages alter column position type integer using position::integer;
alter table public.stages alter column child_position type integer using child_position::integer;
alter table public.stages drop constraint if exists stages_active_position_check;
alter table public.stages add constraint stages_active_position_check check (
  (parent_stage_id is null and child_position is null and release_day is null and ((is_active and position >= 1) or (not is_active and position is null)))
  or
  (parent_stage_id is not null and position is null and child_position >= 1 and release_day between 1 and 365)
);

create or replace function public.add_shamatha_stage()
returns public.stages language plpgsql security invoker set search_path=''
as $$ declare n integer; p integer; r public.stages; begin
  if not private.is_editor() then raise exception 'Acesso restrito ao editor.' using errcode='42501'; end if;
  lock table public.stages in share row exclusive mode;
  select coalesce(max(number),0)+1 into n from public.stages;
  select count(*)+1 into p from public.stages where is_active and parent_stage_id is null;
  insert into public.stages(number,position,is_active,parent_stage_id,child_position,release_day,stage_name,unit_name,objective,sessions_required,deadline_days,min_session_seconds,video_url,audio_url,audio_path,audio_name,advancement_requirement,updated_at)
  values(n,p,true,null,null,null,'Etapa '||p,'Nova unidade','',3,7,300,'','','','','deadline',now()) returning * into r;
  return r;
end $$;

create or replace function public.reorder_shamatha_stages(p_stage_ids uuid[])
returns setof public.stages language plpgsql security invoker set search_path=''
as $$ declare active_count integer; supplied_count integer; begin
  if not private.is_editor() then raise exception 'Acesso restrito ao editor.' using errcode='42501'; end if;
  lock table public.stages in share row exclusive mode;
  select count(*) into active_count from public.stages where is_active and parent_stage_id is null;
  supplied_count:=coalesce(array_length(p_stage_ids,1),0);
  if supplied_count<>active_count then raise exception 'A nova ordem deve conter todas as etapas principais ativas.' using errcode='22023'; end if;
  if (select count(distinct x) from unnest(p_stage_ids)x)<>supplied_count then raise exception 'A nova ordem contém etapas repetidas.' using errcode='22023'; end if;
  if (select count(*) from public.stages where is_active and parent_stage_id is null and stage_id=any(p_stage_ids))<>active_count then raise exception 'A nova ordem contém uma etapa inválida, filha ou arquivada.' using errcode='22023'; end if;
  with ordered as(select stage_id,ordinality::integer new_position from unnest(p_stage_ids) with ordinality u(stage_id,ordinality))
  update public.stages s set position=o.new_position,updated_at=now() from ordered o where s.stage_id=o.stage_id;
  return query select * from public.stages where is_active and parent_stage_id is null order by position;
end $$;

create or replace function public.archive_shamatha_stage(p_stage_id uuid)
returns public.stages language plpgsql security invoker set search_path=''
as $$ declare active_count integer; r public.stages; begin
  if not private.is_editor() then raise exception 'Acesso restrito ao editor.' using errcode='42501'; end if;
  lock table public.stages in share row exclusive mode;
  select count(*) into active_count from public.stages where is_active and parent_stage_id is null;
  if active_count<=1 then raise exception 'O caminho precisa manter pelo menos uma etapa principal ativa.' using errcode='22023'; end if;
  select * into r from public.stages where stage_id=p_stage_id and is_active and parent_stage_id is null for update;
  if not found then raise exception 'Etapa principal ativa não encontrada.' using errcode='P0002'; end if;
  update public.stages set is_active=false,position=null,updated_at=now() where stage_id=p_stage_id;
  with ordered as(select stage_id,row_number() over(order by position)::integer new_position from public.stages where is_active and parent_stage_id is null)
  update public.stages s set position=o.new_position,updated_at=now() from ordered o where s.stage_id=o.stage_id;
  select * into r from public.stages where stage_id=p_stage_id;
  return r;
end $$;

create or replace function public.restore_shamatha_stage(p_stage_id uuid)
returns public.stages language plpgsql security invoker set search_path=''
as $$ declare active_count integer; r public.stages; begin
  if not private.is_editor() then raise exception 'Acesso restrito ao editor.' using errcode='42501'; end if;
  lock table public.stages in share row exclusive mode;
  select count(*) into active_count from public.stages where is_active and parent_stage_id is null;
  select * into r from public.stages where stage_id=p_stage_id and not is_active and parent_stage_id is null for update;
  if not found then raise exception 'Etapa principal removida não encontrada.' using errcode='P0002'; end if;
  update public.stages set is_active=true,position=active_count+1,updated_at=now() where stage_id=p_stage_id returning * into r;
  return r;
end $$;

create or replace function public.add_shamatha_child_stage(p_parent_stage_id uuid,p_release_day smallint default 1)
returns public.stages language plpgsql security invoker set search_path=''
as $$ declare parent_row public.stages; n integer; cp integer; r public.stages; begin
  if not private.is_editor() then raise exception 'Acesso restrito ao editor.' using errcode='42501'; end if;
  lock table public.stages in share row exclusive mode;
  select * into parent_row from public.stages where stage_id=p_parent_stage_id and is_active and parent_stage_id is null for update;
  if not found then raise exception 'Etapa mãe ativa não encontrada.' using errcode='P0002'; end if;
  if p_release_day<1 or p_release_day>parent_row.deadline_days then raise exception 'O dia de liberação deve ficar entre 1 e %.',parent_row.deadline_days using errcode='22023'; end if;
  select coalesce(max(number),0)+1 into n from public.stages;
  select coalesce(max(child_position),0)+1 into cp from public.stages where parent_stage_id=p_parent_stage_id and is_active;
  insert into public.stages(number,position,is_active,parent_stage_id,child_position,release_day,stage_name,unit_name,objective,sessions_required,deadline_days,min_session_seconds,video_url,audio_url,audio_path,audio_name,advancement_requirement,updated_at)
  values(n,null,true,p_parent_stage_id,cp,p_release_day,'Aula de apoio','Nova aula','',1,parent_row.deadline_days,parent_row.min_session_seconds,'','','','','deadline',now()) returning * into r;
  return r;
end $$;

create or replace function public.update_shamatha_child_stage(p_stage_id uuid,p_unit_name text,p_objective text,p_release_day smallint,p_video_url text)
returns public.stages language plpgsql security invoker set search_path=''
as $$ declare c public.stages; p public.stages; r public.stages; begin
  if not private.is_editor() then raise exception 'Acesso restrito ao editor.' using errcode='42501'; end if;
  lock table public.stages in share row exclusive mode;
  select * into c from public.stages where stage_id=p_stage_id and is_active and parent_stage_id is not null for update;
  if not found then raise exception 'Etapa filha ativa não encontrada.' using errcode='P0002'; end if;
  select * into p from public.stages where stage_id=c.parent_stage_id and parent_stage_id is null;
  if not found then raise exception 'Etapa mãe não encontrada.' using errcode='P0002'; end if;
  if p_release_day<1 or p_release_day>p.deadline_days then raise exception 'O dia de liberação deve ficar entre 1 e %.',p.deadline_days using errcode='22023'; end if;
  update public.stages set unit_name=left(coalesce(nullif(trim(p_unit_name),''),'Nova aula'),180),objective=coalesce(p_objective,''),release_day=p_release_day,video_url=coalesce(p_video_url,''),updated_at=now() where stage_id=p_stage_id returning * into r;
  with ordered as(select stage_id,row_number() over(order by release_day,child_position,number)::integer new_position from public.stages where parent_stage_id=c.parent_stage_id and is_active)
  update public.stages s set child_position=o.new_position,updated_at=now() from ordered o where s.stage_id=o.stage_id;
  select * into r from public.stages where stage_id=p_stage_id;
  return r;
end $$;

create or replace function public.archive_shamatha_child_stage(p_stage_id uuid)
returns public.stages language plpgsql security invoker set search_path=''
as $$ declare r public.stages; parent_id uuid; begin
  if not private.is_editor() then raise exception 'Acesso restrito ao editor.' using errcode='42501'; end if;
  lock table public.stages in share row exclusive mode;
  select parent_stage_id into parent_id from public.stages where stage_id=p_stage_id and is_active and parent_stage_id is not null for update;
  if not found then raise exception 'Etapa filha ativa não encontrada.' using errcode='P0002'; end if;
  update public.stages set is_active=false,updated_at=now() where stage_id=p_stage_id returning * into r;
  with ordered as(select stage_id,row_number() over(order by release_day,child_position,number)::integer new_position from public.stages where parent_stage_id=parent_id and is_active)
  update public.stages s set child_position=o.new_position,updated_at=now() from ordered o where s.stage_id=o.stage_id;
  return r;
end $$;

create or replace function public.restore_shamatha_child_stage(p_stage_id uuid)
returns public.stages language plpgsql security invoker set search_path=''
as $$ declare r public.stages; p public.stages; cp integer; begin
  if not private.is_editor() then raise exception 'Acesso restrito ao editor.' using errcode='42501'; end if;
  lock table public.stages in share row exclusive mode;
  select * into r from public.stages where stage_id=p_stage_id and not is_active and parent_stage_id is not null for update;
  if not found then raise exception 'Etapa filha removida não encontrada.' using errcode='P0002'; end if;
  select * into p from public.stages where stage_id=r.parent_stage_id and is_active and parent_stage_id is null;
  if not found then raise exception 'Restaure primeiro a etapa mãe.' using errcode='22023'; end if;
  if r.release_day>p.deadline_days then raise exception 'A etapa filha está configurada para o dia %, mas a etapa mãe possui janela de % dias.',r.release_day,p.deadline_days using errcode='22023'; end if;
  select coalesce(max(child_position),0)+1 into cp from public.stages where parent_stage_id=r.parent_stage_id and is_active;
  update public.stages set is_active=true,child_position=cp,updated_at=now() where stage_id=p_stage_id;
  with ordered as(select stage_id,row_number() over(order by release_day,child_position,number)::integer new_position from public.stages where parent_stage_id=r.parent_stage_id and is_active)
  update public.stages s set child_position=o.new_position,updated_at=now() from ordered o where s.stage_id=o.stage_id;
  select * into r from public.stages where stage_id=p_stage_id;
  return r;
end $$;
