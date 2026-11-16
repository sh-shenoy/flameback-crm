# Flameback CRM — RM pre-sales app (v1)

The working version of the RM flow, from lead to committed: leads, manual add, Excel/CSV upload, follow-ups, meetings, the Out List and the hand-off to onboarding. Everything else in the demo shows **Coming soon**.

The original clickable demo (`../index.html`) is untouched and remains the visual reference.

## What's in v1

| Area | Behaviour |
|---|---|
| Sign-in | Google, `@flamebackcapital.com` accounts only. The first person to sign in becomes admin. |
| Leads in | Manual add, or upload a `.xlsx` / `.csv` (column matching, preview, duplicate check, undo, download of skipped/failed rows). No integrations yet. |
| Assignment | Round-robin across RMs who are "in rotation" (Team & rotation page). Admins can assign by hand. |
| Product | RIA or PMS on every lead; set when added (per lead, per upload, or per row), changeable any time. |
| Pipeline | Active contact → Awaiting meeting → Holding period / Deferred → Converting. |
| Five strikes | Active contact: unanswered attempts (call "No answer", or a message "Sent" with no reply in 48h; Connected/Replied resets). Awaiting meeting: every reminder. Holding: every follow-up. Fifth strike → Out List. Counter resets on every bucket change. |
| Out List | Five strikes or Not interested. Bring back needs a follow-up date, resets strikes, returns to the bucket it left. |
| Deferred | Returns to Holding on its date. |
| Converting | Committed. RIA onboards in the Flameback app, PMS via Silver Bullet (onboarding module is separate, coming later). |
| Access | RMs see only their own leads (enforced in the database). Admins see all. |
| Duplicates | Same phone or email in the unit can't be added twice; you get a warning with a merge option. |
| Tasks | Kanban board (Open / In Progress / Blocked / Done) and list view; Assigned to me, my team, Raised by me. Raised to a team and optionally a person, with priority, due date, optional lead, comments and history. Blocked needs a reason. Templates: account opening, address change, strategy switch, withdrawal, top-up, compliance query. Overdue tasks show on the dashboard and in Today's actions. |
| Calendly | Each RM connects their own Calendly (Connections). Bookings arrive automatically: an existing lead (matched by the link's hidden lead id, then email, then phone) moves to Awaiting meeting with the time and Meet link; someone new becomes that RM's lead with source Calendly. Cancellations clear the meeting and set a follow-up for today. **Send booking link** on the lead page gives a pre-filled link with WhatsApp / email buttons. Setup: `supabase/functions/README.md`. |
| Admin overview | Admin → Team overview: per person open leads, follow-ups due / overdue, meetings, meetings without outcome, untouched leads, activity, new → committed, overdue tasks. Suggested **nudges** sent as notifications (with history). Person page: their pipeline, recent activity, bulk reassign. |
| Access | New sign-ups wait on **Admin → Access requests**; an admin approves them as RM or Admin (or rejects). Admins are notified of each request. |
| Notifications | Bell with unread count, live pop-ups and a Notifications page: new leads (one per upload), Calendly bookings and cancellations, 9 am digest, meeting in 30 min, task created / assigned / moved / commented / file added, email replies, access requests. |
| Calendar | Day, week and month views of your meetings (Calendly and manual) and tasks due, in IST; schedule from the calendar. |
| Reports | Conversion by source, campaign, referrer, product or RM (admins): leads, contacted, met, committed, Out List; CSV download. |
| Gmail | Connect under Connections; send from the lead page (optionally replying in the last thread); emails with leads appear on the timeline and a reply clears strikes. |
| Task files | Attach files to tasks (20 MB each), stored privately; visible to whoever can see the task. |
| Products | RIA, PMS, US RIA. |
| Teams | Each person has a team (Sales, Operations, Compliance, Investment), set on Team & rotation. Only Sales people in rotation receive round-robin leads; new sign-ups start out of rotation. |

## One-time setup

### 1. Database
In the Supabase dashboard → **SQL Editor**, run each file in `../supabase/migrations/` once, in order (`0001_…` to `0005_…`). When a new migration file is added later, run just that one.

It creates the tables, rules and access policies, and schedules the timed rules (48h message strikes, deferred returns) every 15 minutes with `pg_cron`. If `pg_cron` isn't enabled, enable it under **Database → Extensions** and re-run the last `do $$ … $$` block. The app also runs these rules whenever someone opens it.

### 2. Google sign-in
1. Google Cloud Console → APIs & Services → Credentials → **Create OAuth client ID** (Web application).
   - Authorised redirect URI: `https://<project-ref>.supabase.co/auth/v1/callback`
   - Setting the OAuth consent screen to **Internal** limits it to the Flameback Workspace.
2. Supabase → **Authentication → Providers → Google**: enable it and paste the client ID and secret.
3. Supabase → **Authentication → URL Configuration**: set the Site URL to where the app is hosted, and add `http://localhost:5173` to the redirect URLs for local development.

### 3. Run locally
```bash
cp .env.example .env      # fill in the project URL and anon key (Project Settings → API)
npm install
npm run dev
```

## Making someone an admin
On **Team & rotation**, an admin can change roles, take people in or out of the round-robin, and remove access. The very first sign-in is admin automatically.

## Tests
The database rules are covered by `../supabase/tests/rules_test.sql`, which runs on plain Postgres with a stand-in for Supabase's auth schema:

```bash
createdb crmtest
psql -d crmtest -f ../supabase/tests/supabase_stub.sql -f ../supabase/migrations/0001_rm_presales.sql -f ../supabase/migrations/0002_tasks.sql -f ../supabase/tests/rules_test.sql
```

It ends with `ALL TESTS PASSED`.

## Layout
```
app/
  src/lib/        supabase client, types, IST date formatting, phone clean-up
  src/components/ shell (sidebar, search, add lead), shared UI
  src/pages/      Dashboard, Leads, LeadPage, OutList, Upload, Team, Login
supabase/
  migrations/     schema + rules (run in order)
  tests/          rule tests
```
