# Flameback CRM — Flows & Module Overview

**Live demo:** https://sh-shenoy.github.io/flameback-crm/
**Repo:** https://github.com/sh-shenoy/flameback-crm
**Nature:** Single-file front-end **wireframe/prototype** (`index.html`). All data is seeded and persisted in the browser's `localStorage` (key `flameback_crm_v1`). There is no backend; all external integrations (Google Meet/Calendar, Gmail, DIGIO e-sign, CKYC, FIU AML, custodian API, 3rd-party email tracking, SEBI/APMI/PMSBazaar portals, Supabase) are **simulated** unless noted. The Feature-Suggestions board is the one live integration (Supabase).

This document is the functional spec; the running change log is in `CHANGELOG.md`.

---

## 1. Concept

Flameback is a wealth-management business offering three products:
- **PMS Lite (RIA)** — advisory-led, under the Registered Investment Adviser (SEBI IA) regime.
- **PMS** — discretionary Portfolio Management Service (SEBI PMS regime).
- **International investing.**

The CRM covers two sales motions and the operating teams behind them:
- **B2C** — acquiring and serving individual investors and their families.
- **B2B / Partnerships** — acquiring partner firms (distributors, wealth managers, family offices, IFAs) who bring clients.

It is multi-role: a "Viewing as" switcher (top-left) changes the logged-in role; each role sees only its relevant menus (the sidebar follows each role's nav order).

---

## 2. Roles

| Role | Person (demo) | Purpose |
|---|---|---|
| Relationship Manager (RM) | Shashank | Owns leads → onboarding → client relationship. Scoped to own book. |
| Qualifier · Lead Desk | Maya Sharma | Qualifies inbound app leads, assigns the best-fit RM. |
| Investment Team | Anjali Rao | All clients' portfolios, IPS, reviews (not allotted — sees everyone). |
| Operations | Ravi Menon | Account/demat opening, cheques, reconciliations (tasks). |
| RIA Compliance Team | Neha Gupta | RIA (advisory) compliance — KYC files, SEBI report, fee auto-debit. Scoped to RIA clients. |
| PMS Compliance Team | Imran Khan | PMS compliance — FIU AML/grey list, regulatory filings, custodian reports. Scoped to PMS clients. |
| Marketing Team | Tanvi Shah | Events, audience lists, content/article distribution. |
| Distributor / Wealth Manager | ABC Wealth | External partner portal — RM-style view of their own clients. |
| Partnerships RM (B2B) | Aditya Rao | Works assigned partner-firm leads. |
| Partnerships Head (B2B) | Vikram Sethi | Assigns Partnership RMs, oversees the B2B pipeline. |
| Leadership · Dept Heads | R. Sharma | All-up oversight across departments. |

Universal to most roles: **Inbox**, **Knowledge Hub**, **Feature Suggestions**, **Tasks & Requests**.

---

## 3. B2C — acquisition & onboarding

### 3.1 Leads pipeline (RM)
- Stages **L1 Cold → L2 Hot/Holding → L3 Onboarding → L4 Pre-Investment**; status, source, RM, interaction count, follow-up date, history.
- **Five-Strike Rule** (L1): 5 unanswered outreaches → flag for the **Out List** (with reason, revivable).
- RMs see only their own leads/clients/calendar/reviews (`mine()` scoping by RM name).

### 3.2 Assignment queue (Qualifier)
- App sign-ups (self-serve or "talk to us"/RM-assisted) land here. The qualifier reviews, picks the best-fit RM, and confirms — auto-creating a Google Meet invite with client + RM + qualifier. Self-serve drop-offs become recovery leads.

### 3.3 Onboarding — household hub (RM only)
- "Start onboarding" asks for the **mobile number first**. Forms are **keyed by mobile**, so a self-serve drop-off (or another RM's start) **resumes the same form**.
- A number is a **household**: the hub lists every account on it; the RM can **resume any** or **add accounts** (PMS / RIA / International — one of each per person) and **family members** (spouse, parent…), each with its own product and agreement.
- Long form: personal, contact, financial, objective, **advisory routing (product fit)**, risk profile, bank/demat, nominee, declarations; live progress; ends with an **e-sign request** for the agreement.

---

## 4. Clients, accounts & profiles

### 4.1 Accounts & households
- One person (one number) → multiple **accounts** (one per product). Family members link under the **primary's number**.
- **Clients list** = one row per account, grouped by household, with a quick-view dropdown (holdings, CAGR since inception, invested/current) and product tags + filter.

### 4.2 Profiles (unified leads + clients)
- Searchable directory of every lead and client by name/email/number; leads + a household's accounts roll into one person.
- Profile tabs: **Accounts** (per-account: invested, current, CAGR, portfolio graph, strategy performance, holdings, rebalance dates; opening an account shows "linked to [primary] · [relation]" and a **Reports tab** inside that account), **Communication** (channels, frequency, language, DND), **Timeline** (reach-outs / lifecycle), **Notes**.
- Header shows DOB, RM, source, account count, and **tags**.

### 4.3 Tags & content routing
- Client **tags** = pain points/interests (tax, multi-generational dialogue, retirement, real estate, succession, ESG, liquidity event, etc.); preset list + create-your-own.
- **AI-suggested tags** inferred from notes/transcripts (keyword-based in the demo) for one-click accept.
- Marketing **Content** articles are tagged; each article **auto-delivers to clients carrying a matching tag**; the profile shows content shared, the article shows its reach.

---

## 5. Operating tools

- **Calendar** — meetings with Google Meet links; conflicts flagged; **➕ Schedule meeting/call** (with any client/lead/colleague); **🔔 pop-up reminder 10 min before** each call. RMs see own calendar; Leadership/Investment see the team calendar.
- **Reviews & Reminders** — annual IPS + quarterly portfolio reviews due this week; schedule/remind/IPS-doc.
- **Tasks & Requests** — cross-team handoffs; board (Open/In-Progress/Blocked/Done), activity log, reassignment requires a reason.
- **Inbox** — per-role Gmail-linked Inbox/Sent; the composer delivers into recipients' inboxes; open marks read, reply pre-fills; unread badge.
- **Client Reports** — per client, view & send **Monthly** (holdings, trades, P&L, valuation, commentary + fee invoice), **Half-yearly**, **Tax** (STCG/LTCG/dividend, ITR-ready); each send logs delivery/open/acknowledgement receipts and lands in the client's inbox.

---

## 6. Marketing

- **Audience Lists** — reusable segments with **multi-select** filters: Category (Direct/Retail, HNI/UHNI, Family Office, Corporate, Trust/HUF, NRI, Distributor, Wealth Manager, IFA/Referral, Institution), City, Zone, Account type, Distributor, RM, min AUM, include-prospects. Live member preview; channel partners are part of the pool.
- **Events** — name, lead, co-lead, date/venue, attach audience lists as groups; shows the deduped unique invitee count.
- **Content** — upload + tag articles; auto-deliver to matching clients (see 4.3).

---

## 7. Distributor / Wealth Manager portal (external partner)

Scoped to the partner's own clients (`distributor` field). They get the **same RM dashboard** we give internal RMs:
- **Dashboard** — AUM with Flameback, net gain, client count, client list, "Reach out to your Flameback RM" (call/email/WhatsApp).
- **Clients** (city/AUM/CAGR → full profile), **Strategies** (per-strategy performance + their AUM/clients), **Calendar** (schedule meetings with their clients or their RM), **Reviews & Reminders**, **Portfolios & IPS**, **Invoices** (per-client fee invoices, range filter incl. past 3 years, per-invoice download + download-all CSV).
- Only difference vs an internal RM: the RM they contact is **us**.

---

## 8. Compliance

The compliance function is split by regime; each is scoped to its own product set.

### 8.1 RIA Compliance Team (RIA / advisory clients)
- **RIA Compliance List** — per-client form-facing file: account-opening form; **KYC verified via DIGIO** (PAN/name/DOB/Aadhaar e-KYC — no manual uploads); CKYC; KRA; disclosure accepted; risk profile + communicated; DIGIO-signed agreement PDF; welcome kit; **suitability (IPS)** with send-to-client; **demat access** (client-granted read-only, broker + masked a/c + date; cannot be revoked by us). Verify / Raise-to-RM.
- **SEBI Report** — Monthly SEBI compliance report: SEBI-reg-no + timestamp header, PDF export, 4 summary metrics, a client table with green/amber/red status across the ten SEBI items (i–x), and a per-client drill-down (identity with PAN/Aadhaar masked, document links, trade/advice audit trail, report dispatch log, correspondence log).
- **Fee Payments** — advisory fee auto-debit (e-NACH) status per client; failures show the reason; Retry and Raise-to-RM.

### 8.2 PMS Compliance Team (PMS / non-RIA clients)
- **PMS Review** — PMS KYC/CKYC/document checks are done by the **onboarding partner (Silver Bullet) outside the CRM**. The officer's only job here is **FIU AML screening** (by PAN); an FIU match is **grey-listed → cannot be onboarded**.
- **Regulatory Filings** — fund-level/firm-wide: **SEBI Monthly PMR** (links to the SEBI PMR portal `…doPmr=yes`; fetch from custodian → upload via portal), **APMI** and **PMSBazaar** submissions; due-date reminders.
- **Custodian Reports** — per client, the 8 periodic custodian reports (holding statement, transactions, capital gains, corporate actions, NAV/performance, bank book, securities ledger, expense & fee); send each/all; **email delivery/seen tracking** (3rd-party).

---

## 9. B2B / Partnerships

- **Partner Pipeline** — partner firms (distributor / wealth manager / family office / IFA) reaching us via Instagram / Meta ads / LinkedIn / referrals / inbound; firm, type, source, city, stage, RM, engagement mode.
- **Work a partner** — interactions, stage, notes; **engagement recommendation by city** (in-person visit if RM in the partner's city, else online); one-click schedule online meet (Google Meet) or in-person visit.
- **Partnerships Head** assigns a Partnerships RM (qualifier-style) and gets a dashboard: pipeline counts, per-RM breakdown, unassigned partners needing an RM. **Partnerships RM** sees only their assigned partners.

---

## 10. Leadership

- All-up oversight with a department toggle (Sales / Investment / Compliance / Operations): team throughput, a "Needs your attention" escalation list, and per-person scorecards; sees all clients and the team calendar.

---

## 11. Knowledge Hub

In-app docs (every role): overview, teams & duties, lead flow, five-strike, assignment, onboarding, clients, tasks, compliance, reviews, leadership, a team handoff flow diagram, a how-do-I cheat-sheet, and a glossary.

---

## 12. Data model (localStorage `DB`)

- `leads[]` (B2C leads + app sign-ups), `clients[]` (one per account; fields: household/holder, relation, product, kyc, uploaded, compliance, ips, riskProfile, suitability, demat, feeDebit, pmsCompliance, reportsSent, invoices, calls, agreementUrl…), `meetings[]`, `tasks[]`, `forms[]` (onboarding, keyed by mobile), `distributors[]` (channel partners), `lists[]` + `events[]` + `articles[]` (marketing), `tags[]`, `emails[]` (inbox), `pmsFilings[]`, `custReports[]`, `b2bLeads[]`.
- Migrations are versioned flags (e.g. `demoPeopleV2`, `marketingV2`, `pmsFilingsV2`) that backfill new seed data into existing browsers on load.

---

## 13. Known gaps / next steps

- **B2B qualifier view** — B2B assignment is currently done by the Partnerships Head; there is no separate B2B qualifier/assignment-queue view yet.
- Real integrations (DIGIO, CKYC, FIU, custodian, email tracking, SEBI/APMI portals, Google) are simulated.
- No auth/RBAC at a data layer (role switch is a demo convenience); no real encryption.
- Lead → client conversion on agreement-signing is not yet automatic (accounts are seeded).
- Auto-send scheduling for reports/filings is manual (one-click) rather than time-triggered.
