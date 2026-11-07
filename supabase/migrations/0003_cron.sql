-- Reminder cron: pg_cron calls the app every minute through pg_net.
-- Enable extensions (Supabase: Database > Extensions also works).
create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Call once after the first deploy, from the SQL editor:
--   select vault.create_secret('<the CRON_SECRET value from Vercel>', 'cron_secret');
--   select public.schedule_reminder_cron('https://<your-app>.vercel.app');
create or replace function public.schedule_reminder_cron(app_url text) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform cron.unschedule('task-reminders') where exists (select 1 from cron.job where jobname = 'task-reminders');
  perform cron.schedule(
    'task-reminders',
    '* * * * *',
    format(
      $job$select net.http_post(
        url := %L,
        headers := jsonb_build_object(
          'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret' limit 1),
          'Content-Type', 'application/json'
        ),
        body := '{}'::jsonb,
        timeout_milliseconds := 20000
      )$job$,
      rtrim(app_url, '/') || '/api/cron/reminders'
    )
  );
end $$;

revoke all on function public.schedule_reminder_cron(text) from public, anon, authenticated;
