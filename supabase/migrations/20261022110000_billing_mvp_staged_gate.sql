-- MVP: fail-safe staged billing gate, initially OFF. Applying this migration
-- MUST NOT block any existing user. Activation is a separate reviewed SQL step.
begin;

create table if not exists private.billing_access_control (
  singleton boolean primary key default true check (singleton = true),
  enforce_payment boolean not null default false,
  updated_at timestamptz not null default now()
);
revoke all on private.billing_access_control from public, anon, authenticated;
insert into private.billing_access_control (singleton, enforce_payment)
values (true,false) on conflict (singleton) do nothing;

-- Everyone existing at migration time is exempt. Repeat this snapshot inside
-- the FINAL ACTIVATE TRANSACTION so nobody registered before launch is missed.
insert into public.billing_exemptions (user_id,reason)
select id,'Cadastrado antes do lancamento das assinaturas' from public.profiles
on conflict (user_id) do nothing;

-- Gate is used by all existing stages/progress RLS policies. Unlike stale
-- profile.access_granted, this checks administrative approval first.
-- Editor remains able to manage content, even with no subscription record.
create or replace function private.has_content_access()
returns boolean language sql stable security definer set search_path = ''
as $sql$
  select exists(
    select 1 from public.profiles p
    where p.id=(select auth.uid()) and p.access_status='approved'
      and (
        not coalesce((select c.enforce_payment
                      from private.billing_access_control c where c.singleton=true),false)
        or p.role='editor'
        or exists(select 1 from public.billing_exemptions e where e.user_id=p.id)
        or exists(
          select 1 from public.billing_subscriptions s
          where s.user_id=p.id
            and s.environment='production'
            and s.amount_cents=18000 and s.currency='BRL'
            and s.paid_through > now()
            and exists(
              select 1 from public.billing_payments b
              where b.subscription_id=s.id and b.provider_status='approved'
                and b.amount_cents=18000 and b.currency='BRL'
                and b.mp_payment_id is not null
                and b.period_start<=now()
                and b.period_end>now()
            )
        )
      )
  );
$sql$;

-- The UI may ask only if the current authenticated identity can read content.
-- No user supplied argument, no financial details, no table mutations.
create or replace function public.shamatha_my_content_access()
returns boolean language sql stable security definer set search_path = ''
as $sql$ select private.has_content_access(); $sql$;
revoke all on function public.shamatha_my_content_access() from public, anon;
grant execute on function public.shamatha_my_content_access() to authenticated;

commit;
