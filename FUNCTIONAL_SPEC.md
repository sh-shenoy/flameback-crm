# FLAMEBACK CAPITAL — Flameback CRM (Back-Office)
## FUNCTIONAL SPECIFICATION DOCUMENT
Version: 1.0 | June 2026 | CONFIDENTIAL
Prepared by: Shashank Shenoy | Status: Draft

> Companion to the **Flameback India RIA App** spec (the client-facing app). That app onboards investors; **this CRM is what the firm's teams use** to acquire, onboard, serve and stay compliant. Where the two meet, the app's post-profile onboarding (KYC / agreement / broker / fee / deploy, app screens S-I01–S-I05) lands in this CRM for the RM and Compliance.

### HOW TO READ THIS DOCUMENT
- Section 1 — Document Overview & Scope
- Section 2 — System Architecture & Screen Overview
- Section 3 — User Roles & Authentication
- Section 4 — Screen-by-Screen Functional Specifications
- Section 5 — Business Logic & Rules
- Section 6 — Integrations
- Section 7 — Error Handling
- Section 8 — Non-Functional Requirements
- Section 9 — Out of Scope
- Section 10 — Open Items Requiring PM Sign-Off
- Section 11 — End-to-End Flows

**PM INPUT** boxes flag items requiring Product Owner decision before engineering begins.

---

## 1. Document Overview

### 1.1 Purpose
Defines the complete functional behaviour of the **Flameback CRM** v1.0 — the internal back-office for Sales, Onboarding, Investment, Operations, Compliance (RIA + PMS), Marketing, Partnerships (B2B) and Leadership, plus an external portal for distributors/wealth managers. Primary reference for development. Visual design/copy is in the Design Brief.

### 1.2 Scope
Covers: B2C lead acquisition & assignment; RM-led onboarding (household/accounts/e-sign); clients, accounts & unified profiles; tags & content routing; calendar, reviews, tasks, inbox; client reporting; the distributor portal; RIA compliance (KYC files, monthly SEBI report, fee auto-debit, daily SEBI RIA register); PMS compliance (FIU/grey list, fund-level filings, per-client custodian reports); B2B partnerships; and Leadership oversight.

### 1.3 Version Log
| Version | Date | Author | Changes |
|---|---|---|---|
| 1.0 | June 2026 | Shashank Shenoy | First CRM functional spec; aligned to RIA App spec format. |

---

## 2. System Architecture & Screen Overview

### 2.1 Two motions, role-based
- **B2C** — individuals/families from ads/website/referrals/app sign-ups.
- **B2B / Partnerships** — partner firms (distributors, wealth managers, family offices, IFAs).

Every user works as a **role**; the menu and the data they can see follow the role. Two structural ideas:
1. **Household = one mobile number.** A person can hold one account per product (PMS Lite (RIA) / PMS / International); family members sit under the primary's number. Clients list shows **one row per account**.
2. **Scoping.** RM = own book; Distributor = own clients; **RIA Compliance** = RIA clients; **PMS Compliance** = PMS clients; Investment/Leadership = all.

### 2.2 Path tags
| Tag | Path | Screens | Description |
|---|---|---|---|
| B2C-ACQ | Acquire | S-03 → S-05 → S-06 | Lead/app sign-up → qualify → assign RM + book intro. |
| B2C-ONB | Onboard | S-07 → S-08 → S-09 | Household hub → add accounts/family → form → e-sign. |
| B2C-SERVE | Serve | S-10/S-13 → S-14/S-16/S-19 | Profiles, meetings, reviews, reports. |
| COMP-RIA | RIA compliance | S-30 → S-33 | KYC file, SEBI report, fee status, daily register. |
| COMP-PMS | PMS compliance | S-34 → S-36 | FIU/grey list, filings, custodian reports. |
| B2B | Partnerships | S-37 → S-38 | Partner pipeline → assign → engage (online/visit). |
| PARTNER | Distributor portal | S-26 → S-29 | External partner's own book + contact RM. |

