# Flameback CRM — Functional Specification (Developer)

> **Audience:** engineers building the production system.
> **Companion docs:** `FLOWS.md` (narrative flow overview), `CHANGELOG.md` (prototype change log).
> **Status of this repo:** the `index.html` prototype is a clickable wireframe; all integrations are mocked. This spec describes the **production target** — real data model, RBAC, integrations, edge cases, scheduling and NFRs. Where the prototype already demonstrates behaviour it is cited as "[proto]".

Requirement IDs: `FR-<module>-<n>` (functional), `BR-<n>` (business rule), `INT-<n>` (integration), `EDGE-<n>` (edge case), `NFR-<n>`.

---

## 1. Scope & system context

Flameback offers three products — **PMS Lite (RIA)** (SEBI Investment Adviser regime), **PMS** (SEBI Portfolio Managers regime), and **International investing**. The CRM supports two acquisition motions (**B2C** individuals, **B2B** partner firms) plus servicing, reporting and dual compliance regimes.

**Target architecture (recommended):**
- SPA front-end (React/Vue) + REST/GraphQL API; relational DB (Postgres).
- RBAC enforced **at the API/query layer**, not just UI (NFR-1).
- Object store for documents (agreements, reports) with signed, expiring URLs.
- Job scheduler (cron/queue) for daily/periodic filings, report dispatch, reminders.
- Secrets in a manager (AWS Secrets Manager / Vault); PII encrypted at rest (AES-256).

---

## 2. Roles & RBAC

### 2.1 Roles
RM, Qualifier, Investment, Operations, RIA-Compliance, PMS-Compliance, Marketing, Distributor (external), B2B-RM (Partnerships RM), B2B-Head (Partnerships Head), Leadership. (Service accounts: scheduler, integration webhooks.)

### 2.2 Data scoping (BR)
- **BR-1** RM sees only records where `record.rm == currentUser` (leads, clients, calendar, reviews, reports, fee status).
- **BR-2** Distributor (external) sees only `client.distributor == currentPartner`.
- **BR-3** B2B-RM sees only `b2bLead.rm == currentUser`; B2B-Head sees all B2B leads.
- **BR-4** RIA-Compliance scoped to clients with `product` ∈ {PMS Lite (RIA)}; PMS-Compliance scoped to `product` ∉ {RIA} (PMS, International).
- **BR-5** Investment & Leadership see all clients (read); Leadership all-up across departments.
- **BR-6** Marketing sees aggregate/segment data, not individual sensitive PII beyond name/email/city unless needed.

### 2.3 Permission matrix (R=read, W=write, – none)
| Capability | RM | Qual | Inv | Ops | RIA-Comp | PMS-Comp | Mktg | Distrib | B2B | Lead |
|---|---|---|---|---|---|---|---|---|---|---|
| Leads (own) | RW | RW(assign) | – | – | – | – | – | – | – | R |
| Clients/accounts | RW(own) | – | R | R | R(RIA) | R(PMS) | R(seg) | R(own) | – | R |
| Onboarding forms | RW(own) | – | – | – | – | – | – | – | – | R |
| KYC/PAN/Aadhaar (unmasked) | – | – | – | – | RIA only | – (partner does) | – | – | – | – |
| Compliance actions | – | – | – | – | RW(RIA) | RW(PMS) | – | – | – | R |
| Reports send | RW(own) | – | RW | – | – | – | – | RW(own) | – | RW |
| Tasks | RW | RW | RW | RW | RW | RW | RW | – | RW | R |
| Marketing lists/events/content | – | – | – | – | – | – | RW | – | – | R |
| B2B partner pipeline | – | – | – | – | – | – | – | – | RW | R |

---

## 3. Data model

Types: `uuid`, `string`, `text`, `enum`, `date`, `datetime`, `money` (₹ integer paise/rupees), `bool`, `json`. PII flagged 🔒 (encrypted at rest, access-logged).

