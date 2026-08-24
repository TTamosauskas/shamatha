alter table public.stages
  add column if not exists advancement_requirement text not null default 'sessions';

alter table public.stages
  drop constraint if exists stages_advancement_requirement_check;

alter table public.stages
  add constraint stages_advancement_requirement_check
  check (advancement_requirement in ('deadline','sessions'));

update public.stages
set advancement_requirement = 'sessions'
where advancement_requirement is null or advancement_requirement not in ('deadline','sessions');