### 2.3 Screen Inventory
| ID | Screen Name |
|----|-------------|
| S-01 | Login / Role |
| S-02 | RM Dashboard |
| S-03 | Leads |
| S-04 | Lead Detail (drawer) |
| S-05 | Assignment Queue |
| S-06 | Qualify & Assign |
| S-07 | Onboarding Journey |
| S-08 | Onboarding — Household Hub |
| S-09 | Onboarding Form |
| S-10 | Clients (accounts) |
| S-11 | Account Detail |
| S-12 | Profiles Directory |
| S-13 | Person Profile |
| S-14 | Calendar |
| S-15 | Schedule Meeting / Call |
| S-16 | Reviews & Reminders |
| S-17 | Tasks & Requests |
| S-18 | Inbox |
| S-19 | Client Reports |
| S-20 | Out List |
| S-21 | Knowledge Hub |
| S-22 | Feature Suggestions |
| S-23 | Audience Lists |
| S-24 | Events |
| S-25 | Content |
| S-26 | Distributor Dashboard |
| S-27 | Distributor Clients |
| S-28 | Distributor Strategies |
| S-29 | Distributor Invoices |
| S-30 | RIA Compliance List (KYC file) |
| S-31 | Monthly SEBI Report |
| S-32 | Fee Payments |
| S-33 | SEBI RIA Daily Report |
| S-34 | PMS Review (FIU / grey list) |
| S-35 | Regulatory Filings |
| S-36 | Custodian Reports |
| S-37 | Partner Pipeline (B2B) |
| S-38 | B2B Dashboard |
| S-39 | Leadership |
| S-40 | Role Dashboards (Qualifier / Investment / Operations / Compliance) |

---

## 3. User Roles & Authentication

### 3.1 Roles
| Role | Sees | Notes |
|---|---|---|
| RM | Own leads, clients, onboarding, calendar, reviews, reports | Scoped to self. |
| Qualifier (Lead Desk) | Assignment queue | Routes app sign-ups. |
| Investment | All portfolios, IPS, reviews | Not allotted clients. |
| Operations | Task queue | Account/demat/recon. |
| RIA Compliance | RIA clients only | KYC, SEBI report, fees, daily register. |
| PMS Compliance | PMS clients only | FIU, filings, custodian reports. |
| Marketing | Segments/aggregates | Lists, events, content. |
| Distributor (external) | Own clients only | RM-style portal. |
| Partnerships RM | Own partner leads | B2B. |
| Partnerships Head | All partner leads | Assigns RMs, oversees. |
| Leadership | All-up | Department oversight. |

### 3.2 Authentication
- **PM INPUT — Auth method:** SSO (Google Workspace) vs email+password+MFA for internal staff; the external distributor portal needs its own credentialed login. Define session timeout, MFA, and password policy.
- **BR-AUTH-1** RBAC enforced at the API/query layer, not only in the UI (see NFR 8.3).

---

## 4. Screen-by-Screen Functional Specifications

Each screen: **Purpose · Key elements/actions · Behaviour & logic · Edge cases.**

### 4.1 Sales (RM)

**S-02 · RM DASHBOARD** — *Purpose:* the RM's home. *Elements:* cards (active leads, hot, onboarding L3+L4, follow-ups due, reviews due this week) + a follow-ups panel. *Logic:* "due" = follow-up date ≤ today; everything filtered to the logged-in RM. *Edge:* empty book → zeros.

**S-03 · LEADS / S-04 · LEAD DETAIL** — *Purpose:* work the pipeline. *Elements:* table (name, source, status, stage L1–L4, interactions, follow-up); detail drawer with quick-log (Call/Email/Meeting/WhatsApp), stage/status/follow-up, comments, **Start onboarding**, **Move to Out**. *Logic:* **Five-Strike** — at L1, 5 unanswered outreaches → prompt move to Out List (reason required). *Edge:* a response resets the warning; out-listed leads revivable.

