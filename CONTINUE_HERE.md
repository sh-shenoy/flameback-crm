# Flameback CRM — Demo Wireframe · Handoff / Continue-Here Notes

This file lets you (or a fresh Claude session on another machine) pick up exactly where we left off.

## What this is
A clickable **CRM demo wireframe** for Flameback Capital (wealth management), built as a **single self-contained file**: `index.html`. No build step, no dependencies. Double-click to open in a browser, or serve it (see "Run" below). All demo state is saved in the browser via `localStorage` under the key `flameback_crm_v1`.

## Run it
- Simplest: open `index.html` directly in any browser.
- Or serve (nicer for the preview tooling):
  ```
  cd <this folder> && python3 -m http.server 4173
  # then open http://localhost:4173/index.html
  ```
  A `.claude/launch.json` is already configured with a server named **crm** on port 4173.
- To reset the demo to clean seeded data: in the browser devtools console run
  `localStorage.removeItem('flameback_crm_v1')` then reload.

## Architecture (all inside index.html)
- **One file**: HTML + CSS + vanilla JS, no frameworks.
- **State**: a single `DB` object persisted to `localStorage` (`flameback_crm_v1`). `seed()` creates leads/suggestions; `migrate()` adds/upgrades `clients`, `tasks`, `meetings`, app-leads, IPS fields, review dates. Migration is additive so older saved state upgrades cleanly.
- **Roles**: `ROLES` config (RM, Qualifier, Compliance, Operations, Investment) — each has `name`, `email`, `label`, and a `nav` allow-list. `switchRole()` + `applyRole()` toggle nav visibility and identity. This is a **demo role switcher**, not real auth.
- **Routing**: `go(view)` shows one `#view-*` section and calls its `render*()`. Views: dashboard, leads, assignment, onboarding, calendar, reminders, clients, clientProfile, tasks, verification, ips, out, suggestions.
- **Render pattern**: each view has a `render<View>()` that rebuilds innerHTML from `DB`. `badges()` updates sidebar counts.

## What's built (batches 1–5)
1. **Leads / sales pipeline** — editable fields (source, status, interaction type, comments, follow-up, RM, count, L1–L4 stage). **Five-Strike Rule** at L1 (5 outreach attempts → move to Out list). Out List view.
2. **Clients (Active)** — keyed by unique Client ID / contact number. Full profile with tabs: Overview, Investment & SIP, Risk Profile & Agreement, Strategies, KYC (editable), Portfolio (FBC-Admin synced), Invoices, Call Sync. Onboarding **progress stepper** (Sign-up → Questionnaire → Agreement → KYC → Invested).
3. **Multi-team + Tasks & Requests** — cross-team handoff system with From→To team, priority, due, status, and a comment thread. Compliance **Verification Checklist** (Name/PAN/DOB vs uploaded docs, flag/verify, raise to RM). Operations queue. Investment **Portfolios & IPS**.
4. **Onboarding journey + app routing** — flowchart-style onboarding diagram (Self-serve / RM-assisted, switch anytime, abandon→recovery, advisory-first, two client-only steps). **Qualifier** role + **Assignment Queue**: qualify a new app lead, pick best-fit RM, auto-generate a **Google Meet** link and add Client+RM+Qualifier to the invite. **Calendar** with Google Meet links and **conflict detection** + "call & reschedule".
5. **IPS + reviews + Gmail** — per-client **dummy IPS document** (objective, target allocation, benchmark, review schedule). Two cadences: **annual IPS review** + **quarterly portfolio review**. **Reviews & Reminders** view showing who's due **this week** (auto-reminder framing). **Gmail composer** that sends **from the RM's email** ("from the RM or whoever").
6. **Named assignees within a team** — tasks/requests can now be assigned to a **specific person** (not just team-level). `TEAM_MEMBERS` roster per team; the task modal has an **Assign to person** dropdown that repopulates by team; a new **"Assigned to me"** inbox filter shows tasks assigned to the current identity. Some seed tasks are pre-assigned; others left "Unassigned (whole team)".
7. **Kanban board + ticket activity log** — Tasks & Requests now has a **Board ⇄ List** toggle (board is default). The board has four columns (Open / In Progress / Blocked / Done); cards are **drag-and-drop** between columns and dropping updates the ticket status. All ticket events feed a unified **Activity log** (the old "Conversation" thread): status moves and reassignments are appended as system entries (dashed style), alongside free-text updates. **Reassignment requires a reason** — changing a ticket's team or assignee reveals a required reason field, and on save it logs `Reassigned <from> → <to> — <reason>` so the full history of who did what is preserved. Key functions in `index.html`: `setTaskView`, `renderBoard`/`kcard`, the DnD handlers (`dragTask`/`dropTask`/`moveTask`), and `logTask` (the single place that appends activity entries).

