-- ONLY AFTER EXPLICIT LAUNCH APPROVAL, verified Mercado Pago credentials,
-- end-to-end integrated tests, and the periodic Edge Function deployed.
-- NEVER include this file in automatic migrations.
--
-- PRECONDITION (manual, Supabase Vault UI/SQL; do NOT commit actual values):
-- vault secret name shamatha_billing_project_url = your https://<ref>.supabase.co
-- vault secret name shamatha_billing_cron_secret = >=32 random characters
-- Edge Function secret SHAMATHA_BILLING_CRON_SECRET must match the Vault secret.
-- Flags SHAMATHA_BILLING_PERIODIC_ENABLED and
-- SHAMATHA_BILLING_RECONCILE_ENABLED must both be explicitly true.
--
-- Deploy shamatha-billing-periodic with verify_jwt=false, only because it
-- validates the independent Bearer secret BEFORE any privileged DB operations.
-- Never expose the cron secret in a client, GitHub, logs or chat.

do $schedule$
declare project_url text;
declare cron_secret text;
begin
  select decrypted_secret into project_url
  from vault.decrypted_secrets
  where name = 'shamatha_billing_project_url';
  select decrypted_secret into cron_secret
  from vault.decrypted_secrets
  where name = 'shamatha_billing_cron_secret';
  if project_url is null or project_url !~ '^https://[a-z0-9-]+[.]supabase[.]co$'
    or cron_secret is null or length(cron_secret)<32 then
    raise exception 'Billing cron Vault secrets absent/invalid: no job scheduled';
  end if;
  perform cron.schedule(
    'shamatha-billing-periodic-quarter-hour',
    '*/15 * * * *',
    $run$
      select net.http_post(
        url := (
          select decrypted_secret from vault.decrypted_secrets
          where name='shamatha_billing_project_url'
        ) || '/functions/v1/shamatha-billing-periodic',
        headers := jsonb_build_object(
          'Content-Type','application/json',
          'Authorization','Bearer ' || (
            select decrypted_secret from vault.decrypted_secrets
            where name='shamatha_billing_cron_secret'
          )
        ),
        body := '{}'::jsonb,
        timeout_milliseconds := 30000
      ) as request_id;
    $run$
  );
end $schedule$;

-- OFF switch / rollback after go-live (execute manually):
-- select cron.unschedule('shamatha-billing-periodic-quarter-hour');
-- Also set SHAMATHA_BILLING_PERIODIC_ENABLED=false at the Edge Function.
-- WARNING: turning off the periodic reconciler also stops automatic status
-- updates for refunds and renewals; handle customer support immediately.
