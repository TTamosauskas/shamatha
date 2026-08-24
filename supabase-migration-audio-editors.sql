-- Evolução do Shamatha: upload privado de áudio + múltiplos editores
alter table public.profiles add column if not exists is_owner boolean not null default false;
alter table public.stages add column if not exists audio_path text not null default '';
alter table public.stages add column if not exists audio_name text not null default '';

create unique index if not exists profiles_single_owner_shamatha on public.profiles ((is_owner)) where is_owner = true;

update public.profiles
set is_owner = true, role = 'editor', access_granted = true
where id = (select id from public.profiles where role = 'editor' order by created_at asc limit 1)
and not exists (select 1 from public.profiles where is_owner = true);

create or replace function private.protect_profile_admin_fields()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if (select auth.uid()) is null then return new; end if;
  if new.id is distinct from old.id or new.email is distinct from old.email or new.created_at is distinct from old.created_at then
    raise exception 'Campos de identidade do perfil não podem ser alterados pelo painel.';
  end if;
  if new.is_owner is distinct from old.is_owner then raise exception 'A conta principal não pode ser alterada pelo painel.'; end if;
  if old.is_owner and (new.role <> 'editor' or new.access_granted is not true) then raise exception 'A conta principal deve permanecer como editor ativo.'; end if;
  if new.role = 'editor' then new.access_granted := true; end if;
  if old.role = 'editor' and new.role <> 'editor' and not exists (
    select 1 from public.profiles p where p.id <> old.id and p.role = 'editor' and p.access_granted = true
  ) then raise exception 'Mantenha pelo menos um editor ativo.'; end if;
  return new;
end; $$;
revoke all on function private.protect_profile_admin_fields() from public, anon, authenticated;
drop trigger if exists protect_profile_admin_fields_shamatha on public.profiles;
create trigger protect_profile_admin_fields_shamatha before update on public.profiles for each row execute function private.protect_profile_admin_fields();

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('shamatha-audio','shamatha-audio',false,104857600,array['audio/mpeg','audio/mp4','audio/x-m4a','audio/aac','audio/ogg','audio/wav','audio/x-wav','audio/webm']::text[])
on conflict(id) do update set public=false,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;

drop policy if exists shamatha_audio_select on storage.objects;
create policy shamatha_audio_select on storage.objects for select to authenticated using(bucket_id='shamatha-audio' and (select private.has_content_access()));
drop policy if exists shamatha_audio_insert_editor on storage.objects;
create policy shamatha_audio_insert_editor on storage.objects for insert to authenticated with check(bucket_id='shamatha-audio' and (select private.is_editor()));
drop policy if exists shamatha_audio_update_editor on storage.objects;
create policy shamatha_audio_update_editor on storage.objects for update to authenticated using(bucket_id='shamatha-audio' and (select private.is_editor())) with check(bucket_id='shamatha-audio' and (select private.is_editor()));
drop policy if exists shamatha_audio_delete_editor on storage.objects;
create policy shamatha_audio_delete_editor on storage.objects for delete to authenticated using(bucket_id='shamatha-audio' and (select private.is_editor()));
