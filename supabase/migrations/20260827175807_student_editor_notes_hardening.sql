create index if not exists student_editor_notes_updated_by_idx on public.student_editor_notes(updated_by);

create policy student_editor_notes_deny_select on public.student_editor_notes for select to authenticated using (false);
create policy student_editor_notes_deny_insert on public.student_editor_notes for insert to authenticated with check (false);
create policy student_editor_notes_deny_update on public.student_editor_notes for update to authenticated using (false) with check (false);
create policy student_editor_notes_deny_delete on public.student_editor_notes for delete to authenticated using (false);