### 3.1 Person / Household
- `id uuid`, `mobile string` (household key, unique), `holderName string`, `email string`, `dob date`, `gender enum`, `city`, `state`, `country`, `source`, `marketingTags string[]`, `createdAt`.
- A **household** = persons sharing `mobile`. `relation enum{Self,Spouse,Father,Mother,Son,Daughter,Sibling}`.

### 3.2 Account (≈ prototype `client`)
- `id`, `cid string` (e.g. FBC-1007), `personId fk`, `household mobile`, `holder`, `relation`,
- `product enum{PMS Lite (RIA), PMS, International investing}`, `strategy string` (backend-assigned), `rm`, `distributor`,
- `funded bool`, `signupDate date`, `exitedOn date|null`,
- `kyc{ namePan, pan🔒, aadhaar🔒, dob, gender, address, city, state, profession, maritalStatus, pep bool, kra enum, ckyc string, ckycLink url }`,
- `residentStatus enum{Individual-Resident, Non-Individual-Resident, NRI, NRO, Non-Resident-Non-Individual}`,
- `portfolio{ invested money, current money, absReturn, irr, holdings[[name,inv,cur]], suspense[] }`,
- `ips{ riskBand, targetEquity, lastReview, nextAnnualReview, lastAnnualReview, nextQuarterlyReview, lastQuarterlyReview }`,
- `riskProfile{ category, communicated bool, assessedOn, nextRefresh }`,
- `consent{ given bool, ts, purpose }` (DPDP), `disclosure{accepted,ts}`, `agreementUrl url` (DIGIO), `welcomeKit bool`,
- `suitability{ doc, preparedOn, sentOn }`,
- `demat{ status enum{Not granted,Active}, broker, account🔒, accessType:'Read-only', grantedOn, log[] }` (client-granted, **not** revocable by us — BR-7),
- `feeDebit{ amount money, date, status enum{Success,Failed,Pending}, reason }` (e-NACH),
- `pmsCompliance{ aml enum{Not run,Clear,Flagged}, amlOn }` (Flagged ⇒ grey-listed),
- `reportsSent{ [reportName]:{date, email enum{Sent,Delivered,Seen}} }`,
- `invoices[]{ date, desc, amount money, status enum{Paid,Due}, ref }`,
- `calls[]{ when, note, source }`, `tags string[]`, `profileNotes text`, `commPref{channels[],freq,lang,time,dnd}`.

### 3.3 Lead (B2C)
- `id`, `name`, `source`, `stage enum{L1,L2,L3,L4}`, `status`, `rm`, `phone`, `email`, `count int`, `follow date`, `hist[]{type,when}`, `out bool`, `outReason`, `appUser bool`, `flow enum{Self-serve,RM-assisted}`, `qualified bool`, `onbStep int`, `tags string[]`.

### 3.4 OnboardingForm
- `no string` (FORM-xxxx), `mobile` (household key), `holder`, `member`, `relation`, `product`, `leadId`,
- `data{ personal, contact, financial, objective, route{product,rationale}, risk, bank, nominee, decl }`,
- `status enum{Not started,In progress,E-sign sent,Signed}`, `esign{sentTo,when,status}`, `started`, `lastSaved`.
- **One mobile → many forms** (one per account/member).

### 3.5 Supporting entities
`Meeting{id,title,rm,when,dur,attendees[],meet|location,status}`, `Task{id,title,team,type,cid,from,assignee,priority,status,due,thread[]}`, `Email{id,from,to,subject,body,date,read}`, `Tag string`, `Article{id,title,summary,tags[],date}`, `AudienceList{id,name,categories[],cities[],zones[],accounts[],distributors[],rms[],minVal,includeProspects}`, `Event{id,name,lead,colead,date,venue,groups[listId]}`, `ChannelPartner{name,city,email,type enum{Distributor,Wealth Manager,Family Office,IFA/Referral}}`, `PmsFiling{name,freq,source,due,status enum{Pending,Fetched,Uploaded},url,uploadedOn}`, `CustodianReportType{name,freq}`, `B2BLead{id,firm,type,source,city,contactName,phone,email,stage,rm,mode,hist[],notes}`, `AuditLog{id,user,role,cid,field,ts}` (immutable, append-only), `FiuGreyList{pan,reason,ts}`.

