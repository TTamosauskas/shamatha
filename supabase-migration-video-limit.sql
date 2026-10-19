-- Execute uma vez no Supabase SQL Editor ANTES de publicar a nova interface.
-- NULL mantém a reprodução completa de vídeos existentes.
alter table public.stages
  add column if not exists video_limit_seconds integer;

alter table public.stages
  drop constraint if exists stages_video_limit_seconds_check;

alter table public.stages
  add constraint stages_video_limit_seconds_check
  check (video_limit_seconds is null or video_limit_seconds between 1 and 86400);
