-- Reminders rework: a default reminder for every task with a due date (set in Settings) plus any
-- number of custom reminders per task. Safe to run after 0001-0003, and safe to run twice.
--
--   tasks.remind_default  per-task switch for the default reminder
--   tasks.reminders       custom reminders: [{"kind":"offset","minutes":60}, {"kind":"at","at":"2026-11-12T19:00:00Z"}]
--   settings              one row (id = 1): default offset + the all-day reminder time
--
-- Dedupe stays in reminder_sends, which already has unique (task_id, remind_at): "remind_at" there is
-- the fire time of one reminder instance, so each (task, fire time) is sent once.
-- tasks.remind_at / remind_offset are kept but no longer read; drop them in a later migration.

-- ---------------------------------------------------------------- settings
create table if not exists public.settings (
  id int primary key default 1 check (id = 1),
  -- minutes before the due time; null = no default reminder
  default_remind_offset int default 0 check (default_remind_offset is null or default_remind_offset between 0 and 43200),
  -- minutes after local midnight when all-day tasks remind (480 = 8:00 AM)
  allday_remind_minutes int not null default 480 check (allday_remind_minutes between 0 and 1439),
  updated_at timestamptz not null default now()
);
insert into public.settings (id) values (1) on conflict (id) do nothing;

drop trigger if exists settings_touch on public.settings;
create trigger settings_touch before update on public.settings for each row execute function public.touch_updated_at();

alter table public.settings enable row level security;
drop policy if exists owner_all on public.settings;
create policy owner_all on public.settings for all to authenticated using (public.is_owner()) with check (public.is_owner());

-- ---------------------------------------------------------------- tasks
-- The data conversion runs only the first time (when the columns are added), so re-running this
-- file never touches tasks created afterwards.
do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'tasks' and column_name = 'reminders'
  ) then
    alter table public.tasks
      add column remind_default boolean not null default true,
      add column reminders jsonb not null default '[]'::jsonb;
    alter table public.tasks
      add constraint tasks_reminders_is_array check (jsonb_typeof(reminders) = 'array');

    -- Don't bump updated_at while converting rows.
    alter table public.tasks disable trigger tasks_touch;

    -- Tasks that already had a reminder keep exactly that one and don't also get the new default.
    -- Timed tasks with an offset keep the offset. Everything else (all-day tasks, whose base moved
    -- from 9 AM to the configurable time, and tasks with an exact time) keep the exact old time,
    -- so a reminder already sent is not sent again.
    update public.tasks set
      remind_default = false,
      reminders = case
        when remind_offset is not null and due_at is not null and not all_day and remind_offset between 0 and 43200
          then jsonb_build_array(jsonb_build_object('kind', 'offset', 'minutes', remind_offset))
        else jsonb_build_array(jsonb_build_object('kind', 'at', 'at', to_char(remind_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')))
      end
    where remind_at is not null;

    -- Tasks that are already overdue or done don't suddenly get a default reminder for a time that has passed.
    update public.tasks set remind_default = false
    where remind_at is null and (completed_at is not null or (due_at is not null and due_at < now()));

    alter table public.tasks enable trigger tasks_touch;
  end if;
end $$;

-- ---------------------------------------------------------------- cron query
-- The cron needs open tasks that could have a reminder in the last few hours: due inside a window
-- (default + "before due" reminders are all within 30 days + 1 day of the due time), or carrying custom
-- reminders (an exact time can be anywhere). The exact fire times are worked out in app code.
drop index if exists public.tasks_remind_idx; -- old per-task remind_at index, no longer queried
create index if not exists tasks_remind_due_idx on public.tasks (due_at) where completed_at is null and due_at is not null;
create index if not exists tasks_remind_custom_idx on public.tasks (id) where completed_at is null and reminders <> '[]'::jsonb;

create or replace function public.reminder_candidates(due_from timestamptz, due_to timestamptz)
returns setof public.tasks
language sql stable security invoker set search_path = public as $$
  select t.* from public.tasks t
  where t.completed_at is null
    and ((t.due_at is not null and t.due_at >= due_from and t.due_at <= due_to) or t.reminders <> '[]'::jsonb)
$$;

-- Service role (the cron route) only.
revoke all on function public.reminder_candidates(timestamptz, timestamptz) from public, anon, authenticated;
grant execute on function public.reminder_candidates(timestamptz, timestamptz) to service_role;