---

## 4. Module specs

### 4.1 Lead acquisition & assignment
- **FR-LEAD-1** Capture inbound (web/app/ad) leads with source attribution.
- **FR-LEAD-2** Stages L1→L4; RM logs interactions (call/email/meeting/WhatsApp) incrementing `count` + `hist`.
- **BR-8 Five-Strike:** at L1, after 5 unanswered outreaches → prompt move to Out List (reason required). Re-engagement resets only on a response.
- **FR-ASSIGN-1** Qualifier sees app sign-ups (`appUser && !qualified`), picks best-fit RM (recommendation by language/region/capacity/goal), confirms → creates Google Calendar event + Meet link with client+RM+qualifier (INT-7).
- **EDGE-1** Duplicate lead (same mobile/email) → merge into existing person/household, don't create a second.
- **EDGE-2** Self-serve drop-off → becomes recovery lead in the queue; resumable by mobile.

### 4.2 Onboarding (household, accounts, e-sign)
- **FR-ONB-1** Entry = mobile number. Resolve household; if forms exist, show hub (resume any).
- **FR-ONB-2** Per number, support N accounts (1 each of PMS/RIA/International per person) and family members; each account = its own form + agreement.
- **FR-ONB-3** Form sections incl. advisory routing (product fit). e-sign request at ≥85% completion (BR-9) via DIGIO (INT-1).
- **BR-10** Forms keyed by mobile so self-serve + RM-assisted converge to the same record.
- **EDGE-3** Same mobile starts a 2nd self-serve session → must not fork; reload latest server state (last-write-wins with field-level merge preferred).
- **EDGE-4** e-sign sent but client never signs → status stuck `E-sign sent`; 7-day reminder, then RM task.

### 4.3 Clients, accounts, profiles
- **FR-CLI-1** Clients list = one row per account, grouped by household; quick-view (holdings, CAGR-since-inception, invested/current). CAGR = (current/invested)^(1/years)−1; **EDGE-5** years<0.5 → annualisation inflates % → cap display or show "since inception" absolute when tenure < 1y.
- **FR-PROF-1** Unified profile (lead or client) searchable by name/email/mobile; household accounts + linked leads roll up.
- **FR-PROF-2** Tabs: Accounts (per-account metrics, portfolio graph, strategy perf, holdings, rebalance dates, Reports tab inside the account), Communication prefs, Timeline, Notes.
- **BR-11** Strategy is backend-assigned (read-only in CRM).

### 4.4 Tags & content routing
- **FR-TAG-1** Client tags = pain points/interests; preset + custom.
- **FR-TAG-2** AI suggests tags from notes + meeting transcripts (NLP/LLM) the RM hasn't added; RM confirms (human-in-loop, BR-12 — never auto-apply).
- **FR-CONTENT-1** Marketing tags an article; system auto-delivers to clients whose tags intersect (INT-6 email). Profile shows delivered content; article shows reach.
- **EDGE-6** Tag renamed/deleted → keep references; don't orphan delivered-content history.

### 4.5 Calendar, reminders, scheduling
- **FR-CAL-1** Meetings sync with Google Calendar; online → Meet link, visit → location.
- **FR-CAL-2** Conflict detection per RM (overlapping non-done meetings).
- **FR-REM-1** Pop-up + push reminder **10 min before** each call (client-side timer + server push/FCM).
- **FR-SCHED-1** RM/Distributor schedule with any client/lead/colleague; organizer = current user; scoping by `mine()`.