### 4.2 Lead Desk (Qualifier)

**S-05 · ASSIGNMENT QUEUE / S-06 · QUALIFY & ASSIGN** — *Purpose:* route app sign-ups. *Elements:* unassigned sign-ups (details, source, chosen flow, recommended RM); assign modal (RM, date/time). *Logic:* confirm → assign RM + book intro meeting + **auto-create Google Meet invite** (client + RM + qualifier); lead becomes qualified. *Edge:* duplicate sign-up (same number) attaches to existing person; self-serve drop-offs flagged "recovery".

### 4.3 Onboarding (RM only)

**S-07 · ONBOARDING JOURNEY** — funnel + leads-in-onboarding table with **Start onboarding / Resume**.

**S-08 · HOUSEHOLD HUB** — *Purpose:* manage every account on a number. *Flow:* Start onboarding → **ask mobile number first** → hub lists all accounts on it → **Resume** any, or **Add account** (one each of PMS/RIA/International per person) / **Add family member**. *Logic:* forms **keyed by mobile** so self-serve + RM-assisted converge.

**S-09 · ONBOARDING FORM** — *Elements:* personal, contact, financial, objective, **advisory routing (product)**, risk, bank/demat, nominee, declarations; progress bar; **Send e-sign** (DIGIO). *Logic:* e-sign enabled ≥85% complete. *Edge:* drop-off resumes same form; e-sign-sent-but-unsigned → reminder then RM task.

### 4.4 Clients & Profiles

**S-10 · CLIENTS** — one row per account, grouped by household; product tags + filter; **quick-view** (holdings, CAGR-since-inception, invested/current). **S-11 · ACCOUNT DETAIL** — tabs: Overview, Investment & SIP, Risk & Agreement, Portfolio, **Reports**, Invoices, Call Sync; family accounts show "linked to [primary] · [relation]". *Logic:* strategy is backend-assigned (read-only). *Edge:* <1yr accounts → show return-since-inception (annualised CAGR misleads).

**S-12 · PROFILES / S-13 · PERSON PROFILE** — searchable directory of every lead + client; person rolls up accounts + leads. Profile tabs: **Accounts** (per-account metrics, portfolio graph, strategy perf, holdings, rebalance dates; open account → Reports tab), **Communication** (channels/frequency/language/DND), **Timeline** (reach-outs / lifecycle), **Notes**. Header: DOB, RM, source, tags.

### 4.5 Operating tools

**S-14 · CALENDAR / S-15 · SCHEDULE** — meetings + Google Meet, conflict flags, **10-min pre-call reminder**; schedule with any client/lead/colleague (online or call). **S-16 · REVIEWS & REMINDERS** — annual IPS + quarterly reviews due this week; annual risk refresh (no response in 14 days → flag RM). **S-17 · TASKS** — cross-team board (Open/In-Progress/Blocked/Done); reassignment requires a reason. **S-18 · INBOX** — per-user Inbox/Sent, compose/reply, unread badge; CRM-sent items land here. **S-20/21/22** — Out List, Knowledge Hub, Feature Suggestions.

**S-19 · CLIENT REPORTS** — per client view & send **Monthly** (holdings, trades, P&L, valuation, commentary **+ fee invoice**), **Half-yearly**, **Tax** (STCG/LTCG/dividends, ITR-ready). *Logic:* each send logs delivery → open → acknowledgement; lands in client inbox.

### 4.6 Marketing
**S-23 · AUDIENCE LISTS** — reusable segments, multi-select (category, city, zone, account type, distributor, RM, min AUM, include-prospects), live count. **S-24 · EVENTS** — name + lead + co-lead + groups (lists) + dedup invitee count. **S-25 · CONTENT** — tag an article → auto-deliver to clients with a matching tag; shows reach.

