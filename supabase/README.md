Apply in order with the SQL editor or `supabase db push`:
0001_schema.sql, 0002_rls_seed.sql, 0003_cron.sql, 0004_reminders.sql, 0005_task_duration.sql, 0006_event_checks.sql.
Then follow the comment at the top of 0003_cron.sql after the first deploy.

The owner email is in two places that must match: `NEXT_PUBLIC_ALLOWED_EMAIL` (app) and `is_owner()` in 0002_rls_seed.sql (database).