### 4.6 Tasks & requests
- **FR-TASK-1** Cross-team handoff; board Open/In-Progress/Blocked/Done; activity log; **BR-13** reassignment requires a reason (audited).

### 4.7 Inbox / email
- **FR-MAIL-1** Per-user Inbox/Sent keyed on the user's address; compose delivers to recipient inbox; reply pre-fills; unread badge.
- **INT-8** Outbound via Gmail API / transactional ESP; inbound via IMAP/webhook. **EDGE-7** bounced/failed send → mark failed + notify sender.

### 4.8 Client reports
- **FR-RPT-1** Per client: Monthly (holdings, trades, P&L, valuation, commentary + **fee invoice attached**), Half-yearly, Tax (STCG/LTCG/dividends, ITR-ready).
- **FR-RPT-2** Each send logs **delivery, open, acknowledgement** receipts (INT-6) and is retained.
- **BR-14 Schedule:** Monthly by 1st of following month; Half-yearly end-Sep & end-Mar; Tax in April for prior FY. Scheduler auto-generates + dispatches (§6).
- **FR-RPT-3 Annual risk refresh:** 12-month trigger to re-do risk questionnaire; if no response in 14 days → flag RM (BR-15).

### 4.9 Marketing
- **FR-MKT-1** Audience Lists with multi-select filters (category, city, zone, account type, distributor, RM, min AUM, include-prospects); live count; pool includes channel partners.
- **FR-MKT-2** Events (lead, co-lead, groups=lists, dedup invitee count). **FR-MKT-3** Content (tag → auto-route, §4.4).

### 4.10 Distributor / WM portal (external)
- **FR-DIST-1** Scoped to `distributor==partner`; RM-style dashboard (AUM, net gain, clients, reviews-due), clients, strategies, calendar, reviews, IPS, invoices (range filter incl. past 3y, per-invoice + bulk CSV download).
- **FR-DIST-2** Contact "your Flameback RM" (call/email/WhatsApp). **BR-16** external partner can't see other partners' clients or internal-only fields.

### 4.11 RIA Compliance
- **FR-RIA-1 KYC file (per client):** account-opening form; KYC **verified via DIGIO** (PAN/name/DOB/Aadhaar e-KYC — no manual uploads, INT-1); CKYC/KRA; disclosure; risk profile; agreement PDF; suitability (IPS) send; demat access (client-granted, read-only, BR-7). Verify / Raise-to-RM.
- **FR-RIA-2 Monthly SEBI report:** SEBI-reg-no + timestamp header; PDF export; summary (active/compliant/pending/gaps); table of green/amber/red across SEBI items i–x; per-client drill-down (identity with PAN/Aadhaar masked, doc links, trade/advice audit trail, report dispatch log, correspondence log).
- **FR-RIA-3 Fee payments:** advisory fee auto-debit (e-NACH, INT-9) status per client; failures show reason; Retry + Raise-to-RM.
- **FR-RIA-4 SEBI RIA daily report:** client register (start date, name, contact, email, product, strategy, PAN, CKYC/KRA proof link, resident status, agreement link, city/state, country, gender). List + CSV export; **submitted daily** (scheduler, §6). Month metrics over 5y: new/exited/active/inactive/total as of month-end. **BR-17** active = funded & not exited; inactive = not funded & not exited; exited = `exitedOn` set.
- **EDGE-8** PAN/Aadhaar shown unmasked only to RIA-Compliance; every unmasked read → AuditLog (NFR-2).

