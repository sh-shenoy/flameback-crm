# Flameback CRM — Continue-Here / Handoff

Lets a fresh chat (or teammate) pick up exactly where we left off. **Start a new chat with:** *"Read CONTINUE_HERE.md and continue."*

## What this is
A clickable **CRM demo wireframe** for Flameback Capital (wealth management) — a **single self-contained file**: `index.html` (HTML + CSS + vanilla JS, no build, no deps). All demo state lives in the browser `localStorage` under `flameback_crm_v1`.

## Where it lives / runs
- **Repo:** https://github.com/sh-shenoy/flameback-crm (public). Path on disk: `/Users/shenoy/CRM/flameback-crm/`.
- **Live:** https://sh-shenoy.github.io/flameback-crm/ — **GitHub Pages, auto-deploys on every push to `master`** (free; no Netlify).
- **Run locally:** open `index.html`, or serve on port 4173 (a `.claude/launch.json` server named **crm** exists). Preview path: `http://localhost:4173/flameback-crm/index.html`.
- **Reset demo data:** `localStorage.removeItem('flameback_crm_v1')` in devtools, then reload (migrations re-seed).

## Working rhythm (important)
- **Verify in the local preview before pushing.** Deploys are free now, so push complete, verified features.
- Edits to the big single file are safest via **Python string-replace scripts** (exact-match `rep()` with assertions), not fragile line edits. The harness Read/line numbers can drift; `grep`/`sed`/Python on disk is the source of truth. Watch the shell **cwd** (it can reset to `/Users/shenoy/CRM`, whose stale `index.html` is NOT the repo file).

## Roles (switch via the "Viewing as" dropdown, top-left)
RM (Shashank), Qualifier (Maya), Investment (Anjali), Operations (Ravi), **RIA Compliance** (Neha), **PMS Compliance** (Imran), Marketing (Tanvi), **Distributor/WM** (ABC Wealth, external), **Partnerships RM** (Aditya) & **Head** (Vikram) for B2B, Leadership (R. Sharma).

## What's built (high level — full list in CHANGELOG.md)
B2C: leads (L1–L4, five-strike), assignment queue, **household onboarding hub** (mobile-keyed, multi-account + family, DIGIO e-sign), clients (one row per account) + **Profiles** (accounts/comm/timeline/notes/**tags**), tags→**content auto-routing**, calendar + 10-min reminders + manual scheduling, reviews, tasks, **Gmail-style inbox**, **Client Reports** (monthly/half-yearly/tax w/ receipts), out list, knowledge hub, suggestions (live Supabase).
Marketing: audience lists (multi-filter), events, content.
Distributor portal: RM-style dashboard, clients, strategies, **invoices** (filter + download), calendar/reviews/IPS — own book; contact-your-RM.
**RIA Compliance:** KYC file (DIGIO-verified), **Monthly SEBI report** (items i–x + drill-down), **Fee Payments** (e-NACH status), **SEBI RIA daily register** (+5yr metrics).
**PMS Compliance:** **PMS Review** (FIU AML → grey list; KYC is the onboarding partner's job outside CRM), **Regulatory Filings** (SEBI PMR/APMI/PMSBazaar, fund-level), **Custodian Reports** (per client, 8 reports, email tracking).
B2B: **Partner Pipeline** + Head **Dashboard** (city-based online/visit engagement).

## Docs in the repo
- **FUNCTIONAL_SPEC.md** — PM/product spec in the RIA-App format (Sections 1–11: scope, screen inventory of 40 screens, screen-by-screen, business logic & rules, integrations, error handling, NFRs, out-of-scope, **open items for PM sign-off**, flows). The reference was Shashank's *Flameback India RIA App* spec at `~/Downloads/Cruise/FLAMEBACK CAPITAL RIA APP.docx`.
- **FLOWS.md** — one-page flow + module overview.
- **CHANGELOG.md** — full running log of everything built.

## Open items / next steps
1. **B2B Qualifier** screen (today the Head assigns — no separate B2B qualification queue).
2. Standardize **product/strategy naming** with the RIA App (OMS vs PMS; show **Cruise** strategy tiers?).
3. Lead→client **auto-conversion** when the agreement is signed (accounts are currently seeded).
4. Report **auto-send** scheduling vs maker-checker approval.
5. Confirm **RIA<₹50L / PMS≥₹50L** routing + International compliance routing (per FUNCTIONAL_SPEC §5.1 / open items).
