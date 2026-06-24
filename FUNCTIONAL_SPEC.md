# FLAMEBACK CAPITAL — Flameback CRM (Back-Office)
## FUNCTIONAL SPECIFICATION DOCUMENT
Version: 2.0 | June 2026 | CONFIDENTIAL
Prepared by: Shashank Shenoy | Status: Draft for PM sign-off

> Companion to the **Flameback India RIA App** spec (the client-facing app). That app onboards investors; **this CRM is what the firm's teams use** to acquire, onboard, serve and stay compliant. Where the two meet, the app's post-profile onboarding (KYC / agreement / broker / fee / deploy, app screens S-I01–S-I05) lands in this CRM for the RM and Compliance.

> **About this version (2.0).** This is a *minutely detailed* rewrite of the v1 functional spec. Every screen is documented to the field level: each UI element, the exact data source for each field, every action and the precise state change it makes, every computed value with its formula, every status colour rule, every empty/edge state, and every validation. The current artefact is a **single-file front-end wireframe** (`index.html`, vanilla JS, `localStorage`); this spec describes both **what the wireframe does today** (the implemented behaviour, so engineering can reproduce it) and, in **PM INPUT** boxes, **what a production build must have a Product Owner decide** (data sources, providers, policies the wireframe fakes or hard-codes). Where the wireframe hard-codes a value or fakes a data source, that is called out explicitly so it is never mistaken for a real requirement.

---

### HOW TO READ THIS DOCUMENT
- **Section 1** — Document Overview & Scope
- **Section 2** — System Architecture, Data Model & Screen Overview
- **Section 3** — User Roles, Scoping & Authentication
- **Section 4** — Screen-by-Screen Functional Specifications (the core; 40 screens)
- **Section 5** — Business Logic & Rules
- **Section 6** — Integrations
- **Section 7** — Error Handling
- **Section 8** — Non-Functional Requirements
- **Section 9** — Out of Scope
- **Section 10** — Open Items Requiring PM Sign-Off
- **Section 11** — End-to-End Flows
- **Appendix A** — Data Dictionary (every persisted object & field)
- **Appendix B** — Glossary, status enumerations & colour legend

**Conventions used throughout**
- **`code font`** = a literal field name, function name, value or string as it exists in the wireframe today. These are the source of truth for behaviour, not invented names.
- **[PM INPUT]** = a decision a Product Owner must make before production engineering. The wireframe either hard-codes, fakes, or omits this.
- **[WIREFRAME]** = behaviour that exists only because this is a demo (seeded data, simulated integrations, role-switcher instead of auth) and must be replaced for production.
- **"Toast"** = the transient confirmation message shown at the bottom of the screen. Exact toast strings are quoted because they document the intended user-facing confirmation.
- Money is Indian Rupees (₹); `fmtINR()` formats with the Indian digit grouping. Dates display in `en-IN` locale (`d MMM yyyy`).

---

## 1. Document Overview

### 1.1 Purpose
Defines the complete functional behaviour of the **Flameback CRM** v1.0 — the internal back-office for Sales, Onboarding (RM-led), Investment, Operations, Compliance (RIA + PMS), Marketing, Partnerships (B2B) and Leadership, plus an external portal for distributors / wealth managers. It is the primary reference for engineering, QA and PM sign-off. Visual design and microcopy are owned by the Design Brief; this document owns *behaviour, data and rules*.

### 1.2 Scope (in)
The CRM covers, end to end:
- **B2C lead acquisition & qualification** — manual RM-created leads and app sign-ups; the five-strike discipline; the Out List; the Lead Desk assignment queue.
- **RM-led onboarding** — the mobile-keyed household hub, multi-account and multi-family-member onboarding, the long onboarding form, and DIGIO e-sign of the agreement.
- **Clients, accounts & unified profiles** — one row per account, household grouping, the account-detail page, and the person-level profile that rolls up every lead and account on a mobile number.
- **Tags & content routing** — client tags (pain points / interests), AI-suggested tags, and marketing content auto-delivered to clients whose tags intersect the article's tags.
- **Operating tools** — calendar with Google Meet and a 10-minute pre-call reminder; reviews & reminders (annual IPS + quarterly portfolio); a cross-team task board; a Gmail-style inbox; client reporting (monthly / half-yearly / tax).
- **Distributor portal (external)** — an RM-style view scoped to the partner's own book, with invoices.
- **RIA compliance** — per-client KYC file (DIGIO-verified), monthly SEBI report (items i–x), advisory-fee auto-debit (e-NACH) status, and the SEBI RIA daily register.
- **PMS compliance** — FIU AML screening / grey list, fund-level regulatory filings (SEBI PMR / APMI / PMSBazaar), and per-client custodian reports.
- **B2B / Partnerships** — partner pipeline, engagement-mode-by-city, and the Head's dashboard.
- **Leadership oversight** — department throughput, a "needs your attention" escalation feed, and per-person scorecards.

### 1.3 Scope (out)
See **Section 9**. In brief: the client-facing app, a live portfolio-analytics / P&L engine, a rebalancing / execution engine, real auth/SSO, real payment-gateway / mandate setup, and HUF / intermediary onboarding are all out of scope for v1.0.

### 1.4 Audience & assumptions
- **Audience:** product, engineering, QA, compliance reviewers, and the integration partners named in Section 6.
- **Assumption A1:** portfolio holdings, valuations and returns are **synced from the custodian / fund administrator**; the CRM is a system of *engagement and compliance*, not a *calculation engine*. [PM INPUT — confirm the sync source, cadence and field mapping; see INT-5.]
- **Assumption A2:** every external system in Section 6 is **mocked** in the wireframe; production requires named providers, contracts and field mappings.
- **Assumption A3:** identity (who the logged-in user is) is faked by a role switcher; production requires real auth (Section 3.2).

### 1.5 Version Log
| Version | Date | Author | Changes |
|---|---|---|---|
| 1.0 | June 2026 | Shashank Shenoy | First CRM functional spec; aligned to RIA App spec format. |
| 2.0 | June 2026 | Shashank Shenoy | Field-level rewrite: every screen documented to data-source / action / state-change / formula / edge-case granularity; added Data Dictionary (Appendix A) and Glossary (Appendix B); explicit [WIREFRAME] vs [PM INPUT] separation. |

---

## 2. System Architecture, Data Model & Screen Overview

### 2.1 Two motions, role-based
- **B2C** — individuals and families from ads, the website, referrals, and app sign-ups.
- **B2B / Partnerships** — partner firms (distributors, wealth managers, family offices, IFAs).

Every user works *as a role*; the **navigation menu and the data they can see follow the role** (Section 3). Two structural ideas underpin the whole CRM:

1. **Household = one mobile number.** A person may hold **one account per product** — `PMS Lite (RIA)`, `PMS`, `International investing`; family members sit under the primary holder's number. The Clients list shows **one row per account**; the Profile rolls accounts + leads up to one *person*.
2. **Scoping.** RM = own book; Distributor = own clients; **RIA Compliance** = RIA clients; **PMS Compliance** = PMS clients; Investment / Leadership = all. Scoping is enforced today by helper functions in the UI layer; production must enforce it at the data layer (NFR 8.3).

### 2.2 Technical shape (current artefact) [WIREFRAME]
- **One file:** `index.html` — HTML + CSS + vanilla JS, no build step, no dependencies.
- **Persistence:** the entire application state is a single JSON object `DB`, stored in browser `localStorage` under the key **`flameback_crm_v1`**. `save()` writes the whole object on every mutation; `load()` reads it (falling back to `seed()` on first run).
- **Seeding & migrations:** on load, `migrate()` runs a series of **versioned, idempotent backfills** guarded by boolean flags on `DB` (e.g. `demoPeopleV2`, `demoHouseholdV1`, `marketingV1`, `marketingV2`, `tagsV1`, `invHistV1`, `pmsFilingsV2`, `appLeadsSeeded`). Each flag, once set, prevents its block re-running — so existing browsers gain new seed data without losing edits. `ensureClientExtras(c)` and `ensureLeadExtras(l)` lazily backfill missing fields on every client/lead at load (this is where most per-client compliance, demat, IPS and report defaults are computed; see Appendix A).
- **Reset:** clearing `localStorage` key `flameback_crm_v1` and reloading re-seeds from scratch.
- **One live integration:** the Feature-Suggestions board reads/writes **Supabase** (key `fbc_voter` in `localStorage` identifies an anonymous voter). Everything else is simulated.

> **[PM INPUT] — Production architecture.** The wireframe's `localStorage` `DB` must be replaced by a real backend (API + database) with the data model in Appendix A. Decide: persistence technology, multi-user concurrency / record locking, the audit-log store (Section 8.4 requires an immutable log), and how the custodian/admin sync (A1) populates the `clients[]` collection.

### 2.3 Top-level data collections (the `DB` object)
Full field-by-field detail is in **Appendix A**. The collections are:

| Collection | Holds | Key / id |
|---|---|---|
| `leads[]` | B2C leads **and** app sign-ups (an app sign-up is a lead with `appUser:true`) | `id` (int, `DB.nextId`) |
| `clients[]` | **one object per account** (not per person); a person with 3 products = 3 client objects sharing a `contact` number | `cid` (e.g. `FBC-1001`) |
| `forms[]` | onboarding forms, **keyed by mobile**; one per account being onboarded | `no` (e.g. `FORM-1001`, `DB.nextForm`) |
| `meetings[]` | calendar events (calls, video, visits) | `id` (`DB.nextMtg`) |
| `tasks[]` | cross-team task board tickets | `id` (`DB.nextTask`) |
| `emails[]` | inbox/sent messages (incl. CRM-sent reports/IPS/agreements) | `id` (`DB.nextEmail`) |
| `distributors[]` | channel partners (for marketing pool + portal identity) | name |
| `lists[]` | marketing audience segments | `id` (`DB.nextList`) |
| `events[]` | marketing events | `id` (`DB.nextEvent`) |
| `articles[]` | marketing content articles (tagged) | `id` (`DB.nextArticle`) |
| `tags[]` | the global tag vocabulary (preset + created) | string |
| `pmsFilings[]` | fund-level regulatory filings (PMR / APMI / PMSBazaar) | index |
| `custReports[]` | the 8 custodian report *types* (config + tracking) | index |
| `b2bLeads[]` | partner-firm pipeline | `id` (`DB.nextB2b`) |

### 2.4 Path tags (journey shorthands)
| Tag | Path | Screens | Description |
|---|---|---|---|
| B2C-ACQ | Acquire | S-03 → S-05 → S-06 | Lead / app sign-up → qualify → assign RM + book intro. |
| B2C-ONB | Onboard | S-07 → S-08 → S-09 | Household hub → add accounts/family → form → e-sign. |
| B2C-SERVE | Serve | S-10/S-13 → S-14/S-16/S-19 | Profiles, meetings, reviews, reports. |
| COMP-RIA | RIA compliance | S-30 → S-33 | KYC file, SEBI report, fee status, daily register. |
| COMP-PMS | PMS compliance | S-34 → S-36 | FIU/grey list, filings, custodian reports. |
| B2B | Partnerships | S-37 → S-38 | Partner pipeline → assign → engage (online/visit). |
| PARTNER | Distributor portal | S-26 → S-29 | External partner's own book + contact RM. |

### 2.5 Screen Inventory (40 screens)
| ID | Screen Name | Primary roles | §4 |
|----|-------------|---------------|----|
| S-01 | Login / Role switch | All | 4.0 |
| S-02 | Role Dashboard (RM view) | RM | 4.1 |
| S-03 | Leads | RM | 4.1 |
| S-04 | Lead Detail (drawer) | RM | 4.1 |
| S-05 | Assignment Queue | Qualifier | 4.2 |
| S-06 | Qualify & Assign (modal) | Qualifier | 4.2 |
| S-07 | Onboarding Journey | RM | 4.3 |
| S-08 | Onboarding — Household Hub | RM | 4.3 |
| S-09 | Onboarding Form | RM | 4.3 |
| S-10 | Clients (accounts) | RM, Investment, Ops, Leadership | 4.4 |
| S-11 | Account Detail | RM, Investment, Ops, Leadership | 4.4 |
| S-12 | Profiles Directory | RM, Investment, Leadership | 4.4 |
| S-13 | Person Profile | RM, Investment, Leadership | 4.4 |
| S-14 | Calendar | RM, Distributor, Investment, Leadership, Qualifier, B2B | 4.5 |
| S-15 | Schedule Meeting / Call (modal) | as above | 4.5 |
| S-16 | Reviews & Reminders | RM, Investment, Distributor | 4.5 |
| S-17 | Tasks & Requests | All operating roles | 4.5 |
| S-18 | Inbox | All | 4.5 |
| S-19 | Client Reports | RM, Investment, Distributor | 4.6 |
| S-20 | Out List | RM, Leadership | 4.1 |
| S-21 | Knowledge Hub | All | 4.10 |
| S-22 | Feature Suggestions | All | 4.10 |
| S-23 | Audience Lists | Marketing | 4.8 |
| S-24 | Events | Marketing | 4.8 |
| S-25 | Content | Marketing | 4.8 |
| S-26 | Distributor Dashboard | Distributor | 4.7 |
| S-27 | Distributor Clients | Distributor | 4.7 |
| S-28 | Distributor Strategies | Distributor | 4.7 |
| S-29 | Distributor Invoices | Distributor | 4.7 |
| S-30 | RIA Compliance — KYC file | RIA Compliance | 4.6 |
| S-31 | Monthly SEBI Report | RIA Compliance | 4.6 |
| S-32 | Fee Payments (e-NACH) | RIA Compliance | 4.6 |
| S-33 | SEBI RIA Daily Report | RIA Compliance | 4.6 |
| S-34 | PMS Review (FIU / grey list) | PMS Compliance | 4.6 |
| S-35 | Regulatory Filings | PMS Compliance | 4.6 |
| S-36 | Custodian Reports | PMS Compliance | 4.6 |
| S-37 | Partner Pipeline (B2B) | Partnerships RM, Head | 4.9 |
| S-38 | B2B Dashboard | Partnerships Head | 4.9 |
| S-39 | Leadership | Leadership | 4.9 |
| S-40 | Role Dashboards (Qualifier / Investment / Operations / Compliance / Distributor) | respective | 4.1 |