### 4.12 PMS Compliance
- **FR-PMS-1 Review = FIU screening + grey list:** KYC/CKYC/docs done by onboarding partner **outside the CRM**. Officer runs FIU AML by PAN (INT-4); **Flagged ⇒ grey-listed ⇒ cannot onboard** (BR-18).
- **FR-PMS-2 Regulatory filings (fund-level):** SEBI **Monthly PMR** via portal `https://www.sebi.gov.in/sebiweb/other/OtherAction.do?doPmr=yes` (fetch report from custodian INT-5 → upload via portal), APMI submission, PMSBazaar upload; due-date reminders.
- **FR-PMS-3 Custodian reports (per client):** 8 report types (holding statement, transactions, capital gains, corporate actions, NAV/performance, bank book, securities ledger, expense & fee) pulled from custodian (INT-5), sent per client with email delivery/seen tracking (INT-6).

### 4.13 B2B / Partnerships
- **FR-B2B-1** Partner pipeline (distributor/WM/family office/IFA) via Instagram/ads/referral/inbound; firm, type, source, city, stage, RM, mode.
- **FR-B2B-2** Engagement mode by city: same city ⇒ in-person visit recommended; else online meet; schedule either.
- **FR-B2B-3** Head assigns Partnerships RM; Head dashboard (pipeline, per-RM, unassigned). **GAP:** dedicated B2B Qualifier/assignment-queue view (currently Head assigns).
- **FR-B2B-4** On partner onboarded → provision a Distributor portal account (link to §4.10).

### 4.14 Leadership
- **FR-LEAD-HEAD-1** Department toggle (Sales/Investment/Compliance/Operations): throughput, "needs attention" escalations, per-person scorecards.

---

## 5. Integrations catalog

Each integration: trigger, request, response, auth, failure/retry. (All mocked in proto.)

- **INT-1 DIGIO** — e-sign + digital KYC (PAN↔name, DOB, Aadhaar e-KYC OTP). *Trigger:* onboarding e-sign / KYC verify. *Req:* client identity payload. *Resp:* `{kycStatus, panVerified, aadhaarVerified, signedPdfUrl}`. *Webhook:* sign-complete → store `agreementUrl`. *Auth:* API key + webhook HMAC. *Fail:* retry 3×; surface "e-sign pending".
- **INT-2 CKYC registry** — fetch/update CKYC record. *Trigger:* KYC step / correction. *Resp:* `{ckycNo, status}`. (PMS: handled by partner, not CRM.)
- **INT-3 KRA** — KYC Registration Agency status check.
- **INT-4 FIU AML** — *Trigger:* PMS screening. *Req:* `{pan}`. *Resp:* `{match:bool, score, listRef}`. match ⇒ grey list (BR-18). Audit each check.
- **INT-5 Custodian API** — *Trigger:* daily/periodic pull. *Resp:* statement files (Excel/XML) for filings + the 8 per-client reports. *Auth:* mTLS/API key. *Fail:* alert PMS-Compliance, mark filing "fetch failed".
- **INT-6 Transactional email + tracking (e.g. SendGrid/Netcore)** — send client reports/content; capture **delivered / opened / acknowledged** via webhooks. *Idempotency:* per message-id. *Fail:* bounce → mark failed + retry/raise.
- **INT-7 Google Calendar / Meet** — create events, Meet links, invites.
- **INT-8 Gmail / IMAP / ESP** — inbox send/receive.
- **INT-9 Payment / e-NACH (mandate + auto-debit)** — *Trigger:* fee cycle. *Resp:* `{status:Success|Failed, reason}` (insufficient balance, mandate expired, bank declined). Failures → Fee Payments view + RM task. Retry on demand.
- **INT-10 SEBI PMR portal / APMI / PMSBazaar** — fund-level uploads; PMR via the portal URL above (manual portal upload acknowledged; APMI/PMSBazaar API where available).
- **INT-11 WhatsApp Business** — outreach + delivery receipts in correspondence log.
- **INT-12 Supabase** — the live shared Feature-Suggestions board (only non-mocked integration in proto).

---

## 6. Scheduling / background jobs

