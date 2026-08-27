drop index if exists public.stages_active_child_position_unique;
create index if not exists stages_active_child_order_idx
  on public.stages(parent_stage_id, child_position)
  where parent_stage_id is not null and is_active;
