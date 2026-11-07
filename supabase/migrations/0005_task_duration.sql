-- Task "takes" length: how long a timed task is expected to take, in minutes.
-- The Home timeline draws a task as a block that ENDS at due_at and is this tall (null = 30 minutes).
-- Additive and safe to run twice; existing rows keep null.

alter table public.tasks add column if not exists duration_minutes int;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.tasks'::regclass and conname = 'tasks_duration_minutes_range'
  ) then
    alter table public.tasks
      add constraint tasks_duration_minutes_range
      check (duration_minutes is null or (duration_minutes > 0 and duration_minutes <= 1440));
  end if;
end $$;
