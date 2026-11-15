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

## One-time setup

### 1. Database
In the Supabase dashboard → **SQL Editor**, run `../supabase/migrations/0001_rm_presales.sql` once.

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
psql -d crmtest -f ../supabase/tests/supabase_stub.sql -f ../supabase/migrations/0001_rm_presales.sql -f ../supabase/tests/rules_test.sql
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
