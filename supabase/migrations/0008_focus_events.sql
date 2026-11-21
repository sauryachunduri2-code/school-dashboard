-- Focus on a calendar to-do event, not only a Daybook task.
-- Additive and safe to run twice.
--
--   event_id  the Google event id focused on (an occurrence's own id for a recurring event); null for a task or no target
--   title     the title when the session started, so the pill and history read right even if the item is gone

alter table public.focus_sessions add column if not exists event_id text;
alter table public.focus_sessions add column if not exists title text;
