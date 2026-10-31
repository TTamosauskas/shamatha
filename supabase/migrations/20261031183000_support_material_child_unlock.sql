-- Restrict optional attachments to their own active lesson.
-- Child lesson attachments require that lesson's stored release-day unlock.
-- Editors can still manage attachments for any active or archived lesson.
drop policy if exists "shamatha_materials_select_entitled" on storage.objects;

create policy "shamatha_materials_select_entitled"
on storage.objects for select to authenticated
using (
  bucket_id='shamatha-support-materials'
  and (
    (select private.is_editor())
    or (
      (select private.has_content_access())
      and exists (
        select 1 from public.stages s
        where s.material_path=storage.objects.name
          and s.is_active=true
          and storage.objects.name like ('stage-' || s.stage_id::text || '/%')
          and (
            s.parent_stage_id is null
            or exists (
              select 1 from public.progress p
              where p.user_id=(select auth.uid())
                and coalesce((p.data->'childUnlocks') ? s.stage_id::text,false)
            )
          )
      )
    )
  )
);
