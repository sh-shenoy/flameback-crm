-- Flameback CRM · 0007: standard meeting types for everyone's Cal.com
--
-- Admins keep the list here (Admin → Meeting types). When an RM connects Cal.com, or clicks
-- "Add Flameback meeting types", the calcom function creates any of these that are missing
-- in their Cal.com account (matched by slug). Existing event types are never changed or removed.

create table public.meeting_templates (
  id             uuid primary key default gen_random_uuid(),
  title          text not null check (length(trim(title)) > 0),
  slug           text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  length_minutes int  not null check (length_minutes between 5 and 480),
  description    text,
  sort_order     int  not null default 100,
  is_active      boolean not null default true,
  created_at     timestamptz not null default now()
);
alter table public.meeting_templates enable row level security;
create policy meeting_templates_read  on public.meeting_templates for select to authenticated using (public.is_staff());
create policy meeting_templates_admin on public.meeting_templates for all to authenticated using (public.is_admin()) with check (public.is_admin());

insert into public.meeting_templates (title, slug, length_minutes, description, sort_order) values
  ('Quick Intro call',              'quick-intro-call',             20, 'First conversation: who we are, what you''re looking for, whether there''s a fit', 10),
  ('Discovery / needs analysis',    'discovery-needs-analysis',     45, 'Goals, time horizon, income, existing investments, risk appetite, family situation', 20),
  ('Follow-up / questions',         'follow-up-questions',          20, 'Answer questions and talk through anything still open', 30),
  ('Onboarding kickoff',            'onboarding-kickoff',           45, 'KYC documents, agreement, risk profile, timelines', 40),
  ('Periodic catch-up / touch-base','periodic-catch-up-touch-base', 30, 'A regular check-in on your goals and portfolio', 50)
on conflict (slug) do nothing;
