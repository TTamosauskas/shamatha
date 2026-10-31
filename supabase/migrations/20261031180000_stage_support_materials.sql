-- Optional support material for root and child lessons.
-- Private Storage; editors upload/manage, approved entitled students download.
alter table public.stages
  add column if not exists material_path text not null default '',
  add column if not exists material_name text not null default '';

insert into storage.buckets (id,name,public,file_size_limit,allowed_mime_types)
values (
  'shamatha-support-materials','shamatha-support-materials',false,20971520,
  array[
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'image/jpeg','image/png','image/gif','image/webp'
  ]::text[]
)
on conflict (id) do nothing;

create policy "shamatha_materials_insert_editor"
on storage.objects for insert to authenticated
with check (
  bucket_id='shamatha-support-materials'
  and (select private.is_editor())
  and name ~ '^stage-[0-9a-f-]{36}/[0-9a-f-]{36}\.(pdf|doc|docx|jpg|jpeg|png|gif|webp)$'
);

create policy "shamatha_materials_select_entitled"
on storage.objects for select to authenticated
using (
  bucket_id='shamatha-support-materials'
  and (
    (select private.is_editor())
    or (
      (select private.has_content_access())
      and exists(
        select 1 from public.stages s
        where s.material_path=storage.objects.name
          and s.is_active=true
      )
    )
  )
);

create policy "shamatha_materials_delete_editor"
on storage.objects for delete to authenticated
using (bucket_id='shamatha-support-materials' and (select private.is_editor()));
