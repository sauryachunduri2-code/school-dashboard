-- School Dashboard: schema. Single user (sauryachunduri2@gmail.com), enforced by RLS in 0002.

create type public.area as enum ('school', 'ecs', 'other');

create table public.lists (
  id uuid primary key default gen_random_uuid(),
  area public.area not null,
  name text not null,
  color text not null default '#6b6760',
  sort int not null default 0,
  created_at timestamptz not null default now()
);

create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  notes text not null default '',
  list_id uuid references public.lists(id) on delete set null,
  due_at timestamptz,
  all_day boolean not null default false,
  remind_at timestamptz,
  remind_offset int,
  rrule text,
  starred boolean not null default false,
  flagged boolean not null default false,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index tasks_due_idx on public.tasks (due_at);
create index tasks_remind_idx on public.tasks (remind_at) where completed_at is null and remind_at is not null;

create table public.hours_logs (
  id uuid primary key default gen_random_uuid(),
  date date not null,
  list_id uuid references public.lists(id) on delete set null,
  hours numeric(5,2) not null check (hours > 0),
  note text not null default '',
  created_at timestamptz not null default now()
);
create index hours_date_idx on public.hours_logs (date);

create table public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  user_agent text,
  created_at timestamptz not null default now()
);

create table public.reminder_sends (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.tasks(id) on delete cascade,
  remind_at timestamptz not null,
  sent_at timestamptz not null default now(),
  unique (task_id, remind_at)
);

-- Google refresh token: only ever read/written with the service role (never exposed to the client).
create table public.google_account (
  id int primary key default 1 check (id = 1),
  email text not null,
  refresh_token text not null,
  scopes text,
  updated_at timestamptz not null default now()
);

create table public.calendars (
  id text primary key, -- Google calendar id
  summary text not null,
  color text not null default '#6b6760',
  enabled boolean not null default false,
  is_default boolean not null default false,
  read_only boolean not null default false,
  sync_token text,
  updated_at timestamptz not null default now()
);
create unique index calendars_one_default on public.calendars (is_default) where is_default;

create or replace function public.touch_updated_at() returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

create trigger tasks_touch before update on public.tasks for each row execute function public.touch_updated_at();
