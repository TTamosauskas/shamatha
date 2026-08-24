create table if not exists public.meditation_reminders (
  user_id uuid primary key references auth.users(id) on delete cascade,
  enabled boolean not null default false,
  local_time time without time zone not null default '20:00',
  timezone text not null default 'America/Sao_Paulo',
  last_sent_local_date date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint meditation_reminders_timezone_length check (char_length(timezone) between 1 and 100)
);

alter table public.meditation_reminders enable row level security;

grant select, insert, update, delete on public.meditation_reminders to authenticated;

create policy meditation_reminders_select_own_shamatha
on public.meditation_reminders for select
to authenticated
using (user_id = (select auth.uid()) and (select private.has_content_access()));

create policy meditation_reminders_insert_own_shamatha
on public.meditation_reminders for insert
to authenticated
with check (user_id = (select auth.uid()) and (select private.has_content_access()));

create policy meditation_reminders_update_own_shamatha
on public.meditation_reminders for update
to authenticated
using (user_id = (select auth.uid()) and (select private.has_content_access()))
with check (user_id = (select auth.uid()) and (select private.has_content_access()));

create policy meditation_reminders_delete_own_shamatha
on public.meditation_reminders for delete
to authenticated
using (user_id = (select auth.uid()));

create index if not exists meditation_reminders_enabled_idx
on public.meditation_reminders (enabled)
where enabled = true;
