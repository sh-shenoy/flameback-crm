# Flameback CRM — Functional Spec (Product)

> Plain-English, screen-by-screen spec for the team building this CRM. Describes every screen, what it does, the flows, the backend logic in words, and edge cases.
> Companion: `FLOWS.md` (one-page flow overview), `CHANGELOG.md` (what's been built).

---

## A. The big picture

Flameback sells three products: **PMS Lite (RIA)** (advisory), **PMS** (discretionary), and **International investing**. The CRM serves two ways of getting clients and the teams behind them:

- **B2C** — individuals and their families who come from ads/website/referrals.
- **B2B / Partnerships** — partner firms (distributors, wealth managers, family offices, IFAs) who bring clients.

Everyone logs in as a **role** and sees only the screens relevant to them. The roles are: RM, Qualifier (Lead Desk), Investment, Operations, RIA Compliance, PMS Compliance, Marketing, Distributor (external partner), Partnerships RM, Partnerships Head, and Leadership.

Two ideas run through everything:
1. **A "household" = one mobile number.** One person can hold several accounts (one each of PMS / RIA / International), and family members sit under the same number. The Clients list shows **one row per account**.
2. **Role scoping.** An RM sees only their own book; a distributor sees only their own clients; compliance is split — **RIA Compliance** handles RIA clients, **PMS Compliance** handles PMS clients.

---

## B. Screen index

| ID | Screen | Who uses it | In one line |
|----|--------|-------------|-------------|
| S-01 | Login / "Viewing as" role switch | Everyone | Pick the role you're working as (prod = real login). |
| S-02 | RM Dashboard | RM | Your pipeline, follow-ups due, reviews due. |
| S-03 | Leads | RM | Your lead pipeline (L1–L4). |
| S-04 | Lead detail | RM | Work a lead: log calls, set stage, start onboarding. |
| S-05 | Assignment Queue | Qualifier | New app sign-ups waiting to be assigned to an RM. |
| S-06 | Qualify & Assign | Qualifier | Pick best-fit RM, book the intro meeting. |
| S-07 | Onboarding Journey | RM | Leads in onboarding + the funnel. |
| S-08 | Onboarding — Household hub | RM | All accounts on a number; add accounts/family. |
| S-09 | Onboarding form | RM | The long account-opening form + e-sign. |
| S-10 | Clients (accounts) | RM, Investment, Leadership | One row per account; quick-view; product tags. |
| S-11 | Account detail | RM + others | Full account: overview, investment, portfolio, reports, invoices. |
| S-12 | Profiles directory | RM, Investment, Leadership | Search every lead & client by name/email/number. |
| S-13 | Person Profile | RM + others | One person: accounts, tags, communication, timeline, notes. |
| S-14 | Calendar | Most | Meetings + Google Meet, conflicts, 10-min reminders. |
| S-15 | Schedule meeting / call | RM, Distributor | Book a meeting with any client/lead/colleague. |
| S-16 | Reviews & Reminders | RM, Investment | Annual IPS + quarterly reviews due this week. |
| S-17 | Tasks & Requests | All teams | Cross-team handoffs (board + activity log). |
| S-18 | Inbox | All | Email to/from you (Inbox/Sent), compose, reply. |
| S-19 | Client Reports | RM, Investment, Distributor, Leadership | View & send Monthly / Half-yearly / Tax reports. |
| S-20 | Out List | RM | Parked/dead leads with reasons, revivable. |
| S-21 | Knowledge Hub | All | In-app guide to how the CRM works. |
| S-22 | Feature Suggestions | All | Shared ideas board (live). |
| S-23 | Audience Lists | Marketing | Reusable segments (multi-filter). |
| S-24 | Events | Marketing | Plan events; attach audience lists. |
| S-25 | Content | Marketing | Tag articles; auto-deliver to matching clients. |
| S-26 | Distributor Dashboard | Distributor (external) | RM-style view of their own book + contact RM. |
| S-27 | Distributor Clients | Distributor | Their clients (city, AUM, CAGR). |
| S-28 | Distributor Strategies | Distributor | Strategies they can offer + performance. |
| S-29 | Distributor Invoices | Distributor | Fee invoices, filter & download. |
| S-30 | RIA Compliance List | RIA Compliance | Per-client KYC/compliance file. |
| S-31 | Monthly SEBI Report | RIA Compliance | SEBI items i–x status + per-client drill-down. |
| S-32 | Fee Payments | RIA Compliance | Advisory fee auto-debit status & failures. |
| S-33 | SEBI RIA Daily Report | RIA Compliance | Daily client register + 5-year metrics. |
| S-34 | PMS Review | PMS Compliance | FIU AML screening + grey list. |
| S-35 | Regulatory Filings | PMS Compliance | SEBI PMR / APMI / PMSBazaar (fund level). |
| S-36 | Custodian Reports | PMS Compliance | Per-client custodian reports + email tracking. |
| S-37 | Partner Pipeline | Partnerships RM/Head | B2B partner leads + work modal. |
| S-38 | B2B Dashboard | Partnerships Head | Partner pipeline overview + per-RM. |
| S-39 | Leadership | Leadership | Department throughput + needs-attention. |
| S-40 | Role dashboards | Qualifier/Inv/Ops/Compliance | Role-specific home screens. |

---

## C. Screen-by-screen

For each: **who**, **what's on it**, **what you can do**, **backend logic (in words)**, **edge cases**.

### S-01 · Login / Role switch
- **Who:** everyone. **On it:** the "Viewing as" dropdown (prototype) → in production this is the login + the system reads your role.
- **Logic:** your role decides which menu items appear and what data you can see (your own book vs everyone).
- **Edge:** an external partner must never see internal screens or other partners' clients.

### S-02 · RM Dashboard
- **Who:** RM. **On it:** cards (active leads, hot leads, onboarding, follow-ups due, reviews due this week) and a panel of follow-ups due today/overdue.
- **Do:** add a lead; click a follow-up to open the lead.
- **Logic:** "due" = follow-up date today or earlier; everything is filtered to the logged-in RM.
- **Edge:** brand-new RM with no book sees zeros, not errors.

### S-03 · Leads  ·  S-04 · Lead detail
- **Who:** RM. **On it:** lead table (name, source, status, stage L1–L4, RM, interactions, follow-up). Lead detail opens a side drawer.
- **Do:** log a call/email/meeting/WhatsApp; set stage/status/follow-up; add comments; **Start onboarding**; move to Out List.
- **Logic — Five-Strike:** at stage L1, after **5 outreach attempts with no response**, the lead is flagged to move to the Out List (a reason is required). Logging an interaction bumps the count and timestamp.
- **Edge:** a lead that responds resets the five-strike warning; out-listed leads can be revived later with their history intact.

### S-05 · Assignment Queue  ·  S-06 · Qualify & Assign
- **Who:** Qualifier. **On it:** app sign-ups not yet assigned (with captured details, source, the flow they chose, a recommended RM).
- **Do:** open a lead, pick the best-fit RM, set the meeting date/time, confirm.
- **Logic:** confirming **assigns the RM, books an intro meeting and auto-creates a Google Meet invite** for client + RM + qualifier; the lead becomes "qualified" and moves to L2/onboarding. A self-serve drop-off shows as a "recovery" item.
- **Edge:** duplicate sign-up (same number) should attach to the existing person, not create a second.

### S-07 · Onboarding Journey  ·  S-08 · Household hub  ·  S-09 · Onboarding form
- **Who:** RM. **On it:** a funnel (where leads are) + a table of leads in onboarding with a **Start onboarding / Resume** button. Onboarding is **RM-only**.
- **Flow:**
  1. Click **Start onboarding** → it asks for the **mobile number first**.
  2. The number opens the **Household hub** — every account already on that number, each with progress.
  3. **Resume** any account, or **add an account** (PMS/RIA/International — one each per person) or a **family member** (spouse, parent…). Each account is its own form.
  4. The **form** captures personal, contact, financial, objective, **advisory routing (which product)**, risk profile, bank/demat, nominee, declarations — with a live progress bar — and ends with a **Send e-sign request** for the agreement.
- **Logic:** forms are **keyed by the mobile number**, so if the client started self-serve (or another RM started it), entering the number **resumes the exact same form** — nothing is lost. e-sign is enabled once the form is mostly complete.
- **Edge:** client started self-serve then asks for help → RM resumes mid-way; e-sign sent but unsigned → reminder after a week, then a task to the RM.

### S-10 · Clients  ·  S-11 · Account detail
- **Who:** RM (own), Investment & Leadership (all). **On it:** one row **per account**, grouped by household, with product tags and filters; a **quick-view** dropdown (holdings, CAGR since inception, invested/current).
- **Account detail tabs:** Overview (personal + engagement), Investment & SIP, Risk Profile & Agreement, Portfolio, **Reports**, Invoices, Call Sync. A family member's account shows **"linked to [primary] · [relation]"**.
- **Logic:** strategies are backend-assigned (not edited here); "CAGR since inception" is annualised from invested→current over the tenure.
- **Edge:** very new accounts (under a year) make annualised CAGR look extreme — show "return since inception" instead.

### S-12 · Profiles  ·  S-13 · Person Profile
- **Who:** RM, Investment, Leadership. **On it:** a searchable directory of **every lead and client** (by name, email or number); a person rolls up all their accounts + linked leads.
- **Profile tabs:** **Accounts** (each account: invested/current/CAGR, a portfolio graph, strategy performance, holdings, rebalance dates; open an account for its own page incl. a **Reports** tab), **Communication** (channels/frequency/language/DND), **Timeline** (reach-outs for leads; onboarding/funding/rebalance history for clients), **Notes** (free text about the person).
- **Header:** DOB, RM, source, account count, and **tags** (see Tags below).

### S-14 · Calendar  ·  S-15 · Schedule meeting/call
- **Who:** most roles. **On it:** day-grouped meetings with Google Meet links; conflicts flagged.
- **Do:** **Schedule meeting/call** with any client/lead/colleague; pick online (Meet link) or call; **Preview** a 10-min reminder.
- **Logic:** a **pop-up reminder appears ~10 minutes before** any call. RMs see their own calendar; Investment/Leadership see the team calendar.
- **Edge:** overlapping meetings for one RM are flagged as conflicts to reschedule.

### S-16 · Reviews & Reminders
- **Who:** RM, Investment. **On it:** clients due **this week** for an **annual IPS review** or **quarterly portfolio review**; schedule call / send reminder / open IPS.
- **Logic — annual risk refresh:** every 12 months the client is prompted to re-do the risk questionnaire; if no response in **14 days**, the RM is flagged.

### S-17 · Tasks & Requests
- **Who:** all teams. **On it:** a board (Open / In-Progress / Blocked / Done) of cross-team requests with an activity log.
- **Do:** raise a request to a team + person; drag across the board; post updates.
- **Logic:** **reassigning a task requires a reason**, which is recorded in the activity log.

### S-18 · Inbox
- **Who:** all. **On it:** Inbox / Sent for the logged-in person; unread badge.
- **Do:** compose (delivers to the recipient's inbox), open (marks read), reply (pre-filled).
- **Logic:** everything sent in the CRM (reports, invites, partner contact) also lands in the relevant inbox.
- **Edge:** a bad/missing email address blocks the send and flags it.

### S-19 · Client Reports
- **Who:** RM, Investment, Distributor, Leadership (own book). **On it:** per client — **Monthly** (holdings, trades, P&L, valuation, advisor commentary **+ fee invoice**), **Half-yearly**, **Tax** (STCG/LTCG/dividends, ITR-ready).
- **Do:** **View** the contents, **Send** to the client.
- **Logic — receipts:** each send logs **delivered → opened → acknowledged** and lands in the client's inbox. Schedule: monthly by the 1st, half-yearly end-Sep/end-Mar, tax in April.

### S-20 · Out List  ·  S-21 · Knowledge Hub  ·  S-22 · Feature Suggestions
- Out List: parked/dead leads with reasons, restorable. Knowledge Hub: in-app guide (teams, flows, glossary, module map). Feature Suggestions: shared ideas board (the one live, multi-user feature).

### S-23 · Audience Lists  ·  S-24 · Events  ·  S-25 · Content (Marketing)
- **Audience Lists:** build a reusable segment with **multi-select** filters — Category (Direct/Retail, HNI, Family Office, Corporate, Trust, NRI, Distributor, Wealth Manager, IFA, Institution), City, Zone, Account type, Distributor, RM, min AUM, include-prospects; live member preview.
- **Events:** name + lead + co-lead + date/venue; attach audience lists as groups; shows the **unique invitee count** (deduped).
- **Content:** upload + **tag** an article; it **auto-delivers to every client carrying a matching tag**; the article shows its reach.

### S-26–S-29 · Distributor portal (external partner)
- **Dashboard:** the **same RM dashboard** we give our own RMs but scoped to **their** clients — AUM with Flameback, net gain, client count, client list, and **"Reach out to your Flameback RM"** (call/email/WhatsApp).
- **Clients:** their clients (city/AUM/CAGR → full profile). **Strategies:** strategies they can offer + performance. **Invoices:** fee invoices with a date-range filter (incl. past 3 years), per-invoice download + download-all.
- They also get Calendar, Reviews and Portfolios/IPS for their own book. **The only difference vs an internal RM:** the RM they contact is **us**.

### S-30 · RIA Compliance List
- **Who:** RIA Compliance (RIA clients only). **On it:** per client — the account-opening form; **KYC verified via DIGIO** (PAN/name/DOB/Aadhaar — no manual uploads); CKYC/KRA; disclosure accepted; risk profile; **DIGIO-signed agreement** (PDF); welcome kit; **suitability (IPS)** with send-to-client; **demat access** (client-granted, read-only — **we can't revoke it**).
- **Do:** Verify, or **Raise to RM** (creates a task).

### S-31 · Monthly SEBI Report
- **Who:** RIA Compliance. **On it:** header with SEBI reg-no + timestamp (PDF-exportable); four metrics (active / fully compliant / pending / gaps); a table of **green/amber/red** status for all **ten SEBI items (i–x)**; click a client for a **drill-down** — identity (PAN/Aadhaar masked), document links, trade & advice audit trail, report dispatch log, correspondence log.
- **Logic:** each item's colour is computed from the underlying records (agreement signed, disclosure, risk, KYC/CKYC, correspondence, suitability, invoice, etc.).

### S-32 · Fee Payments
- **Who:** RIA Compliance. **On it:** advisory fee **auto-debit (e-NACH)** status per client — cleared vs **failed with the reason** (insufficient balance, mandate expired…).
- **Do:** **Retry** the debit, or **Raise to RM** (pre-filled follow-up task).

### S-33 · SEBI RIA Daily Report
- **Who:** RIA Compliance. **On it:** the daily client **register** sent to SEBI — start date, name, contact, email, product, strategy, PAN, CKYC/KRA proof link, **resident status** (Resident / NRI / NRO / Non-Individual / Non-Resident), agreement link, city/state, country, gender. **Exportable to CSV.**
- **Plus:** a **month picker (5-year history)** showing **new added / exited / active / inactive / total** as of that month.
- **Logic:** active = funded & not exited; inactive = not funded & not exited; exited = has an exit date; sent automatically each day.

### S-34 · PMS Review (PMS Compliance)
- **Who:** PMS Compliance (PMS clients). **Key point:** PMS KYC/CKYC/document checks are done by our **onboarding partner outside the CRM**. The officer's only job here is **FIU AML screening**.
- **Do:** Run the **FIU check (by PAN)**. **Logic:** an FIU match **grey-lists** the client → **cannot be onboarded**; a clear result makes them eligible.

### S-35 · Regulatory Filings (PMS, fund-level)
- **Who:** PMS Compliance. **On it:** fund-level/firm-wide submissions — **SEBI Monthly PMR** (links to the SEBI PMR portal; fetch the report from the custodian → upload via the portal), **APMI** submission, **PMSBazaar** upload — with due-date reminders. (These are **aggregate**, not per client.)

### S-36 · Custodian Reports (PMS, per client)
- **Who:** PMS Compliance. **On it:** each PMS client has their own panel of the **8 custodian reports** (holding statement, transactions, capital gains, corporate actions, NAV/performance, bank book, securities ledger, expense & fee).
- **Do:** **Send** each (or **Send all**) to the client. **Logic:** the system pulls the report from the custodian and emails it; each report shows **email status** (sent / delivered / seen) via the connected email system.

### S-37 · Partner Pipeline  ·  S-38 · B2B Dashboard (Partnerships)
- **Who:** Partnerships RM (own partners) & Head (all). **On it:** partner firms — distributor / wealth manager / family office / IFA — that reached us via **Instagram / ads / LinkedIn / referral / inbound**, with type, source, **city**, stage, RM, engagement mode.
- **Flow:** inbound partner → Head **assigns** a Partnerships RM → RM works it (log interactions, set stage) → **engagement by city**: if the RM is in the partner's city the CRM **recommends an in-person visit**, otherwise an **online meet**; one-click schedule either.
- **Head dashboard:** pipeline counts, per-RM breakdown, and **unassigned partners needing an RM**.
- **Open item:** today the **Head** assigns; a dedicated **B2B Qualifier** queue (like the B2C qualifier) is not built yet.

### S-39 · Leadership  ·  S-40 · Role dashboards
- **Leadership:** a department toggle (Sales / Investment / Compliance / Operations) showing throughput, a **"needs your attention"** escalation list, and per-person scorecards.
- **Role dashboards:** Qualifier (queue + recovery), Investment (AUM, reviews due, tasks), Operations (task queue), Compliance (verification queue).

---

## D. End-to-end flows (in words)

**B2C — acquire to serve**
1. A person sees an ad / visits the site / is referred → becomes a **lead** (S-03) or an app sign-up.
2. App sign-ups go to the **Qualifier** (S-05), who calls them and **assigns the best-fit RM** with an intro meeting.
3. The **RM** works the lead (S-04), then **starts onboarding** (S-07–S-09): one number → a household → one or more accounts (and family members), each finishing with **DIGIO e-sign**.
4. Once funded, the account appears in **Clients** (S-10) and in the person's **Profile** (S-13).
5. The RM **schedules meetings** (S-14), runs **reviews** (S-16), sends **reports** (S-19), and uses **tags** so Marketing's **content** reaches the right clients.
6. **Compliance** runs in parallel — RIA clients through RIA Compliance (S-30–S-33), PMS clients through PMS Compliance (S-34–S-36).

**B2B — acquire partners**
1. A distributor/WM/family office reaches us via ads/referral (S-37).
2. The **Partnerships Head** assigns a **Partnerships RM**.
3. The RM engages **online or in person based on city**, moves the firm through the pipeline to **Onboarded**.
4. An onboarded partner gets a **Distributor portal** (S-26–S-29) to manage their own clients (with us as their RM).

---

## E. Backend logic, in plain words (the rules that matter)

- **Household = mobile number.** Accounts and family members hang off it; one row per account in Clients.
- **Onboarding forms are keyed by number** so self-serve + RM-assisted converge — no lost progress, no duplicates.
- **Five-Strike:** 5 unanswered L1 outreaches → flag to Out List (reason required).
- **Scoping:** RM = own book; Distributor = own clients; RIA Compliance = RIA clients; PMS Compliance = PMS clients; Investment/Leadership = everyone.
- **Compliance split:** KYC for RIA is verified digitally by DIGIO (no uploads); for PMS, KYC is done by the onboarding partner and the CRM only runs **FIU + grey list**.
- **Grey list:** an FIU match blocks onboarding.
- **Fee auto-debit (e-NACH):** even though automated, the CRM shows success/failure + reason; failures can be retried or raised to the RM.
- **Reports:** client reports log delivery/open/acknowledgement; the SEBI RIA register goes daily; SEBI PMR/APMI/PMSBazaar are fund-level filings.
- **Demat access** is granted by the client (read-only) and **cannot be revoked by us**.
- **PII (PAN/Aadhaar)** is visible unmasked only to the compliance officer; every unmasked view is logged.

---

## F. Edge cases (consolidated)

- Duplicate lead/sign-up (same number/email) → attach to the existing person, don't fork.
- Self-serve drop-off then asks for help → RM resumes the same form.
- e-sign sent but never signed → reminder, then RM task.
- One household, two PANs (e.g. spouse) → keep them as separate people under one number; never merge PANs.
- Same product twice for one person → not allowed (one each).
- Exited client → drop from active counts/reports but keep in the register and audit trail.
- New account (<1 year) → annualised CAGR misleads → show return-since-inception.
- FIU-flagged client reaching onboarding → hard block.
- Distributor's client reassigned to another distributor → access follows the current distributor.
- Report send to a client with no/invalid email → blocked and flagged.
- Overlapping meetings for an RM → flagged as a conflict to reschedule.
- Times shown in IST; daily/periodic jobs run on IST schedule.

---

## G. Open product decisions

1. **B2B Qualifier** screen — add a dedicated qualification queue, or keep "Head assigns"?
2. Auto-convert a signed lead into a client/account (today it's manual)?
3. Should client reports auto-send, or wait for a compliance/maker-checker approval?
4. May Marketing see client-level details, or only segments?
5. International-investing specific rules (LRS limits, reporting).
