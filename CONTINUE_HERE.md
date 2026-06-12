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

## Seeded demo characters / data to show in a demo
- Lead **Anita Desai** sits at 5 strikes (Five-Strike Rule trigger).
- Clients: **Fatima Sheikh** (FBC-1001, fully invested, annual review due this week), **Mohan Iyer** (FBC-1002, funded, CKYC pending → Compliance "Pending", suspense holding, quarterly review due this week), **Sneha Kulkarni** (FBC-1003, early onboarding, agreement unsigned, **DOB mismatch → Compliance "Flagged"**).
- App leads awaiting qualification: **Aarti Joshi**, **Rohit Bansal** (recovery path), **Meera Pillai**.
- Calendar has two overlapping meetings for RM Shashank today (conflict demo).

## Known "mocked" parts (real build = engineering work)
- Roles are a demo switcher, not auth/permissions.
- "Synced from FBC-Admin", Google Meet link creation, Google Calendar sync, Gmail send, and the Monday auto-reminder job are all **simulated in-browser**. Real build wires these to the respective APIs (FBC-Admin DB, Google Calendar/Meet, Gmail OAuth per RM, a cron reminder job).

## Open / possible next steps (discussed, not yet built)
- Lead → Client conversion when an L4 lead is funded.
- Named assignees within a team (not just team-level).
- Email/WhatsApp notifications on task assignment.
- Client-side app screens (the two-flow login the client actually sees).
- Spec for the RM-matching logic (capacity / language / region / AUM band).
- Spec for the Monday reminder cron + Gmail OAuth.
- Reply-tracking so client email responses surface in the CRM.

## To resume with Claude on another machine
The Claude Code **conversation** does not travel with your account login — transcripts are stored locally per-machine. Bring the **files** over (git is cleanest), open this folder in Claude Code/Desktop, and point Claude at this `CONTINUE_HERE.md` to restore context. Then just say what you want next.