### 4.7 Distributor portal (external)
**S-26 DASHBOARD** (RM-style, own book: AUM, net gain, clients, reviews-due, contact-your-RM), **S-27 CLIENTS**, **S-28 STRATEGIES**, **S-29 INVOICES** (range filter incl. past 3y, per-invoice + bulk CSV). *Logic:* only difference vs internal RM is the RM they contact is us.

### 4.8 RIA Compliance
**S-30 · KYC FILE** — per client: account-opening form; **KYC verified via DIGIO** (PAN/name/DOB/Aadhaar — no uploads); CKYC/KRA; disclosure; risk profile; DIGIO-signed agreement; suitability (IPS) send; **demat access** (client-granted read-only, not revocable by us); Verify / Raise-to-RM. **S-31 · MONTHLY SEBI REPORT** — SEBI-reg-no + timestamp header (PDF export); metrics; green/amber/red across SEBI items **i–x**; per-client drill-down (identity w/ PAN/Aadhaar masked, doc links, trade/advice audit trail, dispatch log, correspondence). **S-32 · FEE PAYMENTS** — advisory fee **auto-debit (e-NACH)** status; failures show reason; Retry / Raise-to-RM. **S-33 · SEBI RIA DAILY REPORT** — daily client register (start date, name, contact, email, product, strategy, PAN, CKYC/KRA proof, resident status, agreement link, city/state, country, gender), CSV export; month picker (5-yr) → new/exited/active/inactive/total.

### 4.9 PMS Compliance
**S-34 · PMS REVIEW** — KYC/CKYC done by onboarding partner **outside the CRM**; here only **FIU AML screening** (by PAN) → match = **grey-listed, cannot onboard**. **S-35 · REGULATORY FILINGS** (fund-level) — **SEBI Monthly PMR** (portal link, fetch from custodian → upload), **APMI**, **PMSBazaar**; due reminders. **S-36 · CUSTODIAN REPORTS** — per client, the 8 custodian reports; send each/all; email delivery/seen tracked.

### 4.10 B2B / Partnerships
**S-37 · PARTNER PIPELINE** — partner firms (distributor/WM/family office/IFA) via Instagram/ads/LinkedIn/referral/inbound; work modal (interactions, stage, **engagement mode by city** — same city = visit, else online; schedule either). **S-38 · B2B DASHBOARD** — Head's pipeline overview, per-RM, unassigned. *Logic:* Head assigns the Partnerships RM.

### 4.11 Leadership & role dashboards
**S-39 · LEADERSHIP** — department toggle (Sales/Investment/Compliance/Operations): throughput, "needs your attention", per-person scorecards. **S-40 · ROLE DASHBOARDS** — Qualifier/Investment/Operations/Compliance home screens.

---

## 5. Business Logic & Rules

### 5.1 RIA vs PMS routing (aligned to RIA App §5.1)
Lumpsum **< ₹50 L → RIA** track (product *PMS Lite (RIA)*); **≥ ₹50 L → PMS** track. International is a separate product. The CRM tags each account by product and **routes compliance**: RIA accounts → RIA Compliance; PMS accounts → PMS Compliance.
> **PM INPUT — Track differences:** confirm the ₹50 L threshold; how International routes for compliance; whether strategy list / fee / disclosure differ by track in the CRM views.

### 5.2 Household & accounts
- Mobile number = household key. One account per product per person; family members under the primary's number. Clients list = one row per account.
- **PM INPUT:** can a person hold two of the same product? (Spec assumes one each.)

### 5.3 Lead lifecycle
Stages L1 (Cold) → L2 (Hot/Holding) → L3 (Onboarding) → L4 (Pre-Investment). **Five-Strike:** 5 unanswered L1 outreaches → flag for Out List (reason required).

### 5.4 Metrics
- **CAGR since inception** = (current/invested)^(1/years) − 1; for tenure <1y, display "return since inception" instead.
- **RIA daily register** — active = funded & not exited; inactive = not funded & not exited; exited = exit date set. Month counts as of month-end; **new = onboarded in month, exited = exit date in month**.

