# Google + Supabase setup checklist

Do this once, in order. Everything in the app except Google Calendar sync works without it. Calendar sync turns on by itself as soon as `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` exist and you press **Connect Google Calendar** in Settings.

Your Vercel project is `school-dashboard` (already linked, nothing deployed yet). The Google account that may sign in is `sauryachunduri2@gmail.com`.

## 1. Supabase (database + sign-in)

The Supabase integration was not provisioned automatically (see the final report), so create it first.

1. Vercel dashboard, project `school-dashboard`, **Storage** (or **Integrations**) tab, **Supabase**, **Add**. Accept the defaults. This sets `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` and `SUPABASE_URL` on the project.
   Or create a project at supabase.com and add those four variables by hand.
2. In a terminal in this folder: `vercel env pull .env.remote --yes`, then copy the four Supabase lines from `.env.remote` into `.env.local` (pulling straight into `.env.local` would overwrite your VAPID keys and `CRON_SECRET`). Both files are git-ignored.
3. Supabase dashboard, **SQL Editor**, run these files in order, one paste each:
   1. `supabase/migrations/0001_schema.sql`
   2. `supabase/migrations/0002_rls_seed.sql` (row-level security restricts everything to `sauryachunduri2@gmail.com`, and adds your seed lists)
   3. `supabase/migrations/0003_cron.sql`
   4. `supabase/migrations/0004_reminders.sql` (default + custom task reminders)
   Or with the Supabase CLI: `supabase link` then `supabase db push`.

## 2. Google Cloud (Calendar API + sign-in)

1. Go to console.cloud.google.com, sign in as `sauryachunduri2@gmail.com`.
2. Top bar project picker, **New project**, name it `school-dashboard`, **Create**, then select it.
3. Left menu **APIs & Services**, **Library**, search **Google Calendar API**, **Enable**.
4. **APIs & Services**, **OAuth consent screen** (may say "Google Auth platform"), **Get started**:
   - App name `School Dashboard`, user support email = your Gmail, **Next**.
   - Audience: **External**, **Next**. Contact email = your Gmail, **Next**, accept the policy, **Create**.
5. **Data Access** (or **Scopes**), **Add or remove scopes**, add:
   - `openid`, `.../auth/userinfo.email`, `.../auth/userinfo.profile`
   - `https://www.googleapis.com/auth/calendar.events`
   - `https://www.googleapis.com/auth/calendar.calendarlist.readonly`
   then **Update**, **Save**.
6. **Audience**, **Publish app** so the status becomes **In production**. This matters: apps left in "Testing" make Google expire the refresh token after 7 days and sync would silently stop. Because you are the only user, no Google verification is needed. You will see an "unverified app" warning when connecting: **Advanced**, **Go to School Dashboard (unsafe)**. That is expected for your own app.
7. **Clients**, **Create client**:
   - Application type **Web application**, name `School Dashboard web`.
   - **Authorized JavaScript origins**: `http://localhost:3000` and your production URL (for example `https://school-dashboard.vercel.app`, or your custom domain).
   - **Authorized redirect URIs**: `https://<your-supabase-project-ref>.supabase.co/auth/v1/callback` (Supabase dashboard, **Authentication**, **Providers**, **Google** shows the exact URL).
   - **Create**, then copy the **Client ID** and **Client secret**.

## 3. Connect Google to Supabase and Vercel

1. Supabase dashboard, **Authentication**, **Providers**, **Google**: enable it, paste the Client ID and Client secret, **Save**.
2. Supabase, **Authentication**, **URL Configuration**: Site URL = your production URL. Add these redirect URLs: `https://<your-production-url>/auth/callback` and `http://localhost:3000/auth/callback`.
3. Add the same client to Vercel so the server can refresh Calendar tokens (never exposed to the browser):
   ```
   vercel env add GOOGLE_CLIENT_ID production
   vercel env add GOOGLE_CLIENT_SECRET production
   ```
   Repeat for `preview` and `development` if you want them there, and put both in `.env.local` for local runs.

## 4. Other environment variables

Already generated locally in `.env.local` (never committed). Copy them to Vercel for production:

```
vercel env add NEXT_PUBLIC_VAPID_PUBLIC_KEY production
vercel env add VAPID_PRIVATE_KEY production
vercel env add VAPID_SUBJECT production        # mailto:sauryachunduri2@gmail.com
vercel env add CRON_SECRET production
vercel env add NEXT_PUBLIC_ALLOWED_EMAIL production   # sauryachunduri2@gmail.com (must match is_owner() in migration 0002)
```

Optional: `APP_TIMEZONE` (default `America/New_York`) is the fallback zone for events created from the dashboard.

## 5. First deploy (when you decide to)

Nothing has been deployed. When you are ready: `vercel deploy` for a preview, or `vercel --prod`.

After the first deploy, start the reminder timer. In the Supabase **SQL Editor**:

```sql
select vault.create_secret('<paste the CRON_SECRET value from Vercel>', 'cron_secret');
select public.schedule_reminder_cron('https://<your-production-url>');
```

pg_cron then calls `/api/cron/reminders` every minute. To check it ran: `select * from cron.job_run_details order by start_time desc limit 5;`.

## 6. Turn things on in the app

1. Open the site, **Continue with Google**, sign in as `sauryachunduri2@gmail.com`. Any other account is signed out and bounced.
2. **Settings**, **Google Calendar**, **Connect Google Calendar**, approve the scopes (including the unverified-app screen). Your calendars appear. Tick the ones to show and pick which one gets new events. Calendars like Holidays are read-only: they show but cannot be dragged.
3. **iPhone**: Safari, Share, **Add to Home Screen**, open Daybook from the Home Screen, then **Settings**, **Notifications**, **Turn on notifications**, **Send test**. iPhone only allows push for Home Screen apps.
4. **Laptop**: **Settings**, **Notifications**, **Turn on notifications**, **Send test**.

## Troubleshooting

- "Google access expired. Connect again": the stored refresh token was revoked. Settings, **Reconnect**.
- No reminders arriving: check `cron.job_run_details`, that `CRON_SECRET` in Vercel matches the Vault secret, and that **Send test** works.
- Sync stops after about a week: the consent screen is still in Testing. Publish it (step 2.6) and Reconnect.