---

## 3. User Roles, Scoping & Authentication

### 3.1 Roles & navigation
There are **11 roles**, selected via the "Viewing as" switcher (top-left). Each role object (`ROLES[key]`) carries a display `name` (the demo person), an `email`, a `label`, and an ordered `nav[]` array that **defines exactly which screens appear in the sidebar, in order**. `inbox` is appended to every role's nav by a post-processing loop. The table below lists each role's nav verbatim.

| Role key | Person (demo) | Label | Sidebar nav (in order) |
|---|---|---|---|
| `RM` | Shashank | Relationship Manager | dashboard, leads, onboarding, calendar, reminders, clients, profiles, reports, invoices, tasks, out, suggestions, hub, inbox |
| `Qualifier` | Maya Sharma | Qualifier · Lead Desk | dashboard, assignment, calendar, tasks, suggestions, hub, inbox |
| `Compliance` | Neha Gupta | RIA Compliance Team | dashboard, verification, compreport, feepay, riareport, tasks, clients, suggestions, hub, inbox |
| `PMSCompliance` | Imran Khan | PMS Compliance Team | pmsreview, pmsfilings, custreports, tasks, inbox, hub |
| `B2BRM` | Aditya Rao | Partnerships RM (B2B) | b2bpipeline, calendar, tasks, inbox, hub |
| `B2BHead` | Vikram Sethi | Partnerships Head (B2B) | b2bdash, b2bpipeline, calendar, tasks, inbox, hub |
| `Operations` | Ravi Menon | Operations Team | dashboard, tasks, clients, suggestions, hub, inbox |
| `Investment` | Anjali Rao | Investment Team | dashboard, ips, reminders, clients, profiles, reports, invoices, calendar, tasks, suggestions, hub, inbox |
| `Owner` | R. Sharma | Leadership · Dept Heads | owner, clients, profiles, reports, invoices, tasks, verification, ips, reminders, calendar, leads, out, suggestions, hub, inbox |
| `Marketing` | Tanvi Shah | Marketing Team | events, lists, content, calendar, tasks, suggestions, hub, inbox |
| `Distributor` | ABC Wealth | Distributor / Wealth Manager | dashboard, distclients, reports, invoices, calendar, reminders, ips, diststrategies, inbox |

`switchRole(r)` sets `currentRole`, re-applies the nav, and navigates to the role's first nav item.

> **[WIREFRAME] — there is no real identity.** Switching role is a demo convenience; any user can become any role and see that role's data. Production must replace this with authenticated identity + RBAC (Section 3.2, NFR 8.3).

### 3.2 Scoping helpers (how "own book" is computed)
| Helper | Rule (current) | Used by |
|---|---|---|
| `mine(list)` | If `RM`: items where `x.rm === ROLES.RM.name` ("Shashank"). If `Distributor`: items where `x.distributor === distName()`. Else: the full list. | Leads, clients, reports, reminders, dashboards |
| `riaClients()` | `DB.clients.filter(c => (c.product||'').indexOf('RIA') >= 0)` | All RIA compliance screens |
| `pmsClients()` | `DB.clients.filter(c => (c.product||'').indexOf('RIA') < 0)` (i.e. PMS + International) | All PMS compliance screens |
| `profilesScope()` | `RM` sees a person if `p.rm === me` OR any of the person's accounts/leads is theirs; else all | Profiles directory |
| `b2bScope()` | `B2BRM` sees `b2bLeads` where `l.rm === ROLES.B2BRM.name`; `B2BHead` (and others) see all | B2B pipeline |
| `myMeetings()` | `RM`: meetings where `m.rm === me`. `Distributor`: meetings where `m.rm === distName()` or an attendee is one of the distributor's clients. Else: all. | Calendar, reminders count |
| `myEmail()` | `ROLES[currentRole].email` | Inbox |
| `reminderScope()` | `RM`: meetings where `m.rm === me`; else all | Reviews badge |

> **[PM INPUT] — Scoping is UI-only today.** Each helper above runs in the browser over the full `DB`. Production must enforce the *same rules at the API/query layer* (see **BR-AUTH-1** and NFR 8.3) so a user can never fetch out-of-scope records. Confirm the exact scoping matrix for every role × collection, including: can Investment edit (not just view) any client? Can Operations open a client outside any RM relationship? Can Leadership see PII unmasked?

### 3.3 Authentication
- **BR-AUTH-1** — RBAC must be enforced at the API/query layer, not only in the UI.
- **[PM INPUT] — Auth method (internal):** SSO (Google Workspace) vs email + password + MFA for internal staff. Define session timeout, MFA policy, password policy, and de-provisioning on exit.
- **[PM INPUT] — Auth method (external):** the distributor portal needs its own credentialed login distinct from staff SSO; define onboarding of a new distributor's login, password reset, and whether multiple users per distributor firm are allowed.
- **[PM INPUT] — Identity → role mapping:** how a real user maps to one or more roles; whether a person can hold two roles (e.g. an RM who is also a Dept Head) and how the UI handles that.

### 3.4 Demo personnel directories (for reference) [WIREFRAME]
- `RMS = ['Shashank','Priya Nair','Arjun Mehta','Divya Rao','Karan Shah']` — the RM picklist used across leads, onboarding, clients, lists.
- `RM_EMAILS` maps each RM to an email; `emailOf(name)` resolves any name to an email (RM map → role lookup → `firstname@flamebackcapital.com` fallback).
- `TEAM_MEMBERS` — assignable people per team: Compliance `['Neha Gupta','Imran Khan','Sara Thomas']`, Operations `['Ravi Menon','Deepak Verma','Pooja Nair']`, Investment `['Anjali Rao','Vikas Shah','Rhea Kapoor']`, RM `RMS`, Marketing `['Tanvi Shah','Rohan Kapoor','Sneha Iyer']`.
- `B2B_RMS = [{name:'Aditya Rao',city:'Mumbai'},{name:'Meera Joshi',city:'Bangalore'},{name:'Sanjay Kapoor',city:'Delhi'}]` — partnerships RMs and their cities (drives the engagement-by-city rule).

> **[PM INPUT] — Personnel & teams must come from an HR/identity source**, not hard-coded arrays. Confirm the team taxonomy (RM / Compliance / Operations / Investment / Marketing / Partnerships) and how members are added/removed.

---

## 4. Screen-by-Screen Functional Specifications

Each screen is documented with a consistent template:
**Purpose · Entry & navigation · Scope/visibility · Layout & elements · Field-level detail · Actions & state effects · Business logic · States & empty states · Edge cases · PM INPUT.**
Sub-sections that don't apply to a given screen are omitted. Field tables read: *field → data source → format/derivation → editable?*. Action tables read: *control → trigger → precondition → effect (state change + toast) → result*.

### 4.0 · S-01 — Login / Role switch

- **Purpose.** Establish which role the session operates as. [WIREFRAME] a dropdown of the 11 roles; no credentials.
- **Behaviour.** Selecting a role calls `switchRole(key)`, which sets `currentRole`, rebuilds the sidebar from `ROLES[key].nav`, and navigates to the first nav entry.
- **PM INPUT.** Replace entirely with real authentication and identity→role resolution (Section 3.3). The role label and the demo person's name shown in the header come from `ROLES[currentRole]`.

---

### 4.1 · Sales (RM) & Role Dashboards

#### S-02 / S-40 — Role Dashboard (`renderDash`)
One function renders a **different dashboard per role**. Each is a title + subtitle + an optional header action button + a row of KPI cards (`dcard(label, value, meta, color, pct)`) + one panel table (`panelTable(heads[], rowsHtml)`). Every card is `{ .k label, .v value, .meta caption, .bar fill at pct% in color }`.

**RM dashboard** (`currentRole==='RM'`)
- **Header action:** `+ Add Lead` → `openLead(null)` (opens the new-lead drawer, S-04).
- **KPI cards** (data from `counts()` over `mine(active())`, and `mine(DB.clients)`):

| Card | Value | Source / formula | Bar |
|---|---|---|---|
| Active leads | `c.total` | count of this RM's active (non-out) leads | teal, 100% |
| Hot leads | `c.hot` | leads with `status==='Hot'` | `--hot`, `hot/total*100` |
| Onboarding + | `c.L3 + c.L4` | leads at stage L3 or L4 | green, `(L3+L4)/total*100` |
| Follow-ups due | `due.length` | this RM's leads where `follow` date (midnight) ≤ today | warm, 0 |
| Reviews due this week | `revDue` | this RM's **funded** clients where `weekDue(ips.nextAnnualReview)` OR `weekDue(ips.nextQuarterlyReview)` | `#5b3aa8`, 0 |

- **Panel table — "Follow-ups due today & overdue"** with link `View all leads →` → `go('leads')`. Columns: **Lead, RM, Stage, Status, Interaction, Follow-up**. Row = `due` lead → name / `l.rm` / `STAGE_LABEL[l.stage]` chip / `statusPill(l.status)` / `l.type` / `fmtDate(l.follow)`; row click `openLead(l.id)`. Empty: `🎉 No follow-ups due.`

**Qualifier dashboard** — cards: Awaiting qualification (`DB.leads.filter(appUser && !qualified).length`), Recovery (abandoned) (subset with `abandoned`), Meetings today (`DB.meetings` same-day, not Done), **RMs available = `5` [WIREFRAME hard-coded]**. Panel "Leads awaiting assignment" → `Open queue →` `go('assignment')`; columns **Lead, Source, Flow, Recommended RM, (action)**; action `Qualify & assign` → `openAsgn(id)`; `recovery` chip if `abandoned`. Empty: `Queue is clear.`

**Compliance (RIA) dashboard** — over `riaClients()`: Pending verification (`compliance.status==='Pending'`), Flagged (`'Flagged'`), Verified (`'Verified'`), Open tasks (`teamTasks('Compliance')` not Done). Panel "Clients needing verification" (`[...flagged,...pending]`): columns **Client, Client ID, PAN, Status**; row → `go('verification')`. Empty: `All clients verified.`

**Operations dashboard** — over `teamTasks('Operations')`: Open / In progress (`'In Progress'`) / Blocked / Completed (`'Done'`). Panel "My operations queue" → `go('tasks')`; columns **Priority, Task, Client, From, Due, Status**. Empty: `No open operations tasks.`

**Investment dashboard** — Portfolios (`funded.length`), AUM (`Σ funded.portfolio.current`, `fmtINR`), Reviews due this week (annual/quarterly `weekDue`), Open tasks (`teamTasks('Investment')`). Panel "Reviews due this week": **Client, Risk band, Annual review, Quarterly review** (`fmtDue`). Empty: `No reviews due.`

**Distributor dashboard** — see S-26 (4.7).

- **Edge cases.** Empty book → all KPI values render `0`; each panel shows its empty row. **[WIREFRAME]** "RMs available = 5" is hard-coded; production must compute available capacity. **[PM INPUT]** define "follow-up due" precisely (the wireframe uses date ≤ today at local midnight) and "reviews due this week" (`weekDue` = within 7 days; confirm calendar-week vs rolling-7-days).

#### S-03 — Leads (`renderLeads`)
- **Purpose.** Work the active B2C pipeline.
- **Scope.** `mine(active())` then **exclude unqualified app leads** (`!(l.appUser && !l.qualified)` — those live in the Assignment Queue until qualified).
- **Filters (client-side, AND-combined):** search box (matches `name + rm + comments`, case-insensitive); Stage (`l.stage`); Status (`l.status`); Source (`l.source`).
- **Table columns & sources:**

| Column | Source / derivation |
|---|---|
| Lead | `l.name` + 2nd line = first 42 chars of `l.comments` (ellipsised) |
| Source | `l.source` |
| Status | `statusPill(l.status)` (colour pill) |
| Stage | `STAGE_LABEL[l.stage]` chip, class `stage-${l.stage}` |
| RM | `l.rm` |
| Type | `l.type` (last interaction type) |
| Count | `l.count` (interaction count) |
| Strikes | `strikeMini(l)` — see business logic |
| Follow-up | `fmtDate(l.follow)` |

- **Row click** → `openLead(l.id)` (S-04). **Empty:** `No leads match your filters.`
- **Five-strike visual (`strikeMini`).** For `stage!=='L1'` → `n/a`. For L1 → five `.strike` icons; icon `i` is `on` if `i ≤ count` (and `max` styling if `count ≥ 5`); if `count ≥ 5` append a `OUT?` warning tag.

#### S-04 — Lead Detail (drawer) (`openLead`/`saveLead` and helpers)
- **Purpose.** Create or edit a lead; log interactions; drive stage/status; trigger onboarding or the Out List.
- **Open.** `openLead(id)` deep-copies the lead into `editing` (or builds a new-lead template `{id:null, source:'Referral', status:'New', stage:'L1', rm:RMS[0], type:'Call', count:0, hist:[], out:false}`). Header title = name (or "New Lead"); subtitle = `source · rm`. **Delete** button hidden for new leads; **Start onboarding** button visible only when `currentRole==='RM' && !isNew && !editing.out`.
- **Fields (all editable; `pull()` syncs DOM→`editing`):** Name (`#fName`, required), Source, Status, Stage, RM (from `RMS`), Type, Comments, Follow-up date.
- **Interaction panel:** count display (`#iCount`); a 5-dot strike track; quick-log buttons.
- **Actions & state effects:**