### 5.5 Compliance status (SEBI report)
Each of items i–x is **green** (complete) / **amber** (in progress) / **red** (missing), computed from the underlying records (agreement, disclosure, risk, KYC/CKYC, advice rationale, correspondence, suitability, advice/trade record, invoice). A client is **fully compliant** only if all are green.

### 5.6 FIU grey list (PMS)
An FIU AML match on the PAN sets the client to **grey-listed**; onboarding is hard-blocked until cleared.

### 5.7 Fees (RIA)
Advisory fees collected via **e-NACH auto-debit**. The CRM shows each cycle's status (Success/Failed + reason). Failures can be **Retried** or **Raised to RM**.

### 5.8 Schedules
- Client **Monthly** report by the 1st (of the following month), **Half-yearly** end-Sep & end-Mar, **Tax** in April for the prior FY.
- **SEBI RIA register** filed daily. **SEBI PMR / APMI / PMSBazaar** are fund-level (monthly/periodic).
- **Reviews:** annual IPS + quarterly portfolio; **annual risk refresh** 12-monthly (no response 14 days → flag RM).

### 5.9 B2B engagement-by-city
If the assigned Partnerships RM's city = the partner's city → recommend **in-person visit**; else **online meet**.

### 5.10 Content routing
A client receives an article when the article's tags **intersect** the client's tags.

> **PM INPUT — Strategy naming:** the RIA App maps Final Score → *Cruise Shield / Steady / Navigator / Accelerate / Maverick*. Confirm whether the CRM should display these strategy/tier names (currently shows generic Flameback strategy names).

---

## 6. Integrations
Each integration: purpose + trigger. **All are mocked in the current prototype.**

| # | Integration | Purpose / trigger |
|---|---|---|
| INT-1 | **DIGIO** | E-sign + digital KYC (PAN/name/DOB/Aadhaar e-KYC); stores signed agreement PDF. |
| INT-2 | **CKYC registry** | Fetch/update CKYC (RIA; PMS handled by partner). |
| INT-3 | **KRA** | KYC Registration Agency status. |
| INT-4 | **FIU (AML)** | PMS screening by PAN → grey list. |
| INT-5 | **Custodian API** | Pull fund-level filing data + the 8 per-client reports. |
| INT-6 | **Transactional email + tracking** | Send reports/content; capture delivered/opened/acknowledged. |
| INT-7 | **Google Calendar / Meet** | Create events + Meet links + invites. |
| INT-8 | **Gmail / ESP** | Inbox send/receive. |
| INT-9 | **Payment / e-NACH** | Mandate + advisory fee auto-debit; status + failure reasons. |
| INT-10 | **SEBI PMR portal / APMI / PMSBazaar** | Fund-level uploads (PMR via the SEBI portal). |
| INT-11 | **WhatsApp Business** | Outreach + delivery receipts. |
| INT-12 | **Account Aggregator (RBI AA)** | Optional auto-import of client financials into onboarding (mirrors RIA App §6.1). |
| INT-13 | **Supabase** | Live shared Feature-Suggestions board (only non-mocked integration). |

> **PM INPUT — Providers & contracts:** name the provider, auth, field-mapping, retry/fallback and webhook for each of INT-1…INT-12 before estimates.

---

## 7. Error Handling

### 7.1 Access / permission
| Error | Message | Behaviour |
|---|---|---|
| Out-of-scope record requested | "You don't have access to this record." | Block at API; log attempt. |
| Compliance role / wrong product | (hidden) | RIA-Compliance can't open PMS clients & vice-versa. |

### 7.2 Validation
| Case | Behaviour |
|---|---|
| Onboarding form incomplete (<85%) | e-sign disabled. |
| Send report to missing/invalid email | Block + flag the client. |
| Reassign task without reason | Block; reason field required. |
| Add 2nd account of same product | Blocked (one each). |

