update public.stages
set advancement_requirement = 'deadline'
where advancement_requirement <> 'deadline';

alter table public.stages
  alter column advancement_requirement set default 'deadline';

alter table public.stages
  drop constraint if exists stages_advancement_requirement_check;

alter table public.stages
  add constraint stages_advancement_requirement_check
  check (advancement_requirement = 'deadline');
