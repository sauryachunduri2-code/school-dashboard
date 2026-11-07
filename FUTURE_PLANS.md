# Future plans

Ideas for after the personal version has been used for a few weeks. Nothing here is built or committed to yet.

## Open it up to other students

Today Daybook is single-user: one allowed email, RLS via `is_owner()`, one Google connection.

### Phase 1: multi-user, no Google sync (~1 week of work)
- Add `user_id` to every table. RLS becomes `user_id = auth.uid()`. Remove the single-email allowlist (`NEXT_PUBLIC_ALLOWED_EMAIL`, `is_owner()`).
- Onboarding: each student picks their own classes and activities (no seeded HOSA/Olympiad lists), plus timezone and default reminder.
- Settings rows, push subscriptions and the reminder cron become per user.
- Account controls: export my data, delete my account.
- Custom domain (~$12/yr): school Wi-Fi blocks `*.vercel.app`, and Google verification needs an owned domain anyway.
- Real Terms and Privacy pages. Ages 13+ only (under 13 means COPPA parental consent). No selling or sharing of data. Have a teacher or adult review it before launch.

### Phase 2: Google Calendar sync for everyone
- Calendar access is a "sensitive" scope. Until Google verifies the app, users see an "unverified app" warning and there's a 100-user cap.
- Run an opt-in beta with up to 100 testers, and apply for verification at the same time: verified domain, privacy policy, demo video, scope justification. Usually a few weeks. Free; no paid security audit for this scope level.
- Many students' calendars are on school Google accounts, which admins often lock against outside apps. Expect most people to connect a personal Gmail.
- Per-user Google tokens. The access-token cache is already keyed by refresh token (`lib/google/token-cache.ts`).

### Cost
- Free tiers (Supabase + Vercel Hobby) cover a few hundred students. Supabase free pauses after a week with no activity. Vercel Hobby is non-commercial only.
- Thousands of users: about $45/mo (Supabase Pro $25 + Vercel Pro $20).

### Possible tie-in
Could double as a measurable-impact HOSA project (user count, engagement).

## Smaller ideas noted along the way
- Calendar page: right-click/quick action on an event for "Add to to-do list" (currently only in the event editor).
- Recurring-series exceptions that Google detached don't inherit the series' to-do flag.
- Phone layout pass for Home (laptop and desktop came first).