## Seeded demo characters / data to show in a demo
- Lead **Anita Desai** sits at 5 strikes (Five-Strike Rule trigger).
- Clients: **Fatima Sheikh** (FBC-1001, fully invested, annual review due this week), **Mohan Iyer** (FBC-1002, funded, CKYC pending → Compliance "Pending", suspense holding, quarterly review due this week), **Sneha Kulkarni** (FBC-1003, early onboarding, agreement unsigned, **DOB mismatch → Compliance "Flagged"**).
- App leads awaiting qualification: **Aarti Joshi**, **Rohit Bansal** (recovery path), **Meera Pillai**.
- Calendar has two overlapping meetings for RM Shashank today (conflict demo).

## Feature Suggestions — REAL shared board (Supabase)
Unlike the rest of the demo (localStorage only), the **Feature Suggestions** board is wired to a real shared backend so department heads can add ideas and 👍 agree / 👎 disagree from their own machines.

- **Empty at start.** No seeded suggestions — the board fills from real input.
- **Anyone can add**; **everyone can agree/disagree**. No login — each browser gets an anonymous voter id (`fbc_voter` in localStorage), so one browser = one stance per idea, switchable. Cards sort by **net support** (agree − disagree).
- **Backend = Supabase.** The Supabase JS SDK is loaded via CDN in `<head>`. Config lives in two constants near the top of the `<script>` in `index.html`: `SUPABASE_URL` and `SUPABASE_ANON_KEY`. While they're blank, the board shows a setup panel and the rest of the CRM works normally.
- Realtime is on: new ideas/votes appear live for everyone viewing the board.

### To activate the board (one-time)
1. Create a free project at **supabase.com**.
2. In the SQL editor, run:
   ```sql
   create table suggestions (
     id uuid primary key default gen_random_uuid(),
     title text not null,
     description text default '',
     category text default 'Other',
     author text default 'Anonymous',
     status text default 'Requested',
     created_at timestamptz default now()
   );
   create table votes (
     suggestion_id uuid references suggestions(id) on delete cascade,
     voter text not null,
     stance text not null check (stance in ('agree','disagree')),
     created_at timestamptz default now(),
     primary key (suggestion_id, voter)
   );
   alter table suggestions enable row level security;
   alter table votes enable row level security;
   create policy "open suggestions" on suggestions for all using (true) with check (true);
   create policy "open votes" on votes for all using (true) with check (true);
   alter publication supabase_realtime add table suggestions;
   alter publication supabase_realtime add table votes;
   ```
3. Project Settings → API: copy the **Project URL** and **anon public** key into `SUPABASE_URL` / `SUPABASE_ANON_KEY` in `index.html`.
4. **Host the page** (it must be reachable by the dept heads — e.g. Netlify drag-drop, Vercel, GitHub Pages, Cloudflare Pages) and share the link.

**Security note:** the policies above are fully **open** — anyone with the link + anon key can read/add/vote/delete. That's fine for an internal, trust-based board among department heads. The anon key is safe to ship in client code by design (it's gated by these row-level policies). If you later want one-person-one-vote or to lock down deletes/status changes, add Supabase Auth (e.g. email magic-link) and tighten the policies.

## Known "mocked" parts (real build = engineering work)
- Roles are a demo switcher, not auth/permissions.
- "Synced from FBC-Admin", Google Meet link creation, Google Calendar sync, Gmail send, and the Monday auto-reminder job are all **simulated in-browser**. Real build wires these to the respective APIs (FBC-Admin DB, Google Calendar/Meet, Gmail OAuth per RM, a cron reminder job).

## Open / possible next steps (discussed, not yet built)
- Lead → Client conversion when an L4 lead is funded.
- Email/WhatsApp notifications on task assignment.
- Client-side app screens (the two-flow login the client actually sees).
- Spec for the RM-matching logic (capacity / language / region / AUM band).
- Spec for the Monday reminder cron + Gmail OAuth.
- Reply-tracking so client email responses surface in the CRM.

## To resume with Claude on another machine
The Claude Code **conversation** does not travel with your account login — transcripts are stored locally per-machine. Bring the **files** over (git is cleanest), open this folder in Claude Code/Desktop, and point Claude at this `CONTINUE_HERE.md` to restore context. Then just say what you want next.
