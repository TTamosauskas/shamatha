-- Evolução: estados de acesso, convites, agenda de aulas e Web Push.
-- Segredos VAPID/cron são gerados no primeiro bootstrap da Edge Function e ficam no Supabase Vault.

create extension if not exists pg_net;
create extension if not exists pg_cron;

alter table public.profiles add column if not exists access_status text;
update public.profiles
set access_status = case
  when role = 'editor' then 'approved'
  when access_granted then 'approved'
  else 'pending'
end
where access_status is null;
alter table public.profiles alter column access_status set default 'pending';
alter table public.profiles alter column access_status set not null;

do $$ begin
  alter table public.profiles add constraint profiles_access_status_check
    check (access_status in ('pending','approved','suspended'));
exception when duplicate_object then null;
end $$;

create or replace function private.sync_profile_access_state()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and old.is_owner and (new.role <> 'editor' or new.access_status <> 'approved') then
    raise exception 'A conta principal deve permanecer como editor aprovado.';
  end if;
  if new.role = 'editor' then
    new.access_status := 'approved';
    new.access_granted := true;
  elsif new.access_status = 'approved' then
    new.access_granted := true;
  else
    new.access_granted := false;
  end if;
  return new;
end;
$$;

revoke all on function private.sync_profile_access_state() from public, anon, authenticated;
drop trigger if exists sync_profile_access_state_shamatha on public.profiles;
create trigger sync_profile_access_state_shamatha
before insert or update of role, access_status, access_granted, is_owner on public.profiles
for each row execute function private.sync_profile_access_state();

update public.profiles set access_status = access_status;

create or replace function private.is_editor()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.profiles p where p.id=(select auth.uid()) and p.role='editor' and p.access_status='approved');
$$;
create or replace function private.has_content_access()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.profiles p where p.id=(select auth.uid()) and p.access_status='approved');
$$;
grant execute on function private.is_editor() to authenticated;
grant execute on function private.has_content_access() to authenticated;

create table if not exists public.live_classes (
  id uuid primary key default gen_random_uuid(),
  url text not null,
  starts_at timestamptz not null,
  status text not null default 'scheduled' check (status in ('scheduled','cancelled','ended')),
  created_by uuid references public.profiles(id) on delete set null,
  announced_at timestamptz,
  reminder_sent_at timestamptz,
  cancelled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists live_classes_schedule_idx on public.live_classes(status, starts_at);

create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth_key text not null,
  user_agent text not null default '',
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists push_subscriptions_user_idx on public.push_subscriptions(user_id) where enabled=true;

alter table public.settings add column if not exists push_public_key text not null default '';

revoke all on table public.live_classes, public.push_subscriptions from anon, authenticated;
grant select on table public.live_classes to authenticated;
grant select, insert, update, delete on table public.push_subscriptions to authenticated;
alter table public.live_classes enable row level security;
alter table public.push_subscriptions enable row level security;

drop policy if exists live_classes_select_access_shamatha on public.live_classes;
create policy live_classes_select_access_shamatha on public.live_classes for select to authenticated using ((select private.has_content_access()));
drop policy if exists push_subscriptions_select_own_shamatha on public.push_subscriptions;
create policy push_subscriptions_select_own_shamatha on public.push_subscriptions for select to authenticated using (user_id=(select auth.uid()) and (select private.has_content_access()));
drop policy if exists push_subscriptions_insert_own_shamatha on public.push_subscriptions;
create policy push_subscriptions_insert_own_shamatha on public.push_subscriptions for insert to authenticated with check (user_id=(select auth.uid()) and (select private.has_content_access()));
drop policy if exists push_subscriptions_update_own_shamatha on public.push_subscriptions;
create policy push_subscriptions_update_own_shamatha on public.push_subscriptions for update to authenticated using (user_id=(select auth.uid()) and (select private.has_content_access())) with check (user_id=(select auth.uid()) and (select private.has_content_access()));
drop policy if exists push_subscriptions_delete_own_shamatha on public.push_subscriptions;
create policy push_subscriptions_delete_own_shamatha on public.push_subscriptions for delete to authenticated using (user_id=(select auth.uid()));

create or replace function public.shamatha_edge_config()
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'vapid_public', coalesce((select s.push_public_key from public.settings s where s.id=1),''),
    'vapid_private', coalesce((select v.decrypted_secret from vault.decrypted_secrets v where v.name='shamatha_vapid_private' limit 1),''),
    'cron_secret', coalesce((select v.decrypted_secret from vault.decrypted_secrets v where v.name='shamatha_cron_secret' limit 1),''),
    'base_url','https://ttamosauskas.github.io/shamatha/'
  );
$$;
revoke all on function public.shamatha_edge_config() from public, anon, authenticated;
grant execute on function public.shamatha_edge_config() to service_role;

create or replace function public.shamatha_store_push_bootstrap(p_public text, p_private text)
returns boolean language plpgsql security definer set search_path = '' as $$
declare existing_public text; sid uuid;
begin
  select push_public_key into existing_public from public.settings where id=1 for update;
  if coalesce(existing_public,'')<>'' then return false; end if;
  select id into sid from vault.secrets where name='shamatha_vapid_private';
  if sid is null then
    perform vault.create_secret(p_private,'shamatha_vapid_private','VAPID private key for Shamatha Web Push');
  else
    perform vault.update_secret(sid,p_private,'shamatha_vapid_private','VAPID private key for Shamatha Web Push');
  end if;
  select id into sid from vault.secrets where name='shamatha_cron_secret';
  if sid is null then
    perform vault.create_secret(encode(extensions.gen_random_bytes(32),'hex'),'shamatha_cron_secret','Cron authentication secret for Shamatha notifications');
  end if;
  update public.settings set push_public_key=p_public,updated_at=now() where id=1;
  return true;
end;
$$;
revoke all on function public.shamatha_store_push_bootstrap(text,text) from public, anon, authenticated;
grant execute on function public.shamatha_store_push_bootstrap(text,text) to service_role;

-- Depois de implantar a Edge Function shamatha-ops e executar {"action":"bootstrap"}, agende:
do $$ declare jid bigint; begin
  select jobid into jid from cron.job where jobname='shamatha_live_push_reminders' limit 1;
  if jid is not null then perform cron.unschedule(jid); end if;
end $$;
select cron.schedule(
  'shamatha_live_push_reminders','* * * * *',
  $cron$
    select net.http_post(
      url := 'https://zglitbtwzntpchzhrdcy.supabase.co/functions/v1/shamatha-ops',
      headers := jsonb_build_object('Content-Type','application/json','x-cron-secret',(select decrypted_secret from vault.decrypted_secrets where name='shamatha_cron_secret' limit 1)),
      body := '{"action":"cron"}'::jsonb
    );
  $cron$
);
