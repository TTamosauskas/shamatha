select cron.schedule(
  'shamatha_daily_meditation_reminders',
  '* * * * *',
  $$
    select net.http_post(
      url := 'https://zglitbtwzntpchzhrdcy.supabase.co/functions/v1/shamatha-reminders',
      headers := jsonb_build_object(
        'Content-Type','application/json',
        'x-cron-secret',(select decrypted_secret from vault.decrypted_secrets where name='shamatha_cron_secret' limit 1)
      ),
      body := '{"action":"cron"}'::jsonb
    );
  $$
);
