-- Task checklists, import bookkeeping, and focus sessions (the Focus page).
-- Additive and safe to run twice. Same owner-only RLS as the other tables (is_owner(), see 0002).
--
--   tasks.steps        checklist inside a task: [{ "id": text, "title": text, "done": bool }]
--   tasks.source       where an imported task came from ('classroom', 'canvas'); null = made in Daybook
--   tasks.external_id  the id in that source, so a re-import updates instead of duplicating
--
--   focus_sessions     one row per timer run on the Focus page. Elapsed time is always computed from the
--                      timestamps (started_at, paused_at, paused_ms, ended_at), never from ticks, so it stays
--                      right across sleep, reloads and devices. At most one session is open (ended_at null).

alter table public.tasks add column if not exists steps jsonb not null default '[]'::jsonb;
alter table public.tasks add column if not exists source text;
alter table public.tasks add column if not exists external_id text;
create unique index if not exists tasks_source_external_idx on public.tasks (source, external_id) where external_id is not null;

create table if not exists public.focus_sessions (
  id uuid primary key default gen_random_uuid(),
  task_id uuid references public.tasks(id) on delete set null,
  kind text not null default 'work' check (kind in ('work', 'break')),
  mode text not null check (mode in ('stopwatch', 'countdown', 'pomodoro', 'until_event')),
  planned_seconds int check (planned_seconds is null or planned_seconds > 0),
  started_at timestamptz not null,
  paused_at timestamptz,
  paused_ms bigint not null default 0 check (paused_ms >= 0),
  ended_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists focus_sessions_started_idx on public.focus_sessions (started_at);
create unique index if not exists focus_sessions_one_open on public.focus_sessions ((true)) where ended_at is null;

alter table public.focus_sessions enable row level security;
drop policy if exists owner_all on public.focus_sessions;
create policy owner_all on public.focus_sessions for all to authenticated using (public.is_owner()) with check (public.is_owner());
