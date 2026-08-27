create table if not exists public.student_editor_notes (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  note text not null default '',
  updated_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now()
);

alter table public.student_editor_notes enable row level security;
revoke all on table public.student_editor_notes from anon, authenticated;
grant select, insert, update, delete on table public.student_editor_notes to service_role;

comment on table public.student_editor_notes is 'Anotações privadas de editores sobre usuários do Centro Pineal.';