### 7.3 Integration failures
| Integration | Behaviour |
|---|---|
| DIGIO e-sign fails | Retry 3×; status "e-sign pending"; no technical codes shown. |
| Custodian fetch fails | Mark filing "fetch failed"; alert PMS Compliance. |
| e-NACH debit fails | Show reason in Fee Payments; allow Retry / Raise-to-RM. |
| Email send bounces | Mark failed; notify sender. |

### 7.4 General
Never show technical error codes; always a human message + a recovery path.

---

## 8. Non-Functional Requirements
- **8.1 Performance** — P95 page < 2s; report generation async with progress. *(PM INPUT: SLAs.)*
- **8.2 Platform** — Web app (desktop + tablet). *(PM INPUT: mobile?)*
- **8.3 Security** — RBAC at the query layer (not just UI); PAN/Aadhaar/demat-a/c encrypted at rest (AES-256), keys in a secrets manager; TLS 1.2+ in transit.
- **8.4 SEBI / DPDP** — DPDP consent captured & timestamped; **unmasked PAN/Aadhaar only for the compliance officer, every unmasked view written to an immutable audit log**, exportable (CSV/JSON) and included in the monthly compliance report; SEBI retention norms for agreements/reports.
- **8.5 Notifications** — *PM INPUT:* channels (SMS/WhatsApp/email/push) + triggers for review-due, report-dispatch, fee-failure, filing-due, 10-min pre-call.

---

## 9. Out of Scope (v1.0)
| Item | Notes |
|---|---|
| Client-facing RIA App | Separate spec. |
| Live portfolio analytics in CRM | Holdings synced from custodian/admin; no live P&L engine here. |
| Rebalancing/execution engine | Referenced, not built here. |
| Real auth/SSO build | Demo uses a role switcher. |
| Real payment gateway build | e-NACH status shown; mandate setup is the app/PSP's. |
| HUF / intermediary onboarding | Waitlisted (per app spec). |

---

## 10. Open Items — PM Sign-Off Required
| # | Item | Decision needed | Ref |
|---|---|---|---|
| 1 | RIA vs PMS threshold | Confirm ₹50 L; International compliance routing | 5.1 |
| 2 | B2B Qualifier screen | Add a dedicated qualification queue, or keep "Head assigns"? | S-37 |
| 3 | Lead→client conversion | Auto-create the account/client when the agreement is signed? | S-09/S-10 |
| 4 | Report dispatch | Auto-send vs maker-checker approval before sending | 5.8 |
| 5 | Strategy naming | Show Cruise tiers in CRM? | 5.10 |
| 6 | Auth | Internal SSO/MFA + external partner login | 3.2 |
| 7 | Integration providers | DIGIO/CKYC/FIU/custodian/ESP/AA/e-NACH/SMS | 6 |
| 8 | Masking policy | Confirm which roles see masked vs full PII | 8.4 |
| 9 | Notifications | Channels + triggers | 8.5 |
| 10 | Marketing PII | May Marketing see client-level data or segments only? | 4.6 |

---

## 11. End-to-End Flows

**B2C:** ad/website/app sign-up → **Lead/Assignment** (S-03/S-05) → Qualifier assigns RM + books intro (S-06) → RM **onboards** the household & accounts with e-sign (S-07–S-09) → funded account appears in **Clients/Profiles** (S-10/S-13) → RM runs **meetings/reviews/reports** (S-14/S-16/S-19); **Compliance** runs in parallel (RIA: S-30–S-33 / PMS: S-34–S-36); Marketing **content** reaches clients by tag.

**B2B:** partner inbound (S-37) → Head **assigns** a Partnerships RM → engage **online/visit by city** → onboarded → partner gets the **Distributor portal** (S-26–S-29).

**Guardrails (record an audit acknowledgement, don't hard-block unless noted):** five-strike move, task reassignment reason, strategy backend-only, DPDP consent, unmasked-PII access log. **Hard blocks:** FIU grey list (no onboarding), report send to invalid email, out-of-scope data access.