- **JOB-1** Daily 06:00 — generate & submit **SEBI RIA daily report** (FR-RIA-4); retain + log.
- **JOB-2** Monthly 1st — generate & dispatch client **Monthly reports + fee invoices** (BR-14); update receipts.
- **JOB-3** Monthly — **SEBI PMR** prep (pull custodian INT-5) + due reminder to PMS-Compliance.
- **JOB-4** End-Sep / End-Mar — half-yearly reports; April — tax reports.
- **JOB-5** Periodic — custodian per-client reports auto-send (INT-5/6).
- **JOB-6** Daily — review-due + filing-due reminders; 10-min pre-call reminders (push).
- **JOB-7** Annual — risk-profile refresh trigger; +14-day no-response → RM flag (BR-15).
- **JOB-8** Fee cycle — e-NACH auto-debit run (INT-9); failures → Fee Payments + tasks.

---

## 7. Security, privacy & compliance (DPDP 2023 / SEBI)

- **NFR-1** RBAC enforced at query layer; UI hiding is not sufficient.
- **NFR-2** PAN/Aadhaar (and demat a/c) encrypted at rest (AES-256), keys in a secrets manager separate from app; unmasked access only by designated compliance officer and **every unmasked read is written to an immutable audit log** (user, record, field, timestamp), exportable (CSV/JSON) for SEBI audit; included in the monthly compliance report.
- **NFR-3** DPDP explicit consent captured at registration (distinct from advisory agreement), timestamped, stored immutably.
- **NFR-4** Developers must use anonymised data in non-prod; no raw PII in lower environments.
- **NFR-5** Document store: signed expiring URLs; agreements/reports retained per SEBI retention norms.
- **NFR-6** External partners (distributors) strictly partitioned to their own book.

---

## 8. Cross-cutting edge cases

- **EDGE-9** Household with multiple members sharing one mobile — disambiguate by PAN; never collapse two PANs into one person.
- **EDGE-10** Client holds same product twice — spec says one-each; block/curate.
- **EDGE-11** Exited client — exclude from active counts/reports but keep in register & audit.
- **EDGE-12** Report send to a client with no email / bad email — block send, flag.
- **EDGE-13** FIU grey-listed client somehow reaching onboarding — hard block; alert compliance.
- **EDGE-14** Distributor portal: client reassigned to another distributor — access must follow current `distributor`.
- **EDGE-15** Timezone — all datetimes stored UTC; displayed in IST; cron in IST.
- **EDGE-16** Concurrent edits (RM + onboarding form) — optimistic locking / field-merge.

---

## 9. Non-functional

- **NFR-7** P95 page < 2s; report generation async with progress.
- **NFR-8** Audit log immutable & queryable; 8-year retention.
- **NFR-9** Availability 99.5%; backups + PITR.
- **NFR-10** Accessibility AA; responsive (desktop + tablet).

---

## 10. Acceptance criteria (samples)

- **AC-1** An RM cannot load another RM's client via API even with a guessed id (BR-1, NFR-1).
- **AC-2** A compliance officer revealing a PAN writes exactly one audit entry per reveal; entry appears in the monthly report and CSV export (NFR-2).
- **AC-3** FIU match sets grey list and onboarding is blocked end-to-end (BR-18, EDGE-13).
- **AC-4** Monthly report job dispatches to all active clients with the fee invoice attached and records delivery/open (BR-14, INT-6).
- **AC-5** SEBI RIA daily report runs at 06:00, exports the full register, and month metrics reconcile (new−exited applied to prior active = current active) (FR-RIA-4, BR-17).
- **AC-6** One mobile onboards two accounts + a spouse; three forms/accounts exist under one household (FR-ONB-2).

---

## 11. Open decisions

1. **B2B Qualifier** — add a dedicated qualification queue vs Head-assigns (current). 
2. Lead→client auto-conversion on agreement signed (currently manual/seeded).
3. Report auto-send: full automation vs maker-checker approval before dispatch.
4. International-investing regulatory regime specifics (LRS limits, reporting).
5. Whether Marketing may see client-level PII or only segments.
