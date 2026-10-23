-- MANUAL FINAL GO-LIVE ONLY, after recorded owner approval and live checkout
-- end-to-end verification. Do not put this into supabase/migrations.
-- All profiles already registered when activation begins are grandfathered.
begin;
lock table public.profiles in share mode;
insert into public.billing_exemptions (user_id,reason)
select id,'Usuario registrado antes da ativacao financeira do Shamatha'
from public.profiles
on conflict (user_id) do nothing;
do $guard$
begin
  if exists (
    select 1 from public.profiles p
    where not exists (select 1 from public.billing_exemptions e where e.user_id=p.id)
  ) then
    raise exception 'Existing user exemption snapshot incomplete';
  end if;
  if not exists(
    select 1 from private.billing_access_control where singleton=true and enforce_payment=false
  ) then
    raise exception 'Billing was previously enabled or not prepared';
  end if;
end $guard$;
update private.billing_access_control
set enforce_payment=true,updated_at=now()
where singleton=true and enforce_payment=false;
commit;

-- Emergency rollback: restoring previous administrative-only RLS behavior.
-- update private.billing_access_control set enforce_payment=false,updated_at=now()
-- where singleton=true;