| Control | Effect |
|---|---|
| Quick-log **Call / Email / Meeting / WhatsApp** (`logInteraction(type)`) | `editing.count++`; set `editing.type`; push `{type, when: today}` to `editing.hist`; clear `_dismissed`; refresh strikes & history; toast `"<type> logged · count = <n>"` |
| **Save** (`saveLead`) | validate name non-empty (else toast `Lead name is required`); `pull()`; if `status==='Not Interested'` auto-set `out=true, outReason='Not Interested'`; `commit()` (insert with `id=DB.nextId++` or replace); `save()`; close; re-render current view; toast `Lead saved` |
| **Start onboarding** (`startOnboarding`) | opens the mobile-prompt modal (S-08 entry) |
| **Move to Out** (`moveToOut`) | requires saved lead (else toast `Save the lead first`); `pull()`; set `out=true, outReason='Five-Strike Rule'`; `commit()`; go to Out List; toast `Moved to Out list (Five-Strike Rule)` |
| **Delete** (`deleteLead`) | confirm `Delete this lead permanently?`; remove from `DB.leads`; toast `Lead deleted` |
| **Dismiss rule** (`dismissRule`) | set `_dismissed=true`; if status was `Cold`/`New` → `Potential`; toast `Kept in pipeline — marked Potential` |

- **Business logic — five-strike alert.** Shown only when `stage==='L1' && count ≥ 5 && !_dismissed`. `stageHelp()` shows stage-specific copy (L1 explains five-strike; L2 Hot/Holding; L3 Onboarding; L4 Pre-Investment). History (`renderHist`) lists `editing.hist` newest-first.
- **Edge cases.** A logged interaction clears the dismiss flag, so the alert can re-appear at the next strike. Setting status to `Not Interested` removes the lead from the active pipeline immediately on save.
- **[PM INPUT].** Confirm: is five strikes a hard cap or advisory? Should logging be tied to real channels (call system / WhatsApp Business / email) so `count` is system-derived rather than a manual click? Who may delete a lead (today: any RM)?

#### S-20 — Out List (`renderOut`)
- **Scope.** `mine(DB.leads).filter(l => l.out)`.
- **Columns:** Lead, Source, RM, Count, **Reason** (`l.outReason || 'Five-Strike Rule'`), **Last date** (last `hist[].when`), **Action**.
- **Action — Restore** (`restore(id)`): set `out=false, outReason=''`; if `status==='Not Interested'` → `Cold`; toast `Lead restored to pipeline`.
- **Empty:** `No leads in the Out list.`

---

### 4.2 · Lead Desk (Qualifier)

#### S-05 — Assignment Queue (`renderAssignment`)
- **Purpose.** Route app sign-ups (`appUser && !qualified`) to the best-fit RM and book the intro call.
- **Columns:** **Lead** (`name` + `recovery` badge if `abandoned`, plus `comments`), **Contact** (`📞 phone · ✉ email`), **Source** (chip), **Flow** (`flowChip(flow)` → "Self-serve" / "RM-assisted"), **Recommended RM** (`rec` + `recReason`), **Onboarding stage** (`ONB_STEPS[onbStep]`), **Action** (`Qualify & assign` → `openAsgn(id)`). Empty: `No leads awaiting assignment.`

#### S-06 — Qualify & Assign (modal) (`openAsgn`/`confirmAssign`)
- **Modal contents.** Title `name · flowChip`; sub `📞 phone · ✉ email · Source: source`; comments. Form: **RM select** (from `RMS`, pre-selected to `rec`, onChange `asgnPreview()`), **Date** (default tomorrow), **Time** (default `15:00`). Preview shows the best-fit reason (`✓ Best fit — recReason` or `Manual override`), the generated Meet link (`genMeet()`), and the attendee list (Client, selected RM, `Maya Sharma · Qualifier`).
- **Confirm effect** (`confirmAssign`): validate a date is set (else toast `Pick a meeting date`); on the lead set `qualified=true`, `assignedRM=rm`, `rm=rm`, `meetLink=meet`, `onbStep=max(onbStep,3)`, `status='Potential'`, `stage='L2'`; **create a meeting** `{id:DB.nextMtg++, title:'Onboarding call — <name>', rm, when:'<date>T<time>', dur:30, attendees:[Client, RM, Qualifier], meet, status:'Scheduled'}`; `save()`; toast `"<rm> assigned · added to Google Meet invite"`.
- **Edge cases.** Duplicate sign-up (same number) should attach to the existing person — **[PM INPUT]** the wireframe does not auto-merge; define dedup-on-signup behaviour. Self-serve drop-offs (`abandoned`) are flagged `recovery` for prioritisation.
- **[PM INPUT].** The "recommended RM" (`rec`/`recReason`) is **seeded text**, not computed. Define the real best-fit algorithm (language, region, capacity, referrer continuity) — see seed examples (Marathi/Mumbai/retirement; high-intent + capacity; referrer continuity). Confirm the qualifier is always an attendee, and the meeting duration default (30 min).

---

### 4.3 · Onboarding (RM only)

#### S-07 — Onboarding Journey (`renderOnboarding`)
- **Purpose.** Funnel view + a worklist of leads in onboarding.
- **Funnel.** Over `mine(active()).filter(l => l.onbStep !== undefined)`, a bar per `ONB_STEPS` step (`['Captured details','Authenticated','Choosing path','In progress','Advisory routing','Sign agreement','Fund account','Onboarded']`, index 0–7), width ∝ count at that step.
- **Worklist table.** `pop.filter(l => l.onbStep < 7)` sorted by `onbStep` desc. Columns: **Name, Flow, Stage** (`ONB_STEPS[onbStep]`), **RM** (or "unassigned"), **Action**. For an RM: `Accounts · <n>` if forms exist for the number, else `Start onboarding` (→ `startOnboarding(id)`). Non-RM: a read-only count. Empty: `No leads currently in onboarding.`

#### S-08 — Household Hub (`startOnboarding` → mobile prompt → `renderOnbHub`)
- **Entry.** `Start onboarding` opens the **mobile-number-first** prompt. Note text varies: number auto-filled with N existing accounts; auto-filled, no accounts yet; or a cold start explaining "everything links by mobile — one number can hold several accounts (PMS, RIA, International) and family members." `onbMobSubmit()` validates 10 digits (`digits()`, else toast `Enter a valid 10-digit mobile number`), bumps the lead's `onbStep` to ≥3, then opens the hub for that number.
- **Hub.** Subtitle `📲 <mobile> · <holder> · <n> account(s)`. Lists `formsForMobile(mob)` — each as a card with `productTag(product)`, member name, relation (if not Self), form `no`, `status`, and an action `Resume · <pct>%` (if started) or `Open`. Empty: `No accounts yet on this number — add the first one below.`
- **Add account / family member** (`addOnbAccount`): inputs Holder name (pre-filled `ONB_HUB_HOLDER`), Relation (default `Self`), Product. Validates name (else toast `Enter the account holder / member name`); creates a form via `newAccountForm()` with `no:'FORM-'+DB.nextForm++`, `mobile`, `leadId`, `holder` (= name if Self else the household holder), `member`, `relation`, `product`, prefilled `data.personal.fullName`, `data.contact.mobile`, and (for the Self account linked to an app lead) `data.contact.email`; `status:'Not started'`; pushes to `DB.forms`; opens the form; toast `New <product> account created for <name>`.
- **Business logic.** Forms are **keyed by mobile** (`formsForMobile` matches on `digits(mobile)`), so a self-serve start, another RM's start, and this RM's resume all converge on the same form set. One account per product per person is the intended constraint (see BR in 5.2).
- **[PM INPUT].** The hub assumes **one account per product per person**; confirm whether a person may hold two of the same product. Confirm the product picklist exactly (`PMS Lite (RIA)`, `PMS`, `International investing`) and the relation picklist.

#### S-09 — Onboarding Form (`renderOnbForm` / `saveOnbForm` / `sendEsign` / `markSigned`)
- **Purpose.** Capture everything needed to open and fund an account, then e-sign the agreement.
- **Header.** Form `no`; sub `📲 mobile · <member> · <relation> · <product> · status: <status>`; a resume banner if `_resumed`.
- **Sections & fields** (the `ONB_FORM` definition — every field listed):

| # | Section (`key`) | Fields (`key`: type — options) |
|---|---|---|
| 1 | Personal (`personal`) | fullName (text), dob (date), gender (select: Male/Female/Other), pan (text), aadhaar (text, last 4), nationality (text) |
| 2 | Contact & address (`contact`) | mobile (read-only, linked), email, addr (textarea, full-width), city, state, pin |
| 3 | Financial profile (`financial`) | occupation (select: Salaried/Self-employed/Professional/Retired/Other), income (select bands <10L…>1Cr), networth (select bands <50L…>5Cr), sourceFunds (select: Salary/Business/Investments/Inheritance/Other) |
| 4 | Investment objective (`objective`) | goal (select: Wealth creation/Retirement/Income generation/Child education/Capital preservation), horizon (select <3yrs…>10yrs), initial (₹ amount), sip (monthly ₹) |
| 5 | Advisory routing — product fit (`route`) | product (select: PMS Lite (RIA)/PMS/International investing, full-width), rationale (textarea, full-width) |
| 6 | Risk profile (`risk`) | q1 (Sell all/Sell some/Hold/Buy more), q2 (None/Some/Experienced/Professional), q3 (Low/Moderate/High/Very high), band (Conservative/Moderate/Aggressive) |
| 7 | Bank & demat (`bank`) | bank (name), acct (number), ifsc, demat (select: Zerodha—to open/Zerodha—active/Other broker/None yet) |
| 8 | Nominee (`nominee`) | nomName, nomRel (Spouse/Parent/Child/Sibling/Other), nomShare (%) |
| 9 | Declarations & FATCA (`decl`) | pep (No/Yes), taxres (Yes/No), consent (checkboxes, full-width: Terms & conditions / Privacy policy / Risk disclosure / Fee schedule) |

- **Field persistence.** `onbSet(sec, key, value)` writes to `CURRENT_FORM.data[sec][key]`; `onbToggle(...)` maintains checkbox arrays. Each change calls `updateProg()`.
- **Progress (`formProgress`).** `round(filled / total * 100)` over all fields across all sections; a field counts as filled if a non-empty string/value, or (for checkbox arrays) length > 0. A section shows `✓ complete` when `secDone()` (all its fields filled).
- **E-sign gate (Section 10 of the form).** Below 85% → message `Finish the form first — <pct>% complete, need 85%+ to send`, send button disabled. At ≥85% → enabled. **Send e-sign** (`sendEsign`): set form `status='E-sign sent'`, `esign={sentTo:<email>, when:today, status:'Sent'}` (email from `data.contact.email`, else lead email, else `client@email.com`); if linked to a lead, bump it to `onbStep≥5, stage='L3', status='Onboarding'`; toast `✍️ E-sign request for the agreement sent to <email>`. **Mark as signed (demo)** (`markSigned`): `status='Signed'`, `esign.status='Signed'`; lead → `onbStep≥6, stage='L4'`; toast `Agreement signed — client ready to fund & invest`.
- **Save** (`saveOnbForm`): set `lastSaved`; if `Not started` and progress>0 → `In progress`; toast `Saved <no> · <pct>% complete`.
- **Edge cases.** A drop-off resumes the same form (`_resumed` banner). An e-sign-sent-but-unsigned form sits at `status='E-sign sent'` — **[PM INPUT]** define the reminder cadence and the RM task that should be auto-raised if it stays unsigned.
- **[PM INPUT — large].** (1) The form fields above are the wireframe's; confirm the **authoritative onboarding field list** against the RIA App spec and SEBI/KYC requirements. (2) Which fields are **mandatory** vs optional, and is the 85% gate the right rule, or should specific mandatory fields gate e-sign instead of a percentage? (3) **Lead→client conversion:** today a signed form does **not** auto-create a `clients[]` account (accounts are seeded) — define whether signing creates the account, who assigns `cid`, and how `product`/`strategies`/`distributor`/`segment` are set. (4) DIGIO field mapping for the agreement (INT-1). (5) Where the form data ultimately lands (the client record, the KYC file, the custodian).

---

### 4.4 · Clients & Profiles

