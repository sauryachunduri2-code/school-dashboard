-- Per-day checks for calendar events that are on the to-do list ("To-do today" on Home).
-- Whether an event is a to-do lives on the Google event (extendedProperties.private.sd_todo); this table only
-- records "done on this day". Google is never modified by a check.
--
--   event_key  the series id (recurring_event_id) for an occurrence of a recurring event, otherwise the event id
--   day        the local calendar day that was checked
--
-- Additive and safe to run twice. Same owner-only RLS as the other tables (is_owner(), see 0002).

create table if not exists public.event_checks (
  calendar_id text not null,
  event_key text not null,
  day date not null,
  checked_at timestamptz not null default now(),
  primary key (calendar_id, event_key, day)
);

alter table public.event_checks enable row level security;
drop policy if exists owner_all on public.event_checks;
create policy owner_all on public.event_checks for all to authenticated using (public.is_owner()) with check (public.is_owner());
