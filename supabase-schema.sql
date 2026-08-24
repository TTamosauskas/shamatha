-- Shamatha / Centro Pineal — backend para GitHub Pages + Supabase
-- Execute este arquivo inteiro no SQL Editor de um projeto Supabase.
-- Depois cadastre sua própria conta pelo site e execute a instrução de promoção
-- indicada no final deste arquivo, substituindo o e-mail.

create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to authenticated;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null unique,
  role text not null default 'student' check (role in ('student', 'editor')),
  access_granted boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists public.stages (
  number smallint primary key check (number between 1 and 9),
  stage_name text not null,
  unit_name text not null,
  objective text not null default '',
  sessions_required smallint not null default 3 check (sessions_required between 1 and 30),
  deadline_days smallint not null default 7 check (deadline_days between 1 and 365),
  min_session_seconds integer not null default 300 check (min_session_seconds between 0 and 86400),
  video_url text not null default '',
  audio_url text not null default '',
  updated_at timestamptz not null default now()
);

create table if not exists public.settings (
  id smallint primary key default 1 check (id = 1),
  live_class_url text not null default '',
  whatsapp_phone text not null default '5541995126513',
  updated_at timestamptz not null default now()
);

create table if not exists public.progress (
  user_id uuid primary key references auth.users(id) on delete cascade,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create or replace function private.default_progress()
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select '{}'::jsonb;
$$;

create or replace function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, email, role, access_granted, created_at)
  values (new.id, lower(coalesce(new.email, '')), 'student', false, coalesce(new.created_at, now()))
  on conflict (id) do nothing;

  insert into public.progress (user_id, data)
  values (new.id, private.default_progress())
  on conflict (user_id) do nothing;

  return new;
end;
$$;

revoke all on function private.handle_new_user() from public, anon, authenticated;

drop trigger if exists on_auth_user_created_shamatha on auth.users;
create trigger on_auth_user_created_shamatha
after insert on auth.users
for each row execute function private.handle_new_user();

-- Backfill para contas eventualmente criadas antes deste SQL.
insert into public.profiles (id, email, role, access_granted, created_at)
select id, lower(coalesce(email, '')), 'student', false, created_at
from auth.users
where email is not null
on conflict (id) do nothing;

insert into public.progress (user_id, data)
select id, private.default_progress()
from auth.users
on conflict (user_id) do nothing;

create or replace function private.is_editor()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = (select auth.uid())
      and p.role = 'editor'
      and p.access_granted = true
  );
$$;

create or replace function private.has_content_access()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = (select auth.uid())
      and (p.role = 'editor' or p.access_granted = true)
  );
$$;

grant execute on function private.is_editor() to authenticated;
grant execute on function private.has_content_access() to authenticated;

-- Conteúdo inicial. A etapa 1 preserva o vídeo e o áudio do protótipo.
insert into public.stages
(number, stage_name, unit_name, objective, sessions_required, deadline_days, min_session_seconds, video_url, audio_url)
values
(1, 'Colocar a mente', 'Base do corpo', 'Desenvolver estabilidade física suficiente para sustentar a atenção.', 3, 7, 300, 'https://www.youtube.com/watch?v=lKeVc3rKVsE', 'https://raw.githubusercontent.com/TTamosauskas/imagens-singelas/main/meditacao.mp3'),
(2, 'Etapa 2', 'Conteúdo da etapa 2', 'Configure esta etapa no painel do editor.', 3, 7, 300, '', ''),
(3, 'Etapa 3', 'Conteúdo da etapa 3', 'Configure esta etapa no painel do editor.', 3, 7, 300, '', ''),
(4, 'Etapa 4', 'Conteúdo da etapa 4', 'Configure esta etapa no painel do editor.', 3, 7, 300, '', ''),
(5, 'Etapa 5', 'Conteúdo da etapa 5', 'Configure esta etapa no painel do editor.', 3, 7, 300, '', ''),
(6, 'Etapa 6', 'Conteúdo da etapa 6', 'Configure esta etapa no painel do editor.', 3, 7, 300, '', ''),
(7, 'Etapa 7', 'Conteúdo da etapa 7', 'Configure esta etapa no painel do editor.', 3, 7, 300, '', ''),
(8, 'Etapa 8', 'Conteúdo da etapa 8', 'Configure esta etapa no painel do editor.', 3, 7, 300, '', ''),
(9, 'Etapa 9', 'Conteúdo da etapa 9', 'Configure esta etapa no painel do editor.', 3, 7, 300, '', '')
on conflict (number) do nothing;

insert into public.settings (id, live_class_url, whatsapp_phone)
values (1, '', '5541995126513')
on conflict (id) do nothing;

-- Menor conjunto de privilégios usado pelo cliente web.
revoke all on table public.profiles, public.stages, public.settings, public.progress from anon, authenticated;
grant select, update on table public.profiles to authenticated;
grant select, update on table public.stages to authenticated;
grant select, update on table public.settings to authenticated;
grant select, insert, update on table public.progress to authenticated;

alter table public.profiles enable row level security;
alter table public.stages enable row level security;
alter table public.settings enable row level security;
alter table public.progress enable row level security;

-- Perfis: cada conta enxerga o próprio perfil; editor enxerga e altera alunos.
drop policy if exists profiles_select_shamatha on public.profiles;
create policy profiles_select_shamatha
on public.profiles for select
to authenticated
using (id = (select auth.uid()) or (select private.is_editor()));

drop policy if exists profiles_update_editor_shamatha on public.profiles;
create policy profiles_update_editor_shamatha
on public.profiles for update
to authenticated
using ((select private.is_editor()))
with check ((select private.is_editor()));

-- Conteúdo e configurações: alunos liberados leem; somente editor altera.
drop policy if exists stages_select_access_shamatha on public.stages;
create policy stages_select_access_shamatha
on public.stages for select
to authenticated
using ((select private.has_content_access()));

drop policy if exists stages_update_editor_shamatha on public.stages;
create policy stages_update_editor_shamatha
on public.stages for update
to authenticated
using ((select private.is_editor()))
with check ((select private.is_editor()));

drop policy if exists settings_select_access_shamatha on public.settings;
create policy settings_select_access_shamatha
on public.settings for select
to authenticated
using ((select private.has_content_access()));

drop policy if exists settings_update_editor_shamatha on public.settings;
create policy settings_update_editor_shamatha
on public.settings for update
to authenticated
using ((select private.is_editor()))
with check ((select private.is_editor()));

-- Progresso: cada aluno liberado lê e grava exclusivamente o próprio registro.
drop policy if exists progress_select_own_shamatha on public.progress;
create policy progress_select_own_shamatha
on public.progress for select
to authenticated
using (user_id = (select auth.uid()) and (select private.has_content_access()));

drop policy if exists progress_insert_own_shamatha on public.progress;
create policy progress_insert_own_shamatha
on public.progress for insert
to authenticated
with check (user_id = (select auth.uid()) and (select private.has_content_access()));

drop policy if exists progress_update_own_shamatha on public.progress;
create policy progress_update_own_shamatha
on public.progress for update
to authenticated
using (user_id = (select auth.uid()) and (select private.has_content_access()))
with check (user_id = (select auth.uid()) and (select private.has_content_access()));

-- PASSO FINAL PARA CRIAR O PRIMEIRO EDITOR
-- 1. Publique/configure o site, cadastre sua conta normalmente e confirme o e-mail.
-- 2. Volte ao SQL Editor e execute SOMENTE a linha abaixo com o seu e-mail real:
-- update public.profiles set role = 'editor', access_granted = true where email = lower('SEU_EMAIL_AQUI');