#### S-10 — Clients (`renderClients`)
- **Purpose.** The account register — **one row per account**, grouped by household.
- **Scope.** `mine(DB.clients)` (RM = own; Distributor = own; others = all). Sorted by composite key `contact | holder | product` (so a household's accounts cluster).
- **Filters:** search (matches `cid + first + last + contact + rm + holder`); Plan (`c.plan`); Stage (`currentStageName(c)`); Product (`c.product`).
- **Columns & sources:**

| Column | Source / derivation |
|---|---|
| CID | `c.cid` (link → `openClient(cid)`) |
| Name | `c.first c.last`; `relation` chip if `relation!=='Self'`; 2nd line = `source · country`, or `↳ linked to <holder>` for family members |
| Contact | `c.contact` (link → `openClient`) |
| RM | `c.rm` |
| Product | `productTag(c.product)` |
| Plan | `c.plan` (Monthly/Quarterly/Yearly) |
| Stage | `stageBadge(c)` / `currentStageName(c)` |
| Invested | `fmtINR(c.portfolio.invested)` |
| Current Value | `fmtINR(c.portfolio.current)` |
| Gain | `current − invested`; green if >0, `--hot` if <0, muted if 0 |
| Quick View | `clientQuick(cid)` dropdown (holdings, CAGR, invested/current) |

- **Empty:** `No clients match your filters.`
- **[PM INPUT].** `currentStageName`/`stageBadge` map the account to an L1–L4-style stage; confirm the canonical account lifecycle states for production and how they derive from real data (funded? agreement signed? KYC complete?).

#### S-11 — Account Detail (`renderProfile`)
- **Entry.** `openClient(cid)` sets `CURRENT` and navigates to the account page.
- **Header.** Avatar (initials); `first last`; sub line: for a family member `🔗 linked to <holder> <relation chip> ·` then always `productTag · cid · contact · RM: <rm>`. A **stepper** (`stagesOf(c)`) shows lifecycle steps (done/current). A **next-step box** (`nextStepText(c)`) shows the recommended next action.
- **Tabs (the live tab bar — 7).** Overview · Investment & SIP · **Risk Profile & Agreement** · Portfolio · Reports · Invoices · Call Sync.
- **Removed tabs (per DECISIONS.md) — orphaned code, do not build.** The source still *fills* a `#tab-strategies` pane (`addStrat`/`removeStrat`) and a `#tab-kyc` pane (`saveKyc`), but **neither has a tab-bar button, so neither is reachable**. They are remnants of an earlier model and contradict two ratified decisions: **strategy is backend-assigned and read-only in the CRM**, and **KYC editing belongs to RIA Compliance (S-30), not the RM's account page**. Production must omit both; the wireframe code should delete the dead panes/functions (see the dead-code list at the end of this screen). The Overview tab's *read-only* "Recommended Strategies" line stays.

**Overview tab** — two columns.
- *Client Information* (read-only, badge `⟳ FBC-Admin` = synced from admin): Date of sign-up (`fmtD(c.signup)`), First/Last name, DOB (`c.kyc.dob`), Profession (`c.kyc.profession`), Contact, WhatsApp (`c.contact` "(same as contact)" if `sameWa`, else `c.whatsapp`), Email, Country, Postal, Source, Zerodha (`yn(c.zerodha)`).
- *Account & Engagement*: **RM** (editable select from `RMS` → `editClient('rm',v)` → toast `RM updated`), **Billing Cycle** (editable select Monthly/Quarterly/Yearly → `editClient('plan',v)` → toast `Billing cycle updated`), Questionnaire (Done/Pending badge from `c.questionnaire`), Agreement (Signed if `agreement==='Done' && signed`, else Pending), Recommended Strategies (`c.strategies` chips), Investment Goal (`c.goal`), SIP (`c.sip`).

**Investment & SIP tab** — Goal/Plan/Strategies (joined); SIP details from `c.sipDetails` (investment, frequency, start, `fmtINR(amount)`) or empty state `No SIP configured for this client.`

**Portfolio tab** — if `c.portfolio.suspense.length`, a `⚠ Reconciliation Suspense Holdings` alert listing each `name — fmtINR(amt) · reason`, with **💬 Send repair notification** (toast `Repair notification sent to <contact> on WhatsApp`). Metric cards: Investment Amount, Current Value, **Gain** (signed, pos/neg colour), Absolute Return (`c.portfolio.absReturn`%), IRR (`c.portfolio.irr`%). Holdings table from `c.portfolio.holdings` (`[name, invested, current]`), Gain per row signed/coloured. Empty holdings: `No holdings yet — client not funded.`

**Risk Profile & Agreement tab** (`tab-docs`) — three rows: **Risk Profile Questionnaire** (status `c.questionnaire`, ⬇ Download = toast), **Client Agreement** (if `signed`: ⬇ Download signed; always ✉ Send for signing → `emailAgreement(cid)`), **Subscription Invoice — latest** (`c.invoices[last].desc`, View invoices → switches to Invoices tab).

**Call Sync tab** — synced follow-ups from `c.calls` (`fmtDT(when)`, note, `⟳ <source>`). Empty: `No follow-ups scheduled.` **+ Schedule follow-up** → toast only [WIREFRAME].

**Reports tab** (`acctReportsHtml`) — five downloadable report cards: Holding statement, Tax report — capital gains, Strategy performance report, Fund inflows & outflows, Basic information report. Each **Download** → `downloadReport(name, who)` where `who = first last cid`.

**Invoices tab** — table Date/Description/Amount/Status/(download) from `c.invoices`; **⬇ Download all (CSV)** → `dlClientInvoicesCsv(cid)`; per-row **⬇ Download** → `dlInvoice(...)` (generates a text invoice with 18% GST split — see S-29). Empty: `No invoices generated yet.`

- **Business logic.** The live edit affordance is `editClient(field,val)` (RM + Billing Cycle on the Overview tab), which mutates `CURRENT`, calls `persistClient()` (replace by `cid` in `DB.clients`), `save()`, re-renders, and toasts. (`addStrat`/`removeStrat`/`saveKyc` exist in source but feed only the unreachable panes above — treat as dead.) <1yr accounts: see CAGR rule (5.4).
- **Dead code to delete (wireframe hygiene; aligns code with DECISIONS.md).** Unreachable from the UI and safe to remove: the `#tab-strategies` and `#tab-kyc` pane-fill blocks in `paintTabs()`; helpers `addStrat`, `removeStrat`, `saveKyc`, `kin`; `revokeDemat` (no caller; demat is non-revocable); `cmpItem` and the `c.uploaded` backfill (no caller; the CRM-vs-uploaded-doc match model was retired in favour of DIGIO e-KYC). The seeded "DOB mismatch" task/thread (`FBC-1003`) is illustrative narrative, not the retired match feature, and can stay.
- **[PM INPUT].** (1) Which roles may edit which fields (RM editing KYC? Compliance only?). (2) The five report types in the Reports tab are placeholders generating client-side downloads — define the real report definitions and the generator (INT-5/INT-6). (3) "FBC-Admin sync" implies an upstream admin system — name it and define the field set it owns vs the CRM owns.

#### S-12 — Profiles Directory (`renderProfiles` / `buildProfiles`)
- **Purpose.** One searchable directory of **every person** — leads and clients unified.
- **`buildProfiles()` rollup.** Group `clients[]` by `digits(contact)` (10-digit key; fallback `'cid'+cid`); the `relation==='Self'` account is canonical for the person's name/email/dob/rm. Then fold in `leads[]` (excluding `out`), matching by phone digits then by name; unmatched leads become standalone "Lead" persons. Each person: `{pid:('n'+key|'l'+id), kind:'Client'|'Lead', name, phone, email, rm, dob, source, accounts[], leads[]}`.
- **Scope.** `profilesScope()` (RM sees own).
- **Columns:** Name + email; Kind badge (Client/Lead); Phone; RM (or "unassigned"); Account count (`<n> account(s)` or "— prospect"). Search matches `name + phone + email`; Kind filter. Row → `openProfile(pid)`. Empty: `No profiles match.`

#### S-13 — Person Profile (`renderProfilePage` + tabs)
- **Header.** Avatar initial; name; sub badge (Client / Lead·Prospect) + phone + email. Meta: DOB (`fmtD`), RM, Source, Accounts (count).
- **Tabs:** Accounts · Communication · Timeline · Notes · Tags.

**Accounts tab** (`renderPfAccounts`) — one collapsible card per account: header = `productTag · first last · cid (· relation) · fmtINR(current) ▾`. Body: metrics (invested, current, **CAGR since inception** `cagr(c)`, abs return); a portfolio performance SVG (`portfolioGraph(c)`); strategy performance rows (`irr + i*1.4`% per strategy — [WIREFRAME synthetic]); holdings; footer rebalance dates (RIA shows "rebalance proposal sent / last rebalanced by client"; PMS shows "last rebalanced"); **Open account →** `openClient(cid)`. Empty: prospect/not-onboarded message.

**Communication tab** (`renderPfComm`) — preferences stored on the primary account/lead `commPref` (default `{channels:['Email','WhatsApp'], freq:'Monthly', lang:'English', time:'Morning', dnd:false}`): Preferred channels (checkboxes Email/WhatsApp/SMS/Phone call → `commToggle`), Frequency (Weekly/Monthly/Quarterly/On key events only), Language (English/Hindi/Marathi/Gujarati/Tamil), Time of day (Morning/Afternoon/Evening), Do not disturb (No/Yes). Each change → toast `Communication preference saved`.

**Timeline tab** (`renderPfTimeline`) — merged, newest-first: lead outreaches (from `leads[].hist`), account lifecycle (signup → "Onboarded"; funded → "Funded & executed"; rebalanced from `ips.lastQuarterlyReview`), and call logs (`accounts[].calls`). Empty: `No timeline events yet.`

**Notes tab** (`renderPfNotes`) — a free-text `profileNotes` on the primary account/lead; **Save notes** (`savePfNotes`) → toast `Notes saved`.

**Tags tab** (`renderPfTags`) — current tags (`personTags(p)`) each removable (`pfRemoveTag`); **add existing** from `DB.tags` (`pfAddSelectedTag`); **create new** (`pfCreateTag` → toast `Tag created: <t>`); **✨ AI-suggested** tags (`suggestTags(p)` — [WIREFRAME keyword inference from notes/transcripts]) one-click accept (`pfAcceptTag` → toast `Tag added: <t>`); and **📨 Content auto-shared** list = articles whose tags intersect this person's tags (with dates). Empty tags: prompt to add or accept a suggestion.
- **Business logic — tags & content routing.** A client receives an article iff `article.tags ∩ client.tags ≠ ∅`. `articleReach(a)` counts unique recipients deduped by `digits(contact)||cid`.
- **[PM INPUT].** Define the real AI tag-suggestion source (notes? meeting transcripts? which transcription provider?) and whether suggestions require RM confirmation (today: yes). Confirm the preset tag vocabulary and whether tags are PII-sensitive (they describe client circumstances).

---

### 4.5 · Operating tools

#### S-17 — Tasks & Requests (`renderTasks` / `renderBoard` / `renderTaskList` / `openTask` / `saveTask`)
- **Purpose.** A cross-team ticket system with handoffs and an audit thread.
- **Views.** Board (Kanban, 4 columns **Open / In Progress / Blocked / Done**) or list; title is "Tasks & Requests" for RM, else `<role> — Inbox`.
- **Task fields.** `id, title, team, type, cid, from ("Name · ROLE"), priority (High/Medium/Low), status, due, assignee ('' = whole team), notes, thread[], created`. A `thread` entry = `{by, text, when, sys}` (sys = system line).
- **Option lists.** `team` ∈ keys of `TEAM_MEMBERS`; `type` ∈ `TASK_TYPES[team]` (Compliance: KYC document verification / PAN–Name mismatch review / Re-KYC / AML screening / PEP review; Operations: Open bank account / Demat / Zerodha activation / Cheque collection / Address change / Resolve login issue / Statement request; Investment: Portfolio review / Rebalance portfolio / IPS review / Strategy change / Suspense reconciliation; RM: Schedule meeting / Quarterly review / Yearly review / Follow up / Collect document); `assignee` ∈ `TEAM_MEMBERS[team]` or unassigned.
- **Create/edit modal fields.** Title (required), Team (drives Type & Assignee lists), Type, Client (from `clients[]`), Priority, Due, Notes, Assignee, **Reassignment reason** (`#tmReason`, shown only when team or assignee changed on an existing task).
- **Actions & state:**

| Control | Effect |
|---|---|
| **New request** | `openTask(null)` → blank modal (defaults: team=currentRole, status=Open, priority=Medium, from=me) |
| **Save** (`saveTask`) | validate title; if reassigned, require reason (else toast `Add a reason for the reassignment`) and log a `sys` line `Reassigned <from> → <to> — <reason>`; insert/update; toast `Request raised → <team>` / `Reassigned & saved` / `Task saved` |
| **Status dropdown** (`setTaskStatus`) | change `status`; log sys line `Status → <s>`; toast `Status → <s>` |
| **Drag card** (`moveTask`) | set `status` to the column; log sys line; toast `Moved → <s>` |
| **Add comment** (`addComment`) | append a thread line; toast `Comment posted` |

- **Thread (`renderThread`).** Shows the originating "raised this" line (from `created`/`from`/`notes`) then every thread entry, sys lines styled distinctly.
- **Business logic — BR-TASK-1.** Reassigning a task (team or assignee) **requires a reason**, recorded immutably in the thread. **[PM INPUT]** confirm this is an audit acknowledgement, not a hard block (today it blocks save until a reason is entered).
- **Empty:** `No tasks in this view.` / per-column `Drop a ticket here`.

#### S-14 — Calendar (`renderCalendar`) & S-15 — Schedule (`openMtg`/`sendMtg`)
- **Scope.** `myMeetings()` (RM = own; Distributor = own + meetings with their clients; else all). Title: "My Calendar — <name>" / "Team Calendar".
- **Rendering.** Meetings grouped by day (`toDateString`), labelled Today / Tomorrow / weekday+date. Each meeting: time (`HH:MM`) + duration + status badge; title (+ `⚠ overlaps` if conflicting); `RM: <rm> · ends HH:MM`; attendee chips (`<n> · <role>`, RM highlighted); a **🎥 Join <meet>** link if not Done; for an overlap, **📞 Call client & reschedule** (`reschedule(id)` → moves to next day; toast `Client called — meeting moved to next day, Google Calendar updated`).
- **Conflict detection (`calcConflicts`).** Time-overlap among non-Done meetings; the day header shows `<n> conflict(s)`.
- **Schedule modal.** Fields: Title (required), Date (default tomorrow), Time (default 11:00), Duration (default 45), Type (Google Meet video vs phone call), With (a person from attendees/team), Team checkboxes (colleagues), plus a live preview of the Meet link (or "📞 Phone call — no video link") and attendee list. **Save** (`sendMtg`): build the meeting, `DB.nextMtg++`, push, `save()`, go to calendar; toast `📅 Meeting scheduled · Google Meet link created · invite emailed via Google Calendar` (video) or `📞 Call scheduled · reminder added to your calendar`.
- **10-minute pre-call reminder (`checkCallReminders`/`showCallAlert`).** A timer scans in-scope, non-Done meetings; when `0 < minutes-until-start ≤ 10` and not already alerted, a pop-up appears: `🔔 Upcoming call · in <m> min · <title> · <time>` with **🎥 Join**, **Snooze 5m** (`snoozeAlert`), and dismiss (`dismissAlert`). Each meeting alerts once (`_alerted[id]`); snooze re-arms after 5 min.
- **[PM INPUT].** Google Calendar/Meet integration (INT-7): real invite creation, attendee emails, timezone handling, and whether reschedule should propose slots rather than blindly +1 day. The 10-min reminder is a client-side timer in the wireframe; production needs server-side notifications across channels (NFR 8.5).

#### S-16 — Reviews & Reminders (`renderReminders`)
- **Purpose.** Surface reviews due this week and let the RM act.
- **Scope.** `mine(DB.clients).filter(c => c.funded)`.
- **Due logic.** Annual = `weekDue(c.ips.nextAnnualReview)`; Quarterly = `weekDue(c.ips.nextQuarterlyReview)` (`weekDue` = date within 7 days). Banner summarises counts. Rows show client (→ profile), RM, last reviewed, status ("overdue" / "this week") + due date, and actions:

| Action | Effect |
|---|---|
| **Schedule call** (`scheduleReviewCall`) | create a review meeting (3 days out, 15:00, 45 min, attendees Client/RM/Anjali Rao), append a call log; toast `Review call scheduled · Google Meet invite sent` |
| **Reminder** (`emailReview`) | open the composer pre-filled (annual vs quarterly subject/body, from `emailOf(rm)`, to `c.email`) |
| **IPS Doc** (`openIpsDoc`) | render the Investment Policy Statement modal (see below) |
| **Mark done** (`markReviewed`) | set last review = today, next = +1y (annual) / +91d (quarterly); toast `<type> review marked done · next scheduled` |

- **IPS document modal** — Investor Profile (name, `age(dob)`, profession, risk band, horizon, plan), Objective (goal→description), Target Asset Allocation (equity `targetEquity`, debt `max(0,95−eq)`, cash remainder), Recommended Strategies, blended Benchmark, Constraints & Liquidity (no leverage, liquidity reserve, PEP flag), Review Schedule (next/last annual & quarterly), signature block. **Email IPS** (`emailIps`).
- **Business logic — annual risk refresh.** Annual risk refresh is 12-monthly; **no client response within 14 days → flag the RM**. **[PM INPUT]** the 14-day flag is specified but the wireframe does not implement the auto-flag timer — define the trigger, the channel, and the resulting task/alert.
- **Empty:** `No reviews due this week — you're all caught up.`

#### S-18 — Inbox (`renderInbox`)
- **Scope.** Per-user via `myEmail()`. **Inbox tab** = emails where `emailMatch(e.to, myEmail())`; **Sent tab** = `e.from === myEmail()`.
- **List.** Newest-first; unread styling in the Inbox tab (`!e.read`); each row shows From/To + datetime, subject (or "(no subject)"), and a 110-char snippet. Empty: `Inbox zero 🎉` / `No sent mail.` An **unread badge** appears on the nav (`badges()` counts unread inbox matches).
- **Compose/reply.** `openEmail({from,to,subject,body})`; **Reply** (`replyMail`) pre-fills to=sender, subject "Re: …", body with a quoted block. **Send** (`sendEmail`): push `{id:DB.nextEmail++, from, to, subject, body, date:now, read:true}`; toast `Email sent from <from>`.
- **CRM-sent items land here.** Reports (S-19), IPS sends, agreement sends, and custodian reports all create `emails[]` rows addressed to the client, so they appear in Sent and (for client-addressed mail) would appear in the client's inbox in a multi-user build.
- **[PM INPUT].** Real mailbox integration (INT-8: Gmail/ESP) — send/receive, threading, attachments (reports/invoices/agreements are referenced but not attached in the wireframe), and how inbound client replies are captured against the client record.

---

### 4.6 · Reporting & Compliance

#### S-19 — Client Reports (`renderReports` / `renderReportsModal` / `sendReport`)
- **Purpose.** Per client, view and send the Monthly, Half-yearly and Tax reports, with delivery tracking.
- **Scope.** `mine(DB.clients)`.
- **List.** Columns: Client (name + cid), Last sent — Monthly / Half-yearly / Tax (`c.reports[type].lastSent` or "never"), action **View & send** (`openReports(cid)`).
- **Modal — three cards** (monthly / halfyearly / tax). Each card: a description line, **👁 View** (toggles inline content via `reportContent(c,type)`), **✉ Send** (`sendReport(type)`), "Last sent" date, and the last 4 receipts.
  - *Monthly content:* current valuation / invested / P&L (signed, coloured); holdings summary; this-month trades (sample BUY/SELL); advisor commentary (`rpCommentary` from `absReturn`: ≥10% "Strong", ≥0% "Steady", <0% "Soft"); **fee invoice attachment** = `fmtINR(round(current*0.0025))` (0.25% of current value [WIREFRAME assumption]).
  - *Half-yearly content:* as monthly, "half-year trades".
  - *Tax content:* FY (`taxFY()`), STCG / LTCG / dividend income (computed as fixed fractions of `current` [WIREFRAME]), "ITR-ready · Schedule CG + Schedule OS".
- **Send effect (`sendReport`).** Set `c.reports[type] = {lastSent: today, receipts:[{Delivered},{Opened}, (+{Acknowledged} for tax)]}`; create an `emails[]` row from `ROLES[currentRole].email` to `c.email` (subject per type; monthly body notes the fee invoice); `save()`; toast `<Title> sent · delivery & open receipts logged`.
- **Business logic — dispatch schedule (5.8).** Monthly by the 1st of the following month; Half-yearly end-Sep & end-Mar; Tax in April for the prior FY.
- **[PM INPUT — important].** (1) The 0.25% fee and the STCG/LTCG/dividend fractions are **placeholders**; real figures must come from the custodian/admin/fee engine. (2) **Dispatch model:** auto-send on schedule vs **maker-checker** approval before sending — the wireframe sends on a manual click and synthesises Delivered/Opened/Acknowledged receipts; define the real model and the tracking provider (INT-6). (3) Report templates/branding and whether the actual PDF is attached.

#### S-30 — RIA Compliance · KYC File (`renderVerification`)
- **Purpose.** Per-RIA-client compliance file with a checklist and RM escalation.
- **Scope.** `riaClients()` only. (RIA-Compliance cannot open PMS clients; 7.1.)
- **Per-client header.** Name + cid; **status badge** (`c.compliance.status` ∈ Verified/Flagged/Pending); **⚠ Raise to RM** and **Mark verified** buttons.
- **Sections & items** (each item green ✓ / amber ! computed from the record):

| Section | Items (source → green rule) |
|---|---|
| Account-opening form | Full name, Email, Mobile, Residential address (display only, from `c`/`c.kyc`) |
| KYC — DIGIO (no uploads) | PAN & identity (`c.kyc.pan`+`namePan`, always green) · Aadhaar e-KYC (always green) · DOB verified (`fmtD(dob)`, green) · CKYC registered (`c.kyc.ckyc`; amber if `/pending/i`) · KRA verified (green iff `c.kyc.kra==='Verified'`) |
| Agreement, disclosure & risk | Disclosure accepted (`!!c.disclosure`) · Risk profile (`c.riskProfile.category` + "communicated" iff `riskProfile.communicated`) · Client Agreement (Signed + **📄 Open signed PDF** `c.agreementUrl` if `c.signed`, else "Pending signature") · Welcome kit (`!!c.welcomeKit`) |
| Suitability & demat | Suitability/IPS (Prepared + link `c.suitability.doc` + sent date, or "Pending — advisor to prepare IPS"; **✉ Send to client** = `sendIPS`) · Demat access (Active "Read-only · <broker> · a/c <masked> · granted <date>" + access log, or "Not granted yet" + **Record client's read-only grant** = `grantDemat`) |

- **Actions & state:**

| Control | Effect |
|---|---|
| **Mark verified** (`setVerdict(cid,'Verified')`) | `c.compliance.status='Verified'`; toast `Marked Verified` |
| **Raise to RM** (`raiseDiscrepancy`) | `c.compliance.status='Flagged'`; create an RM task `Fix KYC discrepancy — <name>` (type "Collect document") with notes; toast `Flagged — raising task to RM` |
| **Send IPS** (`sendIPS`) | init/refresh `c.suitability={doc:'IPS_<cid>.pdf', preparedOn:today, sentOn:today}`; open the email composer pre-filled; toast `IPS sent to client & logged` |
| **Grant demat** (`grantDemat`) | `c.demat={status:'Active', broker:(zerodha==='Yes'?'Zerodha':'Groww'), account:genDemat(cid), accessType:'Read-only', grantedOn:today, log:[…]}`; toast `Read-only demat access granted & logged (<broker>)` |
| **View doc** (`viewDoc`) | toast `Opening <file> (demo upload)` [WIREFRAME] |

- **Business logic.** Demat access is **client-granted, read-only, and not revocable by us**. DIGIO KYC means no manual document uploads for PAN/name/DOB/Aadhaar.
- **[PM INPUT].** DIGIO (INT-1), CKYC (INT-2), KRA (INT-3) real status fields and the exact green/amber/red rules; the legal definition of "complete" for each item; who may Mark Verified.

#### S-31 — Monthly SEBI Report (`renderCompReport`)
- **Purpose.** The monthly SEBI advisory-compliance report across all RIA clients, with per-client drill-down and PDF export.
- **Header.** `Flameback Capital · SEBI Reg. INA000012345 · all active clients · generated <timestamp>` (`SEBI_REG` is [WIREFRAME hard-coded] — **[PM INPUT]** real reg no.).
- **Summary cards.** Active clients (`riaClients().length`), Fully compliant (all items green), Pending items (≥1 amber), Gaps — action needed (≥1 red).
- **SEBI items i–x (`sebiItems(c)`)** — status per client:

| # | Item | green / amber / red rule |
|---|---|---|
| i | Client agreement | green `c.signed` · amber `c.questionnaire` · red else |
| ii | Client disclosure document | green `!!c.disclosure` · amber else |
| iii | Risk profile questionnaire | green `riskProfile.communicated` · amber `!!riskProfile` · red else |
| iv | Boarding letter / welcome kit | green `!!c.welcomeKit` · amber else |
| v | Rationale for investment advice | green `!!c.advice` · amber `!!c.funded` · red else |
| vi | KYC & CKYC documents | green `kra==='Verified' && !/pending/i.test(ckyc)` · amber `/pending/i` · red else |
| vii | Client correspondence | green if any call OR any email to `c.email` · amber else |
| viii | Suitability assessment / financial plan | green `suitability.preparedOn` · amber else |
| ix | Investment advice record | green `tradeLog.length>0` · amber `!!funded` · red else |
| x | Invoice issued | green `invoices.length>0` · amber else |

- **Roll-up (`clientCompliance`).** any red → "gap"; else any amber → "pending"; else "complete".
- **Table.** Client + 10 status dots + **Open** (`openDrill(cid)`).
- **Drill-down modal.** SEBI items grid; **Client identity** (name, email, CKYC #, **PAN masked** `maskPan4`, **Aadhaar masked** `maskAad4`, RM, client-since); **Document links** (signed agreement / risk questionnaire / suitability / financial plan); **Trade & advice audit trail** (`c.tradeLog`: date, advice, approval token, broker order id, confirmation status); **Report dispatch log** (Monthly/Half-yearly/Tax last-sent + receipts); **Correspondence log** (calls + emails, newest-first).
- **Export.** **Export to PDF** (`exportCompReportPdf`) → `window.print()`; toast `Generating PDF — … (use the print dialog → Save as PDF)`.
- **Business logic — masking (NFR 8.4).** PAN/Aadhaar masked in the report; an unmasked view must be logged immutably. **[PM INPUT]** the wireframe masks but does **not** log unmasked views or offer an unmask-with-audit action — define the masking policy per role and the audit-log mechanism.

#### S-32 — Fee Payments (e-NACH) (`renderFeePay`)
- **Purpose.** Advisory-fee auto-debit status per funded RIA client.
- **Scope.** `riaClients().filter(c => c.funded)`.
- **Cards.** Collected (`Σ feeDebit.amount` where Success), Failed (count), On auto-debit (count of funded).
- **Table.** Client, Amount (`fmtINR(feeDebit.amount)`), Debit date, **Status** (Success=Verified badge / Failed=Flagged / else Pending), **Failure reason** (`feeDebit.reason`), Actions (if Failed): **↻ Retry** (`retryDebit` → set Success, clear reason, date=today; toast `Auto-debit retried — cleared`) and **⚠ Raise to RM** (`raiseFeeIssue` → create RM "Follow up" task; toast `Raising fee-failure task to RM`).
- **[WIREFRAME] seed reasons:** e.g. `Insufficient balance in linked bank account`, `e-NACH mandate expired — re-authorisation needed`. **[PM INPUT].** Real e-NACH/PSP integration (INT-9): fee computation source (the wireframe stores `feeDebit.amount` ≈ 0.25% of current value), debit cycle cadence (Monthly/Quarterly/Yearly per `c.plan`?), retry policy, and mandate lifecycle.

#### S-33 — SEBI RIA Daily Report (`renderRiaReport`)
- **Purpose.** The SEBI RIA client register, with a month picker and CSV export.
- **Month picker.** `riaMonth` (type=month), range = last 5 years to current month.
- **Metric cards (for the selected month):** New added (`monthOf(signup)==m`), Exited (`monthOf(exitedOn)==m`), Active (in-books & `funded`), Inactive (in-books & not funded), Total on books (`signup ≤ month-end && (no exit || exit ≥ month-end)`).
- **Register columns:** Start date (`fmtD(signup)`), Client name (+ "exited" badge if `exitedOn`), Contact, Email, Product, Strategy (first of `strategies`), PAN (full), CKYC/KRA proof (`c.ckycLink` ↗), Resident status (`c.residentStatus`), Agreement link (`c.agreementUrl` ↗), City, State (`c.kyc.state`), Country, Gender.
- **Export.** **Export CSV** (`exportRiaReport`) → file `RIA-SEBI-report-<today>.csv` with the 14 headers above; toast `RIA SEBI report exported (<n> clients)`.
- **Business logic — register definitions (5.4).** new/exited keyed to the month; active = funded & not exited; counts taken as of month-end.
- **[PM INPUT].** Confirm the SEBI-mandated column set and definitions; PAN appears **unmasked** in this register — confirm that compliance officers may see it and that the view is audit-logged (8.4).

#### S-34 — PMS Review · FIU / grey list (`renderPmsReview`)
- **Purpose.** The PMS officer's only in-CRM job: FIU AML screening by PAN. (KYC/CKYC/docs are done by the onboarding partner **Silver Bullet, outside the CRM** — a standing banner states this.)
- **Scope.** `pmsClients()`.
- **Cards.** PMS clients, FIU cleared (`pmsCompliance.aml==='Clear'`), Grey-listed (`==='Flagged'`).
- **Table.** Client (+ product badge), PAN, FIU AML (Not screened / **Clear** + date / **Flagged** + date), **Onboarding eligibility** (Flagged → ⛔ "Grey-listed — cannot onboard"; Clear → ✅ "Eligible"; else pending), Action **Run FIU check** / **Re-screen** (`pmsRunAml`).
- **Run-AML effect.** `c.pmsCompliance.amlOn = today`; result = Flagged for `FBC-1004` else Clear [WIREFRAME hard-coded]; toast `⛔ FIU match — <name> grey-listed, cannot onboard` or `FIU AML check (PAN <pan>) → Clear`.
- **Business logic — hard block (5.6).** An FIU match grey-lists the client and **hard-blocks onboarding** until cleared.
- **[PM INPUT].** Real FIU/AML provider and match logic (INT-4); the grey-list clearance workflow (who can clear, what evidence); confirm the Silver Bullet hand-off boundary and how the CRM learns a PMS client's KYC is complete.

#### S-35 — Regulatory Filings (`renderPmsFilings`)
- **Purpose.** Fund-level regulatory filings tracker.
- **Filings (`DB.pmsFilings`, v2 set).** `SEBI — Monthly PMR (Portfolio Manager Report)` (Monthly, source Custodian API, with portal `url` `…doPmr=yes`), `APMI — fund-level submission` (Quarterly, source CRM), `PMSBazaar — fund performance upload` (Monthly, source CRM). Fields: `name, freq, source, due, status, url?, uploadedOn?`.
- **Cards.** Filings tracked, Due this week (`status!=='Uploaded'` & due ≤ +7d), Overdue (due < now), Uploaded.
- **Table.** Filing name (+ `↗ portal` link if `url`), Frequency, Source, **Due** (`fmtDue` — "overdue"/"today"/"tomorrow" styling), **Status** (Uploaded=Verified / Fetched=Pending / Pending=Flagged), **Action**:
  - Pending + Custodian API → **⬇ Fetch from custodian** (`pmsFetch` → status Fetched; toast `Report fetched from custodian (API) into CRM`).
  - Fetched (or CRM-source Pending) → **⬆ Upload** / **⬆ Upload via SEBI portal** (`pmsUpload` → opens `url` if present, status Uploaded, `uploadedOn=today`; toast `<name> — opened SEBI portal & marked uploaded` / `<name> uploaded`).
  - Uploaded → shows `fmtD(uploadedOn)`.
- **[PM INPUT].** Custodian API (INT-5) field mapping for PMR; the SEBI PMR portal (INT-10) submission flow (the wireframe only opens the URL and marks uploaded — there's no confirmation of acceptance); APMI/PMSBazaar formats and credentials.

#### S-36 — Custodian Reports (`renderCustReports` / `renderCustClient`)
- **Purpose.** Per-PMS-client dispatch of the 8 custodian reports with delivery tracking.
- **The 8 report types (`DB.custReports`).** Holding statement (Monthly), Transaction statement (Monthly), Capital gains statement (Quarterly), Corporate actions report (Monthly), NAV / performance report (Monthly), Bank book (Monthly), Securities / demat ledger (Quarterly), Expense & fee statement (Quarterly). Each: `{name, freq, auto, lastRun, tracking:{sent,delivered,seen}|null}`.
- **Scope.** `pmsClients().filter(c => c.funded)`.
- **List.** Cards: PMS clients, Reports sent (`Σ keys(c.reportsSent)` of `clients×types`, with a progress bar), Report types (8). Table: Client, Sent count (`<n>/8`), Last sent date, **Manage & send** (`openCustClient(cid)`). Empty: `No PMS clients.`
- **Per-client modal.** **✉ Send all to client** (`sendAllCust` → sets all 8 `reportsSent[name]={date:today, email:'Delivered'}`; toast `All custodian reports sent to <name>`). Per-report row: name, freq, last sent, **email status** (`emailBadge`: 📤 Pending / ✅ Delivered / 👁 Seen), **Send** (`sendCust(cid,name)` → set `reportsSent[name]`, create an `emails[]` row from `reports@flamebackcapital.com`; toast `<name> sent to <first> · delivery & open tracked`).
- **[PM INPUT].** Custodian source for each report (INT-5); the email tracking provider that distinguishes Delivered vs Seen (INT-6); whether `auto` reports are dispatched on a schedule (the wireframe only sends on click).

---

### 4.7 · Distributor / Wealth Manager portal (external)

Scoped throughout to the partner's own book: `distName()` = `ROLES.Distributor.name`; `distClients()` = `clients[]` where `c.distributor === distName()`. The only conceptual difference from an internal RM is that the RM they contact is **us**.

#### S-26 — Distributor Dashboard (`renderDistDash`)
- Welcome `Welcome, <distName>`; header action **☎️ Contact your RM** (`distEmail()` → composer to the Flameback RM).
- **Cards.** AUM with Flameback (`Σ current`), Total invested (`Σ invested` across `<n>` clients), **Net gain** (`current−invested`, with `ret%` = `(cur−inv)/inv*100`, bar `min(100, ret*4)`), Clients (count). [Also "Reviews due this week" in the RM-style variant.]
- **Panel "Your clients".** Columns Client, City, AUM (current), CAGR (`cagr(c)`), Next review (earliest of next quarterly/annual). Row → `openClient(cid)`. Plus a "Reach out to your Flameback RM" contact card (`distContactCard`). Empty: `No clients yet.`

#### S-27 — Distributor Clients (`renderDistClients`)
- Table: Client ID, Name, City, AUM (current), CAGR, Product (`productTag`). Row → profile. Empty: `No clients yet.`

#### S-28 — Distributor Strategies (`renderDistStrategies`)
- One card per `STRATEGIES` entry: 1Y / 3Y CAGR / Since-inception returns (`stratPerf(name)` — **deterministic hash of the name** [WIREFRAME], so each strategy always shows the same figures) and a footer `<k> of your clients · <AUM> AUM` (clients holding the strategy).
- **[PM INPUT].** Strategy performance must come from the real performance source, not a name hash.

#### S-29 — Distributor Invoices (`renderInvoices`)
- **Data.** Flatten `c.invoices` across `distClients()`, annotated with client name + cid; cached in `window.__inv`.
- **Filters.** Date range `#invRange` (`all` / `y1` ≤366d / `y3` ≤1096d / `thisyear`) and Status `#invStatus` (Paid vs not-Paid).
- **Cards.** Total invoiced (`Σ amount`), Paid (`Σ` Paid, bar = paid/total), Outstanding (`total−paid`).
- **Table.** Date, Client (+cid), Description, Amount, Status (Paid=Verified / else Pending), **⬇ Download** (`downloadInvoice(i)` → `dlInvoice(...)`).
- **Bulk.** **Download all (CSV)** (`downloadAllInvoices` → `invoices.csv`; toast `Downloaded <n> invoices (CSV)`). Empty: `No invoices yet.`
- **Invoice generation (`dlInvoice`).** Builds a text invoice `INV-<cid>-<yyyymmdd>.txt` with a **GST split: `gst = round(amount*0.18/1.18)`, base = amount − gst** [WIREFRAME], hard-coded header `FLAMEBACK CAPITAL PVT LTD · SEBI Reg. INA000012345 · GSTIN 29ABCDE1234F1Z5`; toast `Invoice <ref> downloaded`. **[PM INPUT]** real invoice numbering, GST treatment, the legal entity/GSTIN, and a real PDF.

---

### 4.8 · Marketing

#### S-25 — Content (`renderContent` / `saveArticle` / `viewReach`)
- **Purpose.** Tag articles; each article auto-delivers to clients whose tags intersect.
- **Article fields.** `{id, title, summary, tags[], date}`.
- **Table.** Title, Tags (joined), Date, **Reach** (`articleReach(a)` = unique clients with intersecting tags, deduped by `digits(contact)||cid`), Actions **Edit** (`openArticle`) / **Who** (`viewReach` → toast lists matching client names or `no matching clients yet`). Empty: `No articles yet — add one and tag it; it auto-delivers to matching clients.`
- **Editor modal.** Name, Summary, Tags (checkboxes from `DB.tags`), and a **live reach preview** (`artReach()`). **Save** (`saveArticle`): validate title; upsert; toast `Article saved & delivered to matching clients`.
- **[PM INPUT].** "Auto-delivers" — confirm the real channel and timing (email on save? digest?), and whether Marketing may see client-level names (the Reach "Who" reveals client names) or only counts (see 4.6 PII open item).

#### S-23 — Audience Lists (`renderLists` / `saveList` / `resolveList`)
- **Purpose.** Reusable, multi-filter segments over clients (+ distributors + optionally prospects).
- **Filters (all multi-select unless noted):** Categories (`MKT_CATEGORIES`: Direct/Retail, HNI/UHNI, Family Office, Corporate Account, Trust/HUF, NRI, Distributor, Wealth Manager, IFA/Referral, Institution), Cities (`distinctCities()`), Zones (North/South/West/East via `zoneOf(city)`), Accounts (PMS / PMS Lite (RIA) / International investing), Distributors (`distinctDistributors()`), RMs (`RMS`), Min AUM (number), Include prospects (checkbox).
- **Resolution (`resolveList`).** Sequentially intersects clients against each set (a missing/empty set = no constraint); `inSet()` semantics; if Include prospects and no account/dist/city/zone filter, also folds in non-out leads (sub-labelled "Prospect · <stage>").
- **List table.** Name, Categories (or "All"), Summary (`listSummary` — human filter description, or "Everyone"), **Count** (`resolveList(l).length`), Edit / Delete (`delList` → toast `List deleted`).
- **Editor.** Live preview box (first 40 members + "…and N more"); **Save** (`saveList`) validates a name; toast `List saved`.

#### S-24 — Events (`renderEvents` / `saveEvent`)
- **Event fields.** `{id, name, lead, colead, date, venue, groups[](list ids)}`.
- **Table.** Name, Lead, Colead, Date, Groups (list names), **Count** (`eventInvitees(e)` = **deduped** invitees across the attached lists, by `email||name`), **Edit**. Empty: `No events yet — plan one to get started.`
- **Editor.** Lead/Colead from `TEAM_MEMBERS`; Groups = checkboxes of `lists[]` (each with its member count); a live **unique invitee** counter (`evRecount`). **Save** (`saveEvent`) validates name; toast `Event saved`.

---

### 4.9 · B2B / Partnerships & Leadership

#### S-37 — Partner Pipeline (`renderB2bPipeline` / `renderPartner`)
- **Purpose.** Work partner-firm leads.
- **Scope.** `b2bScope()` (B2BRM = own; Head = all).
- **`b2bLeads` fields.** `{id, firm, type (Wealth Manager/Family Office/Distributor/IFA·Referral), source (Instagram/Referral/LinkedIn/Meta ad/Inbound), city, contactName, phone, email, stage (New/Qualified/Meeting set/In discussion/Onboarded/Not interested), rm, mode (Visit/Online/''), hist[], notes}`.
- **Pipeline table.** Firm, Type, Source, City, **Stage** (chip mapped to L1–L4 styling), **RM** (or "unassigned"), **Mode** (🏢 In-person / 🎥 Online / —), **Work** (`openPartner(id)`). Filters: Type, Stage. Empty: `No partner leads.`
- **Work-a-partner modal.** Engagement **recommendation banner**: if an RM is assigned, **same city → "In-person visit recommended"**, else **"Online meeting recommended"**; if no RM, "Assign an RM to get the recommendation." Contact details (`kvr`); editable **Stage** (`b2bSet('stage')`) and **Assigned RM** (`b2bSet('rm')` — **disabled unless `B2BHead`**; assigning an RM to a `New` lead auto-promotes to `Qualified`). Quick-log **📞 Call / ✉️ Email / 🤝 Meeting** (`logB2b` → push to `hist`; toast `<type> logged`). **🎥 Schedule online meet / 🏢 Schedule in-person visit** (`b2bSchedule(mode)` → requires an RM else toast `Assign an RM first`; sets `mode`, auto-promotes New/Qualified → `Meeting set`, creates a meeting 2 days out, 11:00, dur 60 (Visit)/30 (Online), meet = `In-person · <city>` or `genMeet()`; toast accordingly). Notes textarea (`b2bSet('notes')`). Interactions history (newest-first).
- **Business logic — engagement-by-city (5.9).** `b2bRmCity(rm) === l.city` → visit, else online.

#### S-38 — B2B Dashboard (`renderB2bDash`)
- Head-only oversight. **Cards.** Partner leads (all), Unassigned (`!rm && stage!=='Not interested'`), In engagement (Meeting set / In discussion), Onboarded. **Per-RM table** (over `B2B_RMS`): name, city, assigned count, scheduled (`mode` set), onboarded. **Attention panel**: unassigned partners each with **Assign** (`openPartner`), or "All partner leads are assigned."
- **Business logic.** The **Head assigns** the Partnerships RM. **[PM INPUT — open item #2]** there is no separate B2B *qualifier* queue (the Head assigns directly); decide whether to add one mirroring S-05/S-06.

#### S-39 — Leadership (`renderOwner`)
- **Purpose.** Department oversight with an escalation feed.
- **Department toggle** (`OWNER_DEPTS`): Sales / Investment / Compliance / Operations, each with a subtitle (`DEPT_SUB`) and an attention-count badge.
- **Cards.** *Sales:* Active leads, Outreach this week, Meetings this week, Pre-investment (L4), Needs attention. *Investment/Compliance/Operations:* Completed, In progress, Open, Overdue, Needs attention (from `teamTaskStats(team)`).
- **"⚠ Needs your attention" feed (`deptAttn`)** — composed per department:
  - *Sales (`salesAttn`)*: Five-Strike reached (L1, count≥5, non-app) → **Write off → Out** (`ownerWriteOff` → `out=true, outReason='Five-Strike — written off (Leadership)'`) / **Reassign RM**; Follow-up overdue → **Nudge <RM>** (`ownerNudge`); App lead awaiting qualification → **Nudge Lead Desk**.
  - *Investment (`investmentAttn`)*: Quarterly/Annual review due/overdue → **Mark reviewed** (`ownerMarkReview`) / **Open client**.
  - *Compliance (`complianceAttn`)*: Client flagged → **Open verification**/**Open client**; KYC pending → **Open verification**.
  - *All depts (`taskAttn`)*: Ticket blocked / overdue → **Reassign** (`openTask`) / **Escalate** (`ownerEscalate` → priority High + sys log; toast `Escalated: <title>`).
- **Actions.** `ownerNudge` → toast `🔔 Reminder sent to <name> — <ctx>`; `ownerMarkReview` → sets review dates, toast `Review marked done for <name>`; `ownerWriteOff` → toast `<name> moved to Out List`.
- **[PM INPUT].** "Nudge" is a toast only [WIREFRAME] — define the real notification (channel + recipient). Confirm the throughput metrics and scorecard definitions.

---

### 4.10 · Universal screens

#### S-21 — Knowledge Hub (`hub`)
In-app documentation available to every role: overview, teams & duties, lead flow, five-strike, assignment, onboarding, clients, tasks, compliance, reviews, leadership, a team-handoff flow diagram, a "how do I…" cheat-sheet, and a glossary. [Static content; no data dependencies.] **[PM INPUT]** ownership and update process for this content in production.

#### S-22 — Feature Suggestions (`renderSugg` / `loadSugg`) [LIVE INTEGRATION]
- The **only non-mocked integration**: a shared suggestions board backed by **Supabase**. An anonymous voter id is stored in `localStorage` (`fbc_voter`). Users add suggestions and (presumably) vote; the list loads live (`loadSugg`). Statuses include Requested / Planned / In Progress / Shipped.
- **[PM INPUT].** Whether this board ships in production, and if so its moderation, auth, and data-retention model.

#### `badges()` — nav counters (cross-cutting)
After most renders, `badges()` updates sidebar counts: leads total, out, suggestions, clients (`mine`), tasks (current role, not Done), verification (RIA not Verified), IPS due, assignment queue, onboarding in-flight, calendar today, **inbox unread**, PMS (aml≠Clear), B2B (active), reminders due this week, and the Leadership attention total.

---

## 5. Business Logic & Rules

Each rule has an ID (`BR-*`), the current implementation, and a PM-decision note where production must differ.

### 5.1 RIA vs PMS routing
- **BR-ROUTE-1.** Lumpsum **< ₹50 L → RIA** track (product `PMS Lite (RIA)`); **≥ ₹50 L → PMS** track. `International investing` is a separate product. Each account is tagged by `product`; compliance routing follows the product: RIA products → RIA Compliance screens (`riaClients()`); PMS + International → PMS Compliance screens (`pmsClients()`).
- **Current implementation note.** The wireframe assigns `product` from seed/migration maps, **not** from a live lumpsum check; `pmsClients()` is literally "not RIA", so **International is grouped with PMS for compliance**.
- **[PM INPUT].** Confirm the ₹50 L threshold and whether it's on initial lumpsum or AUM; define **International compliance routing** explicitly (is it really PMS-compliance, or its own regime?); confirm whether strategy list / fee / disclosure differ by track in the CRM views.

### 5.2 Household & accounts
- **BR-HH-1.** The **mobile number is the household key** (`digits(contact)`, 10 digits). One account per product per person; family members sit under the primary's number with a `relation`. Clients list = one row per account; Profiles roll up to one person.
- **BR-HH-2.** Onboarding forms are keyed by mobile (`formsForMobile`), so self-serve and RM-assisted starts converge.
- **[PM INPUT].** Can a person hold two accounts of the same product? (Spec assumes one each.) How are shared numbers across unrelated people handled? Is the mobile number itself verified (OTP)?

### 5.3 Lead lifecycle & five-strike
- **BR-LEAD-1.** Stages **L1 Cold → L2 Hot/Holding → L3 Onboarding → L4 Pre-Investment**.
- **BR-LEAD-2 (Five-Strike).** At L1, when `count ≥ 5` unanswered outreaches, the lead is flagged for the Out List; an alert appears in the drawer (dismissible → marks Potential) and **Move to Out** requires a reason (default `Five-Strike Rule`). Logging a response resets the dismissal so the alert can recur. The rule applies **only at L1**.
- **BR-LEAD-3.** Setting status `Not Interested` immediately out-lists the lead (`out=true`).
- **[PM INPUT].** Hard cap vs advisory; whether `count` should be system-derived from real channels.

### 5.4 Metrics & formulas
- **BR-METRIC-1 (CAGR).** `cagr(c)` = `(current/invested)^(1/years) − 1`; for tenure < 1 year, display **return since inception** instead (annualised CAGR misleads). Account cards show CAGR; <1yr handling per this rule.
- **BR-METRIC-2 (Gain).** `current − invested`, signed and colour-coded everywhere (green/`--hot`/muted).
- **BR-METRIC-3 (RIA register).** active = funded & not exited; inactive = not funded & not exited; exited = `exitedOn` set; counts as of month-end; new = onboarded in month, exited = exit date in month.
- **BR-METRIC-4 (AUM).** `Σ portfolio.current` over the scoped funded clients.
- **[PM INPUT].** Confirm `years` basis for CAGR (calendar vs 365d), and that absReturn/IRR come from the custodian, not computed in-CRM.

### 5.5 Compliance status (SEBI report)
- **BR-COMP-1.** Each SEBI item i–x is green/amber/red per the rules in S-31. A client is **complete** only if all are green; any red ⇒ "gap"; else any amber ⇒ "pending".
- **[PM INPUT].** Ratify each item's green rule against SEBI's actual requirement; define what produces each underlying record in production.

### 5.6 FIU grey list (PMS)
- **BR-PMS-1.** An FIU AML match on the PAN sets `pmsCompliance.aml='Flagged'` ⇒ **grey-listed, onboarding hard-blocked** until cleared. **[PM INPUT]** clearance workflow & authority.

### 5.7 Fees (RIA)
- **BR-FEE-1.** Advisory fees collected by **e-NACH auto-debit**; the CRM shows each cycle's status (Success/Failed + reason); failures can be Retried or Raised to RM.
- **[PM INPUT].** Fee computation source and cadence (the wireframe uses ~0.25% of current value as both the invoice and the debit amount — placeholder).

### 5.8 Schedules
- **BR-SCH-1.** Client **Monthly** report by the 1st (following month); **Half-yearly** end-Sep & end-Mar; **Tax** in April for the prior FY. SEBI **RIA register** daily; **PMR / APMI / PMSBazaar** fund-level (monthly/periodic). Reviews: annual IPS + quarterly portfolio; **annual risk refresh** 12-monthly (no response in 14 days → flag RM).
- **[PM INPUT].** Auto-send vs maker-checker (open item #4); implement the 14-day risk-refresh auto-flag (not built).

### 5.9 B2B engagement-by-city
- **BR-B2B-1.** If the assigned Partnerships RM's city = the partner's city → recommend **in-person visit**; else **online meet**. Scheduling auto-promotes the stage to "Meeting set".

### 5.10 Content routing & strategy naming
- **BR-CONTENT-1.** A client receives an article iff `article.tags ∩ client.tags ≠ ∅`.
- **BR-STRAT-1.** Strategy is **backend-assigned and read-only in the CRM** — the RM cannot change it (the editable Strategies tab was removed; only the read-only "Recommended Strategies" line on the account Overview and the Investment & SIP tab remain). Current strategy names are the generic `STRATEGIES` list (`Flameback Multicap / Momentum / Dividend Yield / Bluechip / Small-Cap Alpha`).
- **[PM INPUT — open item #5].** The RIA App maps Final Score → *Cruise Shield / Steady / Navigator / Accelerate / Maverick*. Confirm whether the CRM should display these **Cruise tier** names instead of (or alongside) the generic strategy names.

---

## 6. Integrations
Each integration: purpose + trigger. **All except Supabase are mocked in the current prototype.** For every one, a production build needs a named provider, auth method, field mapping, retry/fallback, and webhook/callback handling — captured as a single PM INPUT at the end.

| # | Integration | Purpose / trigger | Touch-points (screens) |
|---|---|---|---|
| INT-1 | **DIGIO** | E-sign of the agreement + digital KYC (PAN/name/DOB/Aadhaar e-KYC); stores signed PDF (`agreementUrl`) | S-09, S-30 |
| INT-2 | **CKYC registry** | Fetch/update CKYC (RIA; PMS handled by partner) | S-09, S-30, S-31 |
| INT-3 | **KRA** | KYC Registration Agency status (`kyc.kra`) | S-30, S-31 |
| INT-4 | **FIU (AML)** | PMS screening by PAN → grey list | S-34 |
| INT-5 | **Custodian / admin API** | Pull holdings/valuations/returns; fund-level filing data; the 8 per-client reports | S-10/S-11 data, S-19, S-35, S-36 |
| INT-6 | **Transactional email + tracking** | Send reports/content/IPS; capture delivered/opened/acknowledged | S-19, S-30, S-36, S-25 |
| INT-7 | **Google Calendar / Meet** | Create events + Meet links + invites; pre-call reminders | S-06, S-14, S-15, S-16, S-37 |
| INT-8 | **Gmail / ESP** | Inbox send/receive | S-18 |
| INT-9 | **Payment / e-NACH** | Mandate setup + advisory-fee auto-debit; status + failure reasons | S-32 |
| INT-10 | **SEBI PMR portal / APMI / PMSBazaar** | Fund-level uploads (PMR via SEBI portal `…doPmr=yes`) | S-35 |
| INT-11 | **WhatsApp Business** | Outreach + delivery receipts; the "repair notification" | S-04, S-11 |
| INT-12 | **Account Aggregator (RBI AA)** | Optional auto-import of client financials into onboarding | S-09 |
| INT-13 | **Supabase** | **Live** shared Feature-Suggestions board | S-22 |

> **[PM INPUT — Providers & contracts.** For INT-1…INT-12, name the provider, auth, field mapping, retry/fallback policy, and webhook/callback before estimates. Especially: the **custodian/admin sync (INT-5)** that populates `clients[].portfolio` and feeds reports/filings — this is the backbone the CRM assumes exists.]

---

## 7. Error Handling

### 7.1 Access / permission
| Error | Message | Behaviour |
|---|---|---|
| Out-of-scope record requested | "You don't have access to this record." | Block at API; log attempt. **[PM INPUT — not enforced in wireframe.]** |
| Wrong-product compliance role | (hidden) | RIA-Compliance can't open PMS clients & vice-versa (enforced today only by `riaClients()`/`pmsClients()` scoping). |

### 7.2 Validation (implemented today)
| Case | Behaviour |
|---|---|
| Lead saved with empty name | Blocked; toast `Lead name is required`. |
| Onboarding form < 85% complete | E-sign button disabled. |
| Onboarding mobile not 10 digits | Blocked; toast `Enter a valid 10-digit mobile number`. |
| Add account without member name | Blocked; toast `Enter the account holder / member name`. |
| Reassign task without reason | Blocked; reason field required; toast `Add a reason for the reassignment`. |
| Assign without a meeting date | Blocked; toast `Pick a meeting date`. |
| Save list/event/article without name | Blocked; toasts `Name the list` / `Name the event` / `Title needed`. |
| Schedule B2B engagement with no RM | Blocked; toast `Assign an RM first`. |
| Send report to missing/invalid email | **[PM INPUT — not validated in wireframe]**; production must block + flag the client. |
| Add 2nd account of same product | **[PM INPUT — not blocked in wireframe]**; production should block per BR-HH-1. |

### 7.3 Integration failures (intended)
| Integration | Behaviour |
|---|---|
| DIGIO e-sign fails | Retry 3×; status "e-sign pending"; no technical codes shown. |
| Custodian fetch fails | Mark filing/report "fetch failed"; alert PMS Compliance. |
| e-NACH debit fails | Show reason in Fee Payments; allow Retry / Raise-to-RM. |
| Email send bounces | Mark failed; notify sender. |
*(All [PM INPUT] — the wireframe simulates success paths only.)*

### 7.4 General
Never show technical error codes; always a human message plus a recovery path.

---

## 8. Non-Functional Requirements
- **8.1 Performance.** P95 page < 2s; report generation async with progress. *[PM INPUT — SLAs, and the async report pipeline that the wireframe fakes with instant client-side downloads.]*
- **8.2 Platform.** Web app (desktop + tablet). *[PM INPUT — mobile support?]*
- **8.3 Security.** RBAC at the query layer (not just UI); PAN/Aadhaar/demat a/c encrypted at rest (AES-256), keys in a secrets manager; TLS 1.2+ in transit. *[The wireframe has none of this — role switch + plaintext `localStorage`.]*
- **8.4 SEBI / DPDP.** DPDP consent captured & timestamped; **unmasked PAN/Aadhaar only for the compliance officer, every unmasked view written to an immutable audit log**, exportable (CSV/JSON) and included in the monthly compliance report; SEBI retention norms for agreements/reports. *[PM INPUT — the wireframe masks in the SEBI report drill-down but shows full PAN in the daily register and does not audit-log unmasked views; define the masking matrix per role and the audit store.]*
- **8.5 Notifications.** *[PM INPUT — channels (SMS/WhatsApp/email/push) + triggers for review-due, report-dispatch, fee-failure, filing-due, 10-min pre-call, e-sign-pending, five-strike. The wireframe implements only the 10-min pre-call as a client-side timer and "nudges" as toasts.]*

---

## 9. Out of Scope (v1.0)
| Item | Notes |
|---|---|
| Client-facing RIA App | Separate spec. |
| Live portfolio analytics / P&L engine in CRM | Holdings/returns synced from custodian/admin (INT-5); no live calculation engine here. |
| Rebalancing / execution engine | Referenced (rebalance dates, trade log) but not built here. |
| Real auth/SSO/RBAC build | Demo uses a role switcher. |
| Real payment gateway / e-NACH mandate setup | e-NACH status shown; mandate setup is the app/PSP's. |
| HUF / intermediary onboarding | Waitlisted (per app spec). |
| Lead→client auto-conversion on signing | Accounts are seeded today (open item #3). |
| Time-triggered auto-send of reports/filings | Manual one-click today (open item #4). |

---

## 10. Open Items — PM Sign-Off Required
| # | Item | Decision needed | Ref |
|---|---|---|---|
| 1 | RIA vs PMS threshold | Confirm ₹50 L; International compliance routing | 5.1 |
| 2 | B2B Qualifier screen | Add a dedicated qualification queue, or keep "Head assigns"? | S-38 |
| 3 | Lead→client conversion | Auto-create the account/client when the agreement is signed? Who assigns `cid`/product/strategies? | S-09/S-10 |
| 4 | Report & filing dispatch | Auto-send on schedule vs maker-checker approval | 5.8 |
| 5 | Strategy naming | Show Cruise tiers (Shield/Steady/Navigator/Accelerate/Maverick) in CRM? | 5.10 |
| 6 | Auth | Internal SSO/MFA + external partner login + identity→role mapping | 3.3 |
| 7 | Integration providers | DIGIO/CKYC/KRA/FIU/custodian/ESP/AA/e-NACH/SMS/WhatsApp + the custodian sync backbone | 6 |
| 8 | Masking policy & audit | Which roles see masked vs full PII; the immutable unmasked-view audit log | 8.4 |
| 9 | Notifications | Channels + triggers (incl. the 14-day risk-refresh flag, e-sign-pending, five-strike) | 8.5 |
| 10 | Marketing PII | May Marketing see client-level data (names in Reach/Lists) or aggregates only? | 4.8 |
| 11 | Field authority | Which role may edit which client/KYC fields; the custodian-owned vs CRM-owned field split | S-11 |
| 12 | Fee model | Real advisory-fee computation, cadence, GST/invoice numbering, legal entity/GSTIN | 5.7, S-29 |
| 13 | Strategy performance source | Replace the name-hash demo figures with real performance | S-28 |
| 14 | Onboarding field list | Ratify the authoritative onboarding form fields, mandatory set, and 85%-vs-mandatory gate | S-09 |
| 15 | Dedup on sign-up | Auto-merge a duplicate sign-up (same number) into the existing person | S-06 |

---

## 11. End-to-End Flows

**B2C (acquire → serve).** Ad / website / app sign-up → **Lead / Assignment** (S-03 / S-05). For an app sign-up, the **Qualifier** picks the best-fit RM and books the intro call, creating a Google Meet invite (S-06); the lead becomes `qualified`, `stage=L2`, `onbStep≥3`. The **RM** runs onboarding (S-07): mobile-first hub (S-08), one form per account keyed by mobile (S-09), reaching e-sign at ≥85% complete; signing advances the lead to `stage=L4`. **[Today the account is seeded, not auto-created — open item #3.]** The funded account appears in **Clients / Profiles** (S-10 / S-13); the RM runs **meetings / reviews / reports** (S-14 / S-16 / S-19). **Compliance** runs in parallel — RIA: KYC file → monthly SEBI report → fee status → daily register (S-30–S-33); PMS: FIU screening → filings → custodian reports (S-34–S-36). **Marketing** content reaches clients by tag intersection.

**B2B (partner).** Partner inbound (S-37) → the **Head assigns** a Partnerships RM (S-38) → engage **online/visit by city** → onboarded → the partner gets the **Distributor portal** (S-26–S-29).

**Guardrails.** *Record an audit acknowledgement, don't hard-block unless noted:* five-strike move, task-reassignment reason, strategy backend-only, DPDP consent, unmasked-PII access log. **Hard blocks:** FIU grey list (no onboarding), report send to invalid email *(intended)*, out-of-scope data access *(intended)*.

---

## Appendix A — Data Dictionary

The persisted state is a single JSON object `DB` (localStorage key `flameback_crm_v1`). Below, each collection's fields with type and meaning. Fields marked † are **lazily backfilled** by `ensureClientExtras`/`ensureLeadExtras` on load (so older records gain them), and several are computed from `cid` hashes ([WIREFRAME]).

### A.1 `leads[]`
| Field | Type | Meaning |
|---|---|---|
| `id` | int | unique (`DB.nextId`) |
| `name` | string | lead name |
| `source` | string | Referral / LinkedIn / Meta / Google / Direct / Search / Tools / Instagram… |
| `status` | enum | New / Cold / Potential / Hot / Onboarding / Not Interested |
| `stage` | enum | L1 / L2 / L3 / L4 |
| `rm` | string | owning RM |
| `type` | string | last interaction (Call/Email/Meeting/WhatsApp) |
| `count` | int | interaction count (drives five-strike) |
| `comments` | string | free text |
| `follow` | datetime | next follow-up |
| `hist[]` | `{type, when}` | interaction history |
| `out` / `outReason` | bool / string | out-listed + reason |
| `appUser`† | bool | true = app sign-up |
| `flow` | string | Self-serve / RM-assisted (app leads) |
| `qualified` | bool | qualified by the Lead Desk |
| `onbStep` | int 0–7 | index into `ONB_STEPS` |
| `phone`,`email` | string | app-lead contact |
| `rec`,`recReason` | string | recommended RM + reason [seeded] |
| `abandoned` | bool | self-serve drop-off |
| `assignedRM`,`meetLink` | string | set at assignment |

### A.2 `clients[]` (one per account)
| Field | Type | Meaning |
|---|---|---|
| `cid` | string | account id (`FBC-####`) |
| `contact`,`whatsapp`,`sameWa` | string/bool | household key = `digits(contact)` |
| `signup`,`exitedOn`† | date | lifecycle dates (exit drives RIA register) |
| `first`,`last`,`email`,`country`,`postal`,`source` | string | identity |
| `holder`†,`relation`† | string | household holder + relation (Self/Spouse/…) |
| `product`† | enum | PMS Lite (RIA) / PMS / International investing |
| `plan` | enum | Monthly/Quarterly/Yearly (billing) |
| `goal` | string | investment objective |
| `zerodha` | Yes/No | broker pre-existing |
| `questionnaire`,`agreement`,`signed` | string/bool | onboarding artefacts |
| `strategies[]` | string[] | recommended strategies |
| `sip`,`sipDetails` | Yes/No, `{investment,frequency,start,amount}` | SIP |
| `kyc` | object | `{namePan,pan,gender,address,city,state†,dob,profession,marital,pep,kra,ckyc,aadhaar†}` |
| `residentStatus`† | string | Individual-Resident / NRI / NRO |
| `portfolio` | object | `{invested,current,absReturn,irr,holdings[[name,inv,cur]],suspense[[name,amt,reason]]}` (from custodian) |
| `invoices[]` | `{date,desc,amount,status}` | billing |
| `funded` | bool | account funded |
| `distributor`†,`segment`† | string | channel partner + marketing segment |
| `calls[]` | `{when,note,source}` | synced follow-ups |
| `compliance`† | `{status}` | Verified/Flagged/Pending (RIA) |
| `pmsCompliance`† | `{aml,amlOn}` | FIU result (PMS) |
| `disclosure`†,`welcomeKit`† | bool | SEBI items ii / iv |
| `riskProfile`† | `{category,communicated,assessedOn}` | SEBI item iii |
| `suitability`† | `{doc,preparedOn,sentOn}` | SEBI item viii |
| `advice`† | `{rationale,signedOn,by}` | SEBI item v |
| `tradeLog[]`† | `{date,advice,approvalToken,orderId,confirm}` | SEBI item ix |
| `demat`† | `{status,broker,account,accessType,grantedOn,log[]}` | read-only access |
| `feeDebit`† | `{amount,date,status,reason}` | e-NACH cycle |
| `reports`† | `{monthly,halfyearly,tax:{lastSent,receipts[]}}` | client reports |
| `reportsSent`† | `{<reportName>:{date,email}}` | custodian reports (PMS) |
| `ips`† | `{riskBand,targetEquity,lastReview,nextReview,nextAnnualReview,lastAnnualReview,nextQuarterlyReview,lastQuarterlyReview,notes}` | reviews/IPS |
| `agreementUrl`†,`ckycLink`†,`docs`† | string/object | document links |
| `tags[]`†,`profileNotes`†,`commPref`† | — | profile tags / notes / comm prefs |

### A.3 Other collections
- **`forms[]`** — `{no, mobile, leadId, holder, member, relation, product, data{personal,contact,financial,objective,route,risk,bank,nominee,decl}, status, esign{sentTo,when,status}, started, lastSaved}` (see S-09 for every `data` field).
- **`meetings[]`** — `{id, title, rm, when, dur, attendees[{n,role}], meet, status}`.
- **`tasks[]`** — `{id, title, team, type, cid, from, priority, status, due, assignee, notes, thread[{by,text,when,sys}], created}`.
- **`emails[]`** — `{id, from, to, subject, body, date, read}`.
- **`distributors[]`** — channel partners (`{name,type,city,…}`); `seedDistributors()`.
- **`lists[]`** — `{id, name, categories[], cities[], zones[], accounts[], distributors[], rms[], minVal, includeProspects}`.
- **`events[]`** — `{id, name, lead, colead, date, venue, groups[](list ids)}`.
- **`articles[]`** — `{id, title, summary, tags[], date}`.
- **`tags[]`** — string vocabulary (preset list in `seedTags()` + created).
- **`pmsFilings[]`** — `{name, freq, source, due, status, url?, uploadedOn?}`.
- **`custReports[]`** — `{name, freq, auto, lastRun, tracking{sent,delivered,seen}|null}`.
- **`b2bLeads[]`** — `{id, firm, type, source, city, contactName, phone, email, stage, rm, mode, hist[], notes}`.
- **Migration flags** — booleans on `DB` (`demoPeopleV2`, `demoHouseholdV1`, `marketingV1`, `marketingV2`, `tagsV1`, `invHistV1`, `pmsFilingsV2`, `appLeadsSeeded`) gate idempotent backfills.

---

## Appendix B — Glossary, enumerations & colour legend

**Enumerations**
- **Lead stage:** L1 Cold · L2 Hot/Holding · L3 Onboarding · L4 Pre-Investment.
- **Lead status:** New · Cold · Potential · Hot · Onboarding · Not Interested.
- **Onboarding steps (`ONB_STEPS`, 0–7):** Captured details · Authenticated · Choosing path · In progress · Advisory routing · Sign agreement · Fund account · Onboarded.
- **Products:** PMS Lite (RIA) · PMS · International investing.
- **Task status:** Open · In Progress · Blocked · Done. **Priority:** High · Medium · Low.
- **RIA compliance status:** Verified · Flagged · Pending.
- **PMS AML:** Not run · Clear · Flagged (grey-listed).
- **B2B stage:** New · Qualified · Meeting set · In discussion · Onboarded · Not interested. **Mode:** Visit · Online.
- **Filing status:** Pending · Fetched · Uploaded.
- **Email tracking:** Pending (📤) · Delivered (✅) · Seen (👁); reports add Acknowledged.
- **SEBI items i–x:** see S-31.

**Colour legend (status)**
- **Green / Verified / Success / Complete** — done, compliant, cleared.
- **Amber / Pending / Warm** — in progress, due soon.
- **Red / `--hot` / Flagged / Gap** — missing, failed, overdue, blocked.

**Key glossary terms**
- **Household** — all accounts and family members on one mobile number.
- **CAGR since inception** — annualised return; for <1yr accounts, "return since inception" is shown instead.
- **Five-Strike** — at L1, 5 unanswered outreaches flag a lead for the Out List.
- **Grey list** — FIU AML-matched PMS client; cannot be onboarded.
- **e-NACH** — the auto-debit mandate used to collect advisory fees.
- **PMR** — SEBI Portfolio Manager Report (fund-level, monthly).
- **IPS** — Investment Policy Statement (suitability document).
- **Suspense holding** — an unreconciled position (e.g. a corporate-action bonus) awaiting custodian reconciliation.

*End of document.*





