-- Row level security: only the owner's verified Google account can touch anything.
create or replace function public.is_owner() returns boolean language sql stable as $$
  select coalesce(auth.jwt() ->> 'email', '') = 'sauryachunduri2@gmail.com'
     and coalesce((auth.jwt() -> 'user_metadata' ->> 'email_verified')::boolean, true)
$$;

alter table public.lists enable row level security;
alter table public.tasks enable row level security;
alter table public.hours_logs enable row level security;
alter table public.push_subscriptions enable row level security;
alter table public.reminder_sends enable row level security;
alter table public.google_account enable row level security;
alter table public.calendars enable row level security;

create policy owner_all on public.lists for all to authenticated using (public.is_owner()) with check (public.is_owner());
create policy owner_all on public.tasks for all to authenticated using (public.is_owner()) with check (public.is_owner());
create policy owner_all on public.hours_logs for all to authenticated using (public.is_owner()) with check (public.is_owner());
create policy owner_all on public.push_subscriptions for all to authenticated using (public.is_owner()) with check (public.is_owner());
create policy owner_all on public.calendars for all to authenticated using (public.is_owner()) with check (public.is_owner());
-- reminder_sends and google_account: no policies = service role only.

-- Seed lists (ids match lib/seed.ts so the local dev fallback and Supabase agree)
insert into public.lists (id, area, name, color, sort) values
  ('00000000-0000-4000-8000-000000000001', 'school', 'AP Psych', '#3f5f8f', 0),
  ('00000000-0000-4000-8000-000000000002', 'ecs', 'HOSA', '#5f7f4f', 0),
  ('00000000-0000-4000-8000-000000000003', 'ecs', 'Remember Together', '#9a5446', 1),
  ('00000000-0000-4000-8000-000000000004', 'ecs', 'Olympiad', '#3f7f7a', 2),
  ('00000000-0000-4000-8000-000000000005', 'ecs', 'Hackathons', '#8a6a47', 3),
  ('00000000-0000-4000-8000-000000000006', 'ecs', 'Research', '#7d9170', 4),
  ('00000000-0000-4000-8000-000000000007', 'other', 'Personal', '#86576e', 0)
on conflict (id) do nothing;
