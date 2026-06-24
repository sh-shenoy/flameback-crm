# FLAMEBACK CAPITAL — Flameback CRM (Back-Office)
## FUNCTIONAL SPECIFICATION DOCUMENT
Version: 3.0 | June 2026 | CONFIDENTIAL
Prepared by: Shashank Shenoy | Status: Draft for PM sign-off

> Companion to the **Flameback India RIA App** specification (the client-facing application). That product onboards investors; **this CRM is the system Flameback's internal teams use** to acquire, onboard, serve and stay compliant. Where the two meet, the app's post-profile onboarding (KYC / agreement / broker / fee / deployment) hands off into this CRM for the Relationship Manager and Compliance teams.

> **What this document is.** A specification of the **product to be built** — the required behaviour, screens, rules, data and integrations of the Flameback CRM. It is the primary reference for engineering, QA and product sign-off. It describes the target system, not any interim artefact. Visual design and microcopy are owned by the Design Brief; this document owns *behaviour, data and rules*. Items still requiring a product decision are flagged **[PM INPUT]** and consolidated in Section 10.

---

### HOW TO READ THIS DOCUMENT
- **Section 1** — Document Overview & Scope
- **Section 2** — System Architecture, Domain Model & Screen Inventory
- **Section 3** — User Roles, Scoping & Authentication
- **Section 4** — Screen-by-Screen Functional Specifications (the core; 40 screens)
- **Section 5** — Business Logic & Rules
- **Section 6** — Integrations
- **Section 7** — Error Handling
- **Section 8** — Non-Functional Requirements
- **Section 9** — Out of Scope
- **Section 10** — Open Items Requiring PM Sign-Off
- **Section 11** — End-to-End Flows
- **Appendix A** — Domain Entities & Relationships
- **Appendix B** — Glossary, status enumerations & colour legend

**Conventions**
- **"shall"** denotes a mandatory requirement; **"should"** a strong recommendation; **"may"** an option.
- **[PM INPUT]** marks a decision a Product Owner must make before the affected area is built.
- Screen identifiers (**S-01 … S-40**) are stable references used across the document.
- Business-rule identifiers (**BR-***) are referenced from the screen specs.
- Money is Indian Rupees (₹), displayed with Indian digit grouping; dates display in the `en-IN` locale.

---

## 1. Document Overview

### 1.1 Purpose
Defines the complete functional behaviour of the **Flameback CRM** — the internal back-office for Sales, Onboarding (RM-led), Investment, Operations, Compliance (RIA + PMS), Marketing, Partnerships (B2B) and Leadership, plus an external portal for distributors / wealth managers. It specifies what the system must do, the data it must hold, the rules it must enforce, and the external systems it must integrate with.

### 1.2 Scope (in)
The CRM shall cover, end to end:
- **B2C lead acquisition & qualification** — manually created leads and inbound app sign-ups; the five-strike outreach discipline; the Out List; and the Lead Desk assignment/qualification queue.
- **RM-led onboarding** — a mobile-keyed household model, multi-account and multi-family-member onboarding, the onboarding data-capture form, and digital e-signature of the agreement.
- **Clients, accounts & unified profiles** — one record per account, household grouping, the account-detail view, and a person-level profile that consolidates every lead and account associated with a mobile number.
- **Tags & content routing** — client tags (pain points / interests), assisted tag suggestions, and marketing content automatically delivered to clients whose tags intersect an article's tags.
- **Operating tools** — a calendar with video-meeting links and pre-call reminders; reviews & reminders (annual IPS + quarterly portfolio); a cross-team task/request board; an internal mail inbox; and client reporting (monthly / half-yearly / tax).
- **Distributor portal (external)** — an RM-style view scoped to a partner's own book, including invoices.
- **RIA compliance** — a per-client KYC file, the monthly SEBI advisory-compliance report (items i–x), advisory-fee auto-debit (e-NACH) status, and the SEBI RIA daily register.
- **PMS compliance** — FIU AML screening and grey-listing, fund-level regulatory filings (SEBI PMR / APMI / PMSBazaar), and per-client custodian reports.
- **B2B / Partnerships** — a partner-firm pipeline, engagement-mode-by-city, and a Head's oversight dashboard.
- **Leadership oversight** — department throughput, an escalation ("needs attention") feed, and per-person scorecards.

### 1.3 Scope (out)
See **Section 9**. In brief: the client-facing app, a live portfolio-analytics / P&L calculation engine, a rebalancing/execution engine, and HUF / intermediary onboarding are out of scope for the first release.

### 1.4 Audience & assumptions
- **Audience:** product, engineering, QA, compliance reviewers, and the integration partners named in Section 6.
- **Assumption A1 — system of record for holdings.** Portfolio holdings, valuations and returns are sourced from the **custodian / fund administrator**; the CRM is a system of *engagement and compliance*, not a calculation engine. The CRM displays and reports on these figures; it does not compute them. [PM INPUT — confirm the source system, sync cadence and field mapping; see INT-5.]
- **Assumption A2 — the CRM is the system of record for relationship, onboarding and compliance state** (leads, households, onboarding forms, tasks, compliance status, dispatch logs, audit trail).
- **Assumption A3 — identity & permissions are enforced server-side** (Section 3).

### 1.5 Version Log
| Version | Date | Author | Changes |
|---|---|---|---|
| 1.0 | June 2026 | Shashank Shenoy | First CRM functional spec; aligned to RIA App spec format. |
| 2.0 | June 2026 | Shashank Shenoy | Field-level expansion across all 40 screens. |
| 3.0 | June 2026 | Shashank Shenoy | Reframed as a forward-looking **product requirements** specification (the system to be built), in requirements voice; domain model reduced to entities & relationships (detailed attributes deferred to a separate data-design document). |

---

## 2. System Architecture, Domain Model & Screen Inventory

### 2.1 Two motions, role-based
The CRM supports two acquisition motions:
- **B2C** — individuals and families from advertising, the website, referrals, and app sign-ups.
- **B2B / Partnerships** — partner firms (distributors, wealth managers, family offices, IFAs).

Every user operates within a **role**; the role determines both the modules available in navigation and the records the user may see and act on (Section 3). Two structural principles underpin the whole system:

1. **Household = one mobile number.** A person may hold **one account per product** — *PMS Lite (RIA)*, *PMS*, *International investing*; family members are associated under the primary holder's mobile number. Account-level views show **one row per account**; the person-level profile consolidates accounts and leads into a single person.
2. **Scoping.** A Relationship Manager works their own book; a Distributor sees only their own clients; **RIA Compliance** sees RIA clients; **PMS Compliance** sees PMS clients; Investment and Leadership see all. Scoping is a security requirement enforced server-side (Section 3.2, NFR 8.3).

### 2.2 Target architecture (requirements)
- **ARCH-1.** The system shall be a server-backed web application with a persistent database as the system of record for the entities in Appendix A.
- **ARCH-2.** All authorization (role-based access and record scoping) shall be enforced at the API/data layer, never solely in the client (NFR 8.3). The UI may additionally hide controls, but the server is authoritative.
- **ARCH-3.** The system shall maintain an **immutable audit log** for sensitive actions and data access (e.g. unmasked PII views, compliance verdicts, task reassignments, e-sign dispatch); see NFR 8.4.
- **ARCH-4.** The system shall integrate with the external services in Section 6 through a defined integration layer with retry, fallback and webhook/callback handling.
- **ARCH-5.** The system shall be multi-user with concurrent access; concurrent edits to the same record shall be handled safely (last-writer-wins is not acceptable for compliance records — define locking/versioning). [PM INPUT — concurrency policy per entity.]
- **ARCH-6.** Sensitive identifiers (PAN, Aadhaar, demat account, bank account) shall be encrypted at rest; transport shall be TLS 1.2+ (NFR 8.3).

### 2.3 Domain model (overview)
The CRM's core entities and their relationships are summarised below; entity definitions are in **Appendix A**. Detailed attributes, types and validation belong to a separate **data-design document** and are not enumerated here.

- A **Lead** represents a prospective relationship (B2C). An app sign-up is a Lead originating from the client app.
- A **Household** is the set of accounts and family members sharing one **mobile number** (the household key).
- A **Person** is an individual within a household (the primary holder or a family member).
- An **Account** is one product holding for one person (PMS Lite (RIA) / PMS / International). A Person may hold at most one Account per product.
- An **Onboarding Form** captures the data needed to open one Account; it is keyed to the household mobile number and is resumable across sessions and across whoever is assisting.
- A **Meeting** is a calendar event (call, video meeting, or in-person visit) with attendees.
- A **Task** is a cross-team request/ticket with an assignee and an activity thread.
- A **Message** is an internal mail item (inbox/sent), including system-dispatched client communications.
- A **Compliance Record** (RIA) and an **AML Screening** (PMS) track each account's regulatory state.
- A **Report Dispatch** records a report sent to a client and its delivery/open/acknowledgement receipts.
- A **Distributor** is a channel partner; their clients are Accounts attributed to them.
- **Marketing** entities: **Audience List** (a saved segment), **Event**, **Article** (tagged content), and the **Tag** vocabulary.
- **Regulatory Filing** (fund-level) and **Custodian Report** (per-client) track PMS regulatory outputs.
- A **Partner Lead** is a B2B prospect firm in the partnerships pipeline.

Key relationships: Household 1—* Account; Person 1—* Account; Account *—1 Distributor; Account 1—* Report Dispatch; Account 1—1 Compliance Record (RIA) / AML Screening (PMS); Lead *—1 Relationship Manager; Audience List *—* Account; Event *—* Audience List.

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
| ID | Screen | Primary roles | §4 |
|----|--------|---------------|----|
| S-01 | Login / Authentication | All | 4.0 |
| S-02 | Role Dashboard (RM) | RM | 4.1 |
| S-03 | Leads | RM | 4.1 |
| S-04 | Lead Detail | RM | 4.1 |
| S-05 | Assignment Queue | Qualifier | 4.2 |
| S-06 | Qualify & Assign | Qualifier | 4.2 |
| S-07 | Onboarding Journey | RM | 4.3 |
| S-08 | Onboarding — Household Hub | RM | 4.3 |
| S-09 | Onboarding Form | RM | 4.3 |
| S-10 | Clients (accounts) | RM, Investment, Ops, Leadership | 4.4 |
| S-11 | Account Detail | RM, Investment, Ops, Leadership | 4.4 |
| S-12 | Profiles Directory | RM, Investment, Leadership | 4.4 |
| S-13 | Person Profile | RM, Investment, Leadership | 4.4 |
| S-14 | Calendar | RM, Distributor, Investment, Leadership, Qualifier, B2B | 4.5 |
| S-15 | Schedule Meeting / Call | as above | 4.5 |
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
| S-30 | RIA Compliance — KYC File | RIA Compliance | 4.6 |
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

### 3.1 Roles & module access
The system shall support the following roles. Each role has a defined set of accessible modules (its navigation) and a data-scope (Section 3.2).

| Role | Function | Accessible modules |
|---|---|---|
| Relationship Manager (RM) | Owns the B2C relationship: leads → onboarding → service | Dashboard, Leads, Onboarding, Calendar, Reviews, Clients, Profiles, Reports, Invoices, Tasks, Out List, Suggestions, Knowledge Hub, Inbox |
| Qualifier (Lead Desk) | Qualifies inbound app sign-ups and assigns the best-fit RM | Dashboard, Assignment Queue, Calendar, Tasks, Suggestions, Knowledge Hub, Inbox |
| Investment | Portfolios, IPS, reviews across all clients | Dashboard, IPS/Portfolios, Reviews, Clients, Profiles, Reports, Invoices, Calendar, Tasks, Suggestions, Knowledge Hub, Inbox |
| Operations | Account/demat opening, reconciliations, ops tasks | Dashboard, Tasks, Clients, Suggestions, Knowledge Hub, Inbox |
| RIA Compliance | RIA (advisory) compliance | Dashboard, KYC File, Monthly SEBI Report, Fee Payments, RIA Daily Register, Tasks, Clients, Suggestions, Knowledge Hub, Inbox |
| PMS Compliance | PMS compliance | PMS Review, Regulatory Filings, Custodian Reports, Tasks, Inbox, Knowledge Hub |
| Marketing | Segments, events, content | Events, Audience Lists, Content, Calendar, Tasks, Suggestions, Knowledge Hub, Inbox |
| Distributor / Wealth Manager (external) | A channel partner's own book | Dashboard, Clients, Reports, Invoices, Calendar, Reviews, IPS, Strategies, Inbox |
| Partnerships RM (B2B) | Works assigned partner-firm leads | Partner Pipeline, Calendar, Tasks, Inbox, Knowledge Hub |
| Partnerships Head (B2B) | Assigns Partnership RMs, oversees the B2B pipeline | B2B Dashboard, Partner Pipeline, Calendar, Tasks, Inbox, Knowledge Hub |
| Leadership / Dept Heads | All-up oversight across departments | Leadership, Clients, Profiles, Reports, Invoices, Tasks, KYC File, IPS, Reviews, Calendar, Leads, Out List, Suggestions, Knowledge Hub, Inbox |

- **[PM INPUT].** Confirm whether a single user may hold more than one role, and how module access composes if so.

### 3.2 Data scoping (record visibility)
The system shall enforce the following record scoping server-side:

| Role | Scope |
|---|---|
| RM | Own leads, clients, calendar, reviews, reports (records where the RM is the owner). |
| Distributor | Only accounts attributed to that distributor. |
| RIA Compliance | Only RIA-track accounts. |
| PMS Compliance | Only PMS-track (PMS + International) accounts. |
| Investment, Leadership | All records. |
| Qualifier | The assignment queue (unqualified app sign-ups) and own calendar. |
| Partnerships RM | Own partner leads. |
| Partnerships Head | All partner leads. |
| Marketing | Segments and aggregates (client-level PII access is a decision — see open item #10). |

- **BR-SCOPE-1.** A user shall not be able to retrieve, by any means, a record outside their scope; out-of-scope access attempts shall be denied at the API and logged (7.1).
- **[PM INPUT].** Ratify the full scope matrix per role × entity, including edit (not just view) rights — e.g. may Investment edit a client? May Operations open a client with no RM relationship? Which roles see PII unmasked (open item #8)?

### 3.3 Authentication
- **BR-AUTH-1.** RBAC shall be enforced at the API/data layer (Section 3.2), not only in the UI.
- **[PM INPUT — internal auth].** SSO (Google Workspace) vs email + password + MFA for staff. Define session timeout, MFA policy, password policy, and de-provisioning on exit.
- **[PM INPUT — external auth].** The distributor portal requires a credentialed login distinct from staff SSO. Define new-partner provisioning, password reset, and whether multiple users per distributor firm are supported.
- **[PM INPUT — identity → role].** How a user maps to one or more roles, and how role membership is administered (from the identity/HR source).

### 3.4 Personnel & teams
- **BR-ORG-1.** RMs, team members, and partnership RMs (with their base cities, used by BR-B2B-1) shall be sourced from the organisation's identity/HR system, not maintained ad hoc within the CRM.
- **[PM INPUT].** Confirm the team taxonomy (RM / Compliance / Operations / Investment / Marketing / Partnerships) and the joiner/mover/leaver process.

---

## 4. Screen-by-Screen Functional Specifications

Each screen is specified with: **Purpose · Entry & navigation · Scope · What it presents · Fields/inputs · Actions · Rules · States (empty/error) · Decisions ([PM INPUT])**, omitting any sub-section that does not apply. "Presents" describes required content; "Actions" describes required behaviour; "Rules" cross-references Section 5.

### 4.0 · S-01 — Login / Authentication
- **Purpose.** Authenticate the user and establish their role(s) and data scope.
- **Requirements.** The system shall authenticate staff and external partners (Section 3.3), resolve the user to one or more roles, and present only the modules and records permitted by that role (Sections 3.1–3.2). On sign-in the user lands on their role's default module.
- **[PM INPUT].** Auth method, MFA, session policy, partner provisioning (Section 3.3).

---

### 4.1 · Sales (RM) & Role Dashboards

#### S-02 / S-40 — Role Dashboard
The dashboard is role-specific: a set of KPI tiles and one priority worklist, scoped to the user. Each KPI tile shows a label, a value, a one-line caption, and a proportional indicator. Required content per role:

**RM dashboard.** KPI tiles, all scoped to the RM:
| Tile | Value |
|---|---|
| Active leads | count of the RM's active (non-out-listed) leads |
| Hot leads | leads with status *Hot* |
| Onboarding + | leads at stage L3 or L4 |
| Follow-ups due | leads whose follow-up date is today or earlier |
| Reviews due this week | the RM's funded clients with an annual or quarterly review due within 7 days |

Worklist: **Follow-ups due today & overdue** — for each due lead: name, RM, stage, status, last-interaction type, follow-up date; selecting a row opens the Lead Detail (S-04); a link opens the full Leads list (S-03). Empty state: a positive "no follow-ups due" message.

**Qualifier dashboard.** Tiles: awaiting qualification (unqualified app sign-ups), recovery (self-serve drop-offs), meetings today (all RMs), RM availability/capacity. Worklist: leads awaiting assignment with a *qualify & assign* action (S-06). [PM INPUT — "RM availability" must reflect real capacity, not a fixed number.]

**RIA Compliance dashboard.** Tiles over RIA clients: pending verification, flagged, verified, open compliance tasks. Worklist: clients needing verification (name, client id, PAN, status) linking to the KYC File (S-30).

**Operations dashboard.** Tiles over Operations tasks: open, in progress, blocked, completed. Worklist: the operations queue (S-17).

**Investment dashboard.** Tiles: funded portfolios, AUM (Σ current value of funded clients), reviews due this week, open investment tasks. Worklist: reviews due this week (S-16).

**Distributor dashboard.** See S-26 (4.7).

- **Rules.** "Due" and "this week" are defined in BR-METRIC-* (Section 5.4). All counts respect the user's scope (Section 3.2).
- **[PM INPUT].** Confirm each KPI's precise definition (e.g. follow-up due = date ≤ today; review due = within rolling 7 days vs calendar week).

#### S-03 — Leads
- **Purpose.** Work the active B2C pipeline.
- **Scope.** The RM's leads, excluding app sign-ups not yet qualified (those remain in the Assignment Queue, S-05, until qualified).
- **Presents.** A filterable table; for each lead: name (with a comment preview), source, status, stage (L1–L4), owning RM, last-interaction type, interaction count, a **five-strike indicator**, and follow-up date.
- **Filters.** Free-text search (name, RM, comments); stage; status; source. Filters combine (AND).
- **Actions.** Selecting a lead opens Lead Detail (S-04).
- **Rules.** Five-strike indicator per BR-LEAD-2. Empty state when no lead matches the filters.

#### S-04 — Lead Detail
- **Purpose.** Create or edit a lead; log outreach; drive stage/status; initiate onboarding or out-listing.
- **Presents/Fields.** Name (required), source, status, stage, owning RM, last-interaction type, comments, follow-up date; an interaction counter; a five-strike indicator; and the dated interaction history.
- **Actions.**
  - **Log interaction** (Call / Email / Meeting / WhatsApp): increments the interaction count, records the dated interaction, and updates the five-strike indicator.
  - **Save:** validates that the name is present; persists the lead.
  - **Start onboarding** (RM only, saved & non-out-listed leads): begins the onboarding flow (S-08).
  - **Move to Out:** out-lists the lead with a required reason (default reason "Five-Strike Rule").
  - **Delete:** removes the lead after confirmation. [PM INPUT — who may delete; retention vs soft-delete.]
  - **Dismiss five-strike:** keeps the lead in the pipeline and re-grades a Cold/New lead to *Potential*.
- **Rules.**
  - **BR-LEAD-2 (five-strike):** at stage L1, when the interaction count reaches 5 with no progress, the system flags the lead for the Out List and surfaces a prompt. Applies only at L1. Logging a genuine response clears the dismissal so the prompt can recur on the next strike.
  - Setting status *Not Interested* out-lists the lead on save.
- **[PM INPUT].** Whether five strikes is a hard cap or advisory; whether the interaction count should be system-derived from real channels (telephony, WhatsApp Business, email) rather than manually logged.

#### S-20 — Out List
- **Purpose.** Hold leads removed from the active pipeline (five-strike or "not interested"), with the ability to revive.
- **Presents.** For each out-listed lead: name, source, RM, interaction count, out-reason, last interaction date.
- **Actions.** **Restore** returns the lead to the active pipeline (a "not interested" lead returns as Cold).

---

### 4.2 · Lead Desk (Qualifier)

#### S-05 — Assignment Queue
- **Purpose.** Route inbound app sign-ups to the best-fit RM and book the introductory meeting.
- **Scope.** App sign-ups not yet qualified.
- **Presents.** For each sign-up: name (with a *recovery* flag for self-serve drop-offs), contact (phone, email), source, flow (self-serve vs RM-assisted), the recommended RM with the reason, the current onboarding step, and a *qualify & assign* action (S-06).

#### S-06 — Qualify & Assign
- **Purpose.** Confirm the RM and schedule the intro meeting.
- **Fields.** RM (defaulted to the recommendation), meeting date (default: next day), meeting time. A preview shows the recommendation rationale, the generated video-meeting link, and the attendee list (client, RM, qualifier).
- **Actions.** **Confirm:** requires a meeting date; marks the lead qualified, assigns the RM, advances the lead (status *Potential*, stage L2, onboarding step ≥ "Choosing path"), and **creates the intro meeting** (default 30 minutes) with a video link and invites to client, RM and qualifier.
- **Rules.**
  - **BR-DUP-1:** a sign-up whose mobile number already exists should attach to the existing person/household rather than create a duplicate. [PM INPUT — confirm auto-merge behaviour; open item #15.]
  - **BR-ASSIGN-1 (best-fit recommendation):** the system shall recommend an RM. [PM INPUT — define the algorithm: language, region, capacity, referrer continuity. The recommendation must be explainable (show the reason).]
- **[PM INPUT].** Default meeting duration; whether the qualifier is always an attendee.

---

### 4.3 · Onboarding (RM only)

#### S-07 — Onboarding Journey
- **Purpose.** A funnel view and a worklist of leads in onboarding.
- **Presents.** A funnel across the onboarding steps — *Captured details, Authenticated, Choosing path, In progress, Advisory routing, Sign agreement, Fund account, Onboarded* — with counts; and a worklist of in-flight leads (name, flow, current step, RM) with a **Start / Resume onboarding** action and, where a household already has accounts in progress, a count of those accounts.

#### S-08 — Onboarding — Household Hub
- **Purpose.** Manage every account and family member associated with one mobile number.
- **Entry.** Starting onboarding prompts for the **mobile number first**; an existing number auto-populates and shows existing accounts.
- **Presents.** The household keyed by the mobile number; a list of every account on the number, each showing product, member name, relationship, completion status and a **Resume** (with % complete) or **Open** action; and a form to **add an account** or **add a family member** (holder name, relationship, product).
- **Rules.**
  - **BR-HH-1:** the mobile number is the household key; a person may hold at most one account per product; family members are associated under the primary holder's number; account views show one row per account.
  - **BR-HH-2:** onboarding forms are keyed by mobile number and are **resumable** — a self-serve start, another RM's start, and a resume all converge on the same form set, never a fork.
- **Validation.** The mobile number must be a valid 10-digit number; an account requires a member name.
- **[PM INPUT].** Whether a person may hold two accounts of the same product; the exact product and relationship lists; whether the mobile number is OTP-verified.

#### S-09 — Onboarding Form
- **Purpose.** Capture everything required to open and fund one account, ending in e-signature of the agreement.
- **Presents.** A sectioned form with a live completion indicator; each completed section is marked done. The form captures the following groups of information:
  1. **Personal** — full name, date of birth, gender, PAN, Aadhaar, nationality.
  2. **Contact & address** — mobile (linked to the household), email, address, city, state, PIN.
  3. **Financial profile** — occupation, income band, net-worth band, source of funds.
  4. **Investment objective** — goal, time horizon, initial investment, SIP amount.
  5. **Advisory routing (product fit)** — product and the rationale for the routing.
  6. **Risk profile** — the risk questionnaire responses and the resulting risk band.
  7. **Bank & demat** — bank, account number, IFSC, demat/broker status.
  8. **Nominee** — name, relationship, share %.
  9. **Declarations & FATCA** — PEP status, tax-residency, and required consents (terms, privacy, risk disclosure, fee schedule).
- **Actions.**
  - **Save** at any point; partially complete forms persist and resume later.
  - **Send for e-signature** — sends the investment-management agreement to the client for digital signature (INT-1) and records the dispatch; advances the lead (onboarding step "Sign agreement", stage L3, status *Onboarding*).
  - **Record signature** — on completion of e-signature, advances the lead (step "Fund account", stage L4).
- **Rules.**
  - **BR-ONB-1 (e-sign gate):** the agreement cannot be sent for signature until the form is at least 85% complete. [PM INPUT — confirm whether a **mandatory-field** rule should gate e-sign instead of, or in addition to, a percentage.]
  - **BR-ONB-2 (resumability):** a drop-off resumes the same form (BR-HH-2).
  - **BR-ONB-3 (pending e-sign):** an agreement sent but not signed shall trigger a reminder and, if still unsigned, an RM follow-up task. [PM INPUT — cadence and escalation.]
- **Decisions — [PM INPUT, significant].**
  1. Ratify the **authoritative field list** above against the RIA App spec and SEBI/KYC requirements, and which fields are **mandatory**.
  2. **Lead → client conversion (open item #3):** define whether completing e-signature **automatically creates the Account** (client record), who assigns the account id, and how product, strategy, distributor and segment are set.
  3. DIGIO field mapping for the agreement and e-KYC (INT-1); optional Account-Aggregator import of financials (INT-12).
  4. Where captured data flows (the client/account record, the KYC file, the custodian).

---

### 4.4 · Clients & Profiles

#### S-10 — Clients
- **Purpose.** The account register — one row per account, grouped by household.
- **Scope.** Per Section 3.2 (RM = own; Distributor = own; Investment/Ops/Leadership = all).
- **Presents.** A filterable, sortable table; for each account: client id, name (with a relationship indicator and, for a family member, a "linked to <holder>" note), contact, RM, product, billing plan, lifecycle stage, invested amount, current value, and gain (current − invested, signed and colour-coded). A per-row **quick view** summarises holdings, return since inception, and invested/current value. Accounts within a household sort together.
- **Filters.** Free-text search (id, name, contact, RM, household holder); billing plan; lifecycle stage; product.
- **Actions.** Selecting a client opens the Account Detail (S-11).
- **[PM INPUT].** Define the canonical account lifecycle stages and how each is derived from real state (funded? agreement signed? KYC complete?).

#### S-11 — Account Detail
- **Purpose.** The full view of one account.
- **Presents.** A header (name, product, client id, contact, RM; for a family member, the household holder and relationship), a lifecycle stepper, and a "next step" prompt. The detail is organised into the following tabs:
  1. **Overview** — *Client information* (read-only, sourced from the admin/onboarding system): sign-up date, name, DOB, profession, contact, WhatsApp, email, country, postal code, source, broker status. *Account & engagement*: **RM** and **billing cycle** (editable by permitted roles), questionnaire status, agreement status, recommended strategies (read-only — see BR-STRAT-1), investment goal, SIP status.
  2. **Investment & SIP** — goal, billing cycle, recommended strategies, and SIP details (strategy, frequency, start, amount) or a "no SIP" state.
  3. **Risk Profile & Agreement** — the risk-profile questionnaire (status + download) and the client agreement (download signed copy when signed; send for signing otherwise), plus a link to the latest invoice.
  4. **Portfolio** — invested amount, current value, gain, absolute return, IRR; the holdings table; and, where present, a **reconciliation suspense** alert listing unreconciled positions with an option to notify the client. All portfolio figures are sourced from the custodian (A1).
  5. **Reports** — the downloadable account reports (holding statement, capital-gains/tax, strategy performance, fund flows, basic information).
  6. **Invoices** — the account's invoices (date, description, amount, status) with per-invoice and bulk (CSV) download.
  7. **Call Sync** — follow-ups synced from the connected calendar, with an option to schedule a new one.
- **Actions.** Edit the permitted account fields (RM, billing cycle); send the agreement for signing; download reports/invoices; notify the client of a suspense item.
- **Rules.**
  - **BR-STRAT-1:** strategy is **backend-assigned and read-only in the CRM**; the RM cannot change it. Only the read-only "recommended strategies" display appears on the account.
  - **BR-KYC-OWN-1:** KYC viewing/editing is a **Compliance** function (S-30); the account page does not provide KYC editing.
  - **BR-METRIC-1 (CAGR):** for accounts under one year, show *return since inception* rather than annualised CAGR.
- **[PM INPUT].** Which roles may edit which account fields (open item #11); the definitions and generators of the account reports (INT-5/INT-6); the source system for the read-only "client information" block.

#### S-12 — Profiles Directory
- **Purpose.** One searchable directory of every person — leads and clients unified.
- **Presents.** A searchable list of people; for each: name + email, kind (Client / Lead), phone, RM, and account count.
- **Rules.**
  - **BR-PROFILE-1 (consolidation):** the system shall consolidate all accounts and leads that share a mobile number into a single person; the primary holder is canonical for the person's identity. Leads with no account appear as prospects.
  - Scope per Section 3.2 (an RM sees people connected to their book).
- **Actions.** Selecting a person opens the Person Profile (S-13).

#### S-13 — Person Profile
- **Purpose.** The person-level relationship view across all their accounts and history.
- **Presents.** A header (name, kind, phone, email; DOB, RM, source, account count) and the following tabs:
  - **Accounts** — one card per account: product, current value, invested, CAGR/return, a performance chart, per-strategy performance, holdings, last rebalance information, and a link to the Account Detail (S-11). RIA accounts show "rebalance proposal sent / rebalanced by client"; PMS accounts show "last rebalanced".
  - **Communication** — contact preferences: channels (email/WhatsApp/SMS/phone), frequency, language, preferred time, do-not-disturb.
  - **Timeline** — a unified, reverse-chronological history: outreach, lifecycle events (onboarded, funded, rebalanced) and calls.
  - **Notes** — free-text relationship notes (family, interests, context).
  - **Tags** — the person's tags (pain points/interests); add from the vocabulary or create new; **assisted suggestions** the RM may accept; and the list of content auto-shared with this person by tag match.
- **Rules.**
  - **BR-TAG-1 (assisted suggestions):** tag suggestions are advisory and require human confirmation; they are never auto-applied.
  - **BR-CONTENT-1 (content routing):** a person receives an article when the article's tags intersect the person's tags (see S-25).
- **[PM INPUT].** The source for assisted tag suggestions (notes / meeting transcripts / transcription provider); whether tags are treated as sensitive personal data; the preset tag vocabulary.

---

### 4.5 · Operating tools

#### S-17 — Tasks & Requests
- **Purpose.** A cross-team request/ticket system with handoffs and an auditable activity thread.
- **Presents.** A board (columns **Open / In Progress / Blocked / Done**) and an equivalent list. Each task carries: title, owning team, type, linked client, requester, priority, status, due date, assignee (or "whole team"), notes, and an activity thread.
- **Fields (create/edit).** Title (required), team (which constrains the type and assignee options), type, linked client, priority, due date, notes, assignee, and — when reassigning — a **reassignment reason**.
- **Actions.** Create; edit; change status (board drag or control); add a thread comment.
- **Rules.**
  - **BR-TASK-1 (reassignment reason):** reassigning a task (changing team or assignee) requires a reason, which is recorded immutably in the thread.
  - **BR-TASK-2 (audit thread):** status changes and reassignments are recorded as system entries in the thread.
- **[PM INPUT].** The team/type taxonomy; whether reassignment-reason is a hard block (recommended) or an audit acknowledgement.

#### S-14 — Calendar & S-15 — Schedule Meeting / Call
- **Purpose.** Manage meetings (calls, video meetings, in-person visits) and surface scheduling conflicts.
- **Scope.** RM sees own; Distributor sees own and meetings involving their clients; Investment/Leadership see the team calendar.
- **Presents.** Meetings grouped by day (Today/Tomorrow/date), each with time, duration, status, title, owning RM, attendees, and a join link for video meetings; overlapping meetings are flagged as conflicts with a reschedule action.
- **Schedule.** Fields: title (required), date, time, duration, type (video vs phone), the primary invitee, and colleagues; a preview of the meeting link and attendee list.
- **Actions.** Create the meeting with a video link and calendar invites (INT-7); reschedule a conflicting meeting.
- **Rules.**
  - **BR-CAL-1 (conflict detection):** the system shall detect and flag time-overlapping meetings.
  - **BR-CAL-2 (pre-call reminder):** the system shall remind the owner ~10 minutes before a call/meeting, with options to join, snooze, or dismiss. [PM INPUT — production reminders must be server-driven across channels (NFR 8.5), not a client-only timer.]
- **[PM INPUT].** Calendar/video provider (INT-7): invite creation, attendee emails, time-zones; whether reschedule proposes slots rather than defaulting to the next day.

#### S-16 — Reviews & Reminders
- **Purpose.** Surface portfolio/IPS reviews due and let the RM act.
- **Scope.** The user's funded clients.
- **Presents.** A summary of reviews due this week, then rows for each client (name → profile, RM, last reviewed, overdue/this-week status with the due date) and actions.
- **Actions.** **Schedule call** (creates a review meeting with an invite); **send reminder** (opens a pre-filled message to the client); **view IPS** (the Investment Policy Statement: investor profile, objective, target allocation, recommended strategies, benchmark, constraints/liquidity, review schedule); **email IPS**; **mark reviewed** (records the review and sets the next due date — annual +1 year, quarterly +1 quarter).
- **Rules.**
  - **BR-REVIEW-1 (cadence):** annual IPS review and quarterly portfolio review per client.
  - **BR-REVIEW-2 (annual risk refresh):** the risk profile is refreshed annually; if the client does not respond within 14 days, the system shall flag the RM. [PM INPUT — trigger, channel, and resulting task/alert; this is a required automation.]

#### S-18 — Inbox
- **Purpose.** Internal mail with the client and colleagues, including system-dispatched communications.
- **Scope.** Per user (Inbox = messages addressed to the user; Sent = messages from the user).
- **Presents.** Inbox/Sent views, an unread indicator, message list (sender/recipient, subject, snippet, timestamp), and a reader.
- **Actions.** Compose; reply (quoting the original); send.
- **Rules.** System-dispatched communications (reports S-19, IPS sends, agreement sends, custodian reports S-36) are recorded as messages and, where addressed to a client, appear in the client's correspondence.
- **[PM INPUT].** Mailbox integration (INT-8): send/receive, threading, attachments (reports/invoices/agreements must be attached), and capturing inbound client replies against the client record.

---

### 4.6 · Reporting & Compliance

#### S-19 — Client Reports
- **Purpose.** Per client, view and send the Monthly, Half-yearly and Tax reports, with delivery tracking.
- **Scope.** The user's clients.
- **Presents.** Per client, the last-sent date for each report type, and a view/send panel.
  - **Monthly** — current valuation, invested, P&L, holdings summary, the period's trades, advisor commentary, and the fee invoice for the period.
  - **Half-yearly** — as monthly, over the half-year.
  - **Tax** — STCG, LTCG and dividend income for the financial year, formatted ITR-ready.
- **Actions.** **View** a report; **Send** a report — on send, the system records the dispatch with delivery/open (and, for tax, acknowledgement) receipts, and the report is delivered to the client and recorded in correspondence.
- **Rules.**
  - **BR-DISPATCH-1 (schedule):** Monthly by the 1st of the following month; Half-yearly end-September and end-March; Tax in April for the prior financial year (BR-SCH-1).
  - **BR-DISPATCH-2 (figures):** report figures (valuations, P&L, capital-gains, fee amounts) are sourced from the custodian/fund administrator and the fee engine (A1, INT-5).
- **[PM INPUT].** **Dispatch model (open item #4):** auto-send on schedule vs **maker-checker** approval before sending. Report templates/branding; the delivery-tracking provider (INT-6); whether the generated document is attached.

#### S-30 — RIA Compliance · KYC File
- **Purpose.** A per-RIA-client compliance file with a verification checklist and RM escalation.
- **Scope.** RIA-track clients only.
- **Presents.** Per client: a compliance status (Verified / Flagged / Pending) and a checklist grouped as:
  - **Account-opening details** — name, email, mobile, residential address.
  - **KYC (digital, via DIGIO)** — PAN & identity, Aadhaar e-KYC, date of birth, CKYC registration, KRA status. Verified digitally; **no manual document uploads and no CRM-versus-document matching** (BR-KYC-1).
  - **Agreement, disclosure & risk** — disclosure accepted; risk profile (and whether communicated to the client); the digitally signed agreement (with a link to the signed document); welcome kit dispatched.
  - **Suitability & demat** — the suitability assessment (IPS) with a "send to client" action; and demat/trading access, which is **client-granted, read-only, and not revocable by Flameback** (BR-DEMAT-1) — the officer records the grant.
  Each checklist item shows complete/pending, derived from the underlying record.
- **Actions.** **Mark verified**; **raise to RM** (flags the client and raises an RM task to resolve the discrepancy); **send IPS to client**; **record the client's read-only demat grant**.
- **Rules.**
  - **BR-KYC-1:** RIA KYC is verified digitally (DIGIO e-KYC for PAN/name/DOB/Aadhaar); the system does not collect manual proofs or perform a document-match step.
  - **BR-DEMAT-1:** demat access is client-granted, read-only, and cannot be revoked by Flameback; the CRM only records it.
- **[PM INPUT].** DIGIO/CKYC/KRA status fields and the precise complete/incomplete rule per item (INT-1/2/3); the legal definition of "complete"; which role may mark verified.

#### S-31 — Monthly SEBI Report
- **Purpose.** The monthly SEBI advisory-compliance report across all RIA clients, with per-client drill-down and export.
- **Presents.** A header bearing the firm's SEBI registration number and a generation timestamp; summary tiles (active clients, fully compliant, pending items, gaps); and a matrix of each client against the ten SEBI items, each shown green/amber/red:

| # | SEBI item |
|---|---|
| i | Client agreement |
| ii | Client disclosure document |
| iii | Risk profile questionnaire (and communicated) |
| iv | Boarding letter / welcome kit |
| v | Rationale for investment advice |
| vi | KYC & CKYC documents |
| vii | Client correspondence |
| viii | Suitability assessment / financial plan |
| ix | Investment advice record |
| x | Invoice issued |

- **Drill-down.** Per client: the i–x status; client identity (with **PAN and Aadhaar masked**); document links (signed agreement, risk questionnaire, suitability, financial plan); the trade & advice audit trail (advice, approval token, broker order id, confirmation); the report dispatch log; and the correspondence log.
- **Actions.** Export the report (PDF).
- **Rules.**
  - **BR-COMP-1 (status):** an item is green when its record is complete, amber when in progress, red when missing (per-item rules in 5.5); a client is fully compliant only when all items are green (any red ⇒ gap; else any amber ⇒ pending).
  - **BR-PII-1 (masking & audit):** PAN/Aadhaar are masked by default; unmasked viewing is restricted to the compliance officer and **every unmasked view is written to the immutable audit log** and included in the monthly report (NFR 8.4).
- **[PM INPUT].** The firm's SEBI registration number; ratify each item's "complete" rule against SEBI's requirement; the unmask-with-audit interaction and the masking matrix per role (open item #8).

#### S-32 — Fee Payments (e-NACH)
- **Purpose.** Track advisory-fee auto-debit per funded RIA client.
- **Presents.** Tiles (collected, failed, on auto-debit) and a table: client, amount, debit date, status (success/failed), and failure reason. Failed rows offer **retry** and **raise to RM**.
- **Rules.**
  - **BR-FEE-1:** advisory fees are collected by e-NACH auto-debit; the system shows each cycle's status and failure reason and supports retry / escalation.
- **[PM INPUT].** e-NACH/PSP integration (INT-9); the **fee computation source** and **debit cadence** (per billing plan?); retry policy; mandate lifecycle (open item #12).

#### S-33 — SEBI RIA Daily Report
- **Purpose.** The SEBI RIA client register, with a month view and export.
- **Presents.** A month selector (with a multi-year range); metric tiles for the selected month — new added, exited, active, inactive, total on books; and the register, one row per client: start date, name (with an exited indicator), contact, email, product, strategy, PAN, CKYC/KRA proof link, resident status, agreement link, city, state, country, gender.
- **Actions.** Export the register (CSV).
- **Rules.**
  - **BR-METRIC-3 (register):** active = funded & not exited; inactive = not funded & not exited; exited = an exit date is set; counts taken as of month-end; new/exited keyed to the selected month.
- **[PM INPUT].** Confirm the SEBI-mandated column set and definitions; PAN appears unmasked here — confirm authority and audit-logging (BR-PII-1).

#### S-34 — PMS Review (FIU / grey list)
- **Purpose.** The PMS compliance officer's in-CRM responsibility: FIU AML screening by PAN. KYC/CKYC/document checks for PMS are performed by the onboarding partner **outside the CRM**; the CRM states this clearly and does not duplicate them.
- **Scope.** PMS-track clients.
- **Presents.** Tiles (PMS clients, FIU cleared, grey-listed) and a table: client (with product), PAN, FIU AML result (not screened / clear / flagged with date), and onboarding eligibility (eligible vs **grey-listed — cannot onboard**), with a **run/re-run FIU check** action.
- **Rules.**
  - **BR-PMS-1 (grey list):** an FIU AML match grey-lists the client and **hard-blocks onboarding** until cleared.
- **[PM INPUT].** FIU/AML provider and match logic (INT-4); the grey-list clearance workflow (authority, evidence); the hand-off boundary with the onboarding partner and how the CRM learns a PMS client's KYC is complete.

#### S-35 — Regulatory Filings
- **Purpose.** Track fund-level regulatory filings.
- **Presents.** The filings — **SEBI Monthly PMR** (filed via the SEBI portal), **APMI**, and **PMSBazaar** — each with frequency, source (custodian vs CRM), due date, and status; tiles for tracked / due this week / overdue / uploaded.
- **Actions.** **Fetch** the data from the custodian (where the source is the custodian); **upload/submit** (opening the SEBI portal for the PMR) and mark the filing submitted with a date.
- **Rules.**
  - **BR-FILING-1:** PMR, APMI and PMSBazaar are **fund-level/firm-wide**, not per client.
- **[PM INPUT].** Custodian data mapping for the PMR (INT-5); the PMR portal submission/confirmation flow (INT-10); APMI/PMSBazaar formats and credentials.

#### S-36 — Custodian Reports
- **Purpose.** Per-PMS-client dispatch of the custodian reports with delivery tracking.
- **Presents.** The eight custodian reports — holding statement, transaction statement, capital-gains statement, corporate-actions report, NAV/performance report, bank book, securities/demat ledger, expense & fee statement — each with frequency and an auto-send flag; a per-client view showing each report's last-sent date and delivery status (pending / delivered / seen); plus firm-level tiles (PMS clients, reports sent, report types).
- **Actions.** Send an individual report or **send all** to a client; delivery and open status are tracked.
- **Rules.**
  - **BR-FILING-2:** custodian reports are **per client** (distinct from the fund-level filings in S-35).
- **[PM INPUT].** The custodian source for each report (INT-5); the email tracking provider distinguishing delivered vs seen (INT-6); whether auto-flagged reports dispatch on schedule.

---

### 4.7 · Distributor / Wealth Manager portal (external)

A distributor receives an RM-style experience scoped to their own book; the only difference from an internal RM is that the RM they contact is Flameback. All distributor screens are scoped to accounts attributed to that distributor.

#### S-26 — Distributor Dashboard
- **Presents.** Tiles: AUM with Flameback (Σ current value), total invested (across N clients), net gain (with return %), client count, and reviews due this week. A "your clients" list (client → profile; city; current AUM; CAGR; next review) and a "contact your Flameback RM" affordance.

#### S-27 — Distributor Clients
- **Presents.** The distributor's clients: client id, name, city, current AUM, CAGR, product; selecting one opens the profile.

#### S-28 — Distributor Strategies
- **Presents.** Per strategy: 1-year, 3-year and since-inception performance, and the count of the distributor's clients in that strategy with their AUM.
- **[PM INPUT].** Strategy performance is sourced from the performance system (open item #13).

#### S-29 — Distributor Invoices
- **Presents.** All invoices across the distributor's clients, with a date-range filter (including the past 1 and 3 years) and a paid/unpaid filter; tiles for total invoiced, paid, and outstanding.
- **Actions.** Download an individual invoice; download all in range (CSV).
- **[PM INPUT].** Invoice numbering, GST treatment, the legal entity/GSTIN, and the document format (open item #12).

---

### 4.8 · Marketing

#### S-25 — Content
- **Purpose.** Tag articles; each article auto-delivers to clients whose tags intersect.
- **Presents.** The article list (title, tags, date, reach = count of unique matching clients) with edit and "who" (the matching recipients) actions; and an editor (title, summary, tags) with a live reach preview.
- **Rules.** **BR-CONTENT-1:** an article delivers to a client when their tags intersect the article's tags; reach is de-duplicated by person.
- **[PM INPUT].** The delivery channel and timing of "auto-delivery"; whether Marketing may see client-level recipients or only counts (open item #10).

#### S-23 — Audience Lists
- **Purpose.** Reusable, multi-filter audience segments.
- **Presents.** Saved lists with a member count and a filter summary; an editor with multi-select filters — category (Direct/Retail, HNI/UHNI, Family Office, Corporate, Trust/HUF, NRI, Distributor, Wealth Manager, IFA/Referral, Institution), city, zone, account type/product, distributor, RM, minimum AUM, and an include-prospects toggle — with a live member preview.
- **Rules.** A list resolves to the set of clients (and, if prospects are included, leads) matching all selected filters.

#### S-24 — Events
- **Purpose.** Plan events and compute the unique invitee count.
- **Presents.** Events (name, lead, co-lead, date, venue, attached audience lists) with a **de-duplicated** invitee count across the attached lists; and an editor with a live unique-invitee counter.

---

### 4.9 · B2B / Partnerships & Leadership

#### S-37 — Partner Pipeline
- **Purpose.** Work partner-firm leads (distributor / wealth manager / family office / IFA).
- **Scope.** A Partnerships RM sees own; the Head sees all.
- **Presents.** A filterable pipeline (firm, type, source, city, stage, RM, engagement mode) and a work view per partner: an **engagement recommendation** (in-person if the assigned RM shares the partner's city, else online), contact details, editable stage and assigned RM (assignment is the Head's right), interaction logging (call/email/meeting), schedule actions (online meeting or in-person visit), notes, and interaction history.
- **Actions.** Log interactions; set stage; assign RM (Head); schedule an engagement (which sets the mode and advances the stage to "Meeting set").
- **Rules.**
  - **BR-B2B-1 (engagement by city):** recommend an in-person visit when the assigned RM's city equals the partner's city, otherwise an online meeting.
  - **BR-B2B-2:** scheduling requires an assigned RM.

#### S-38 — B2B Dashboard
- **Purpose.** The Head's oversight of the partner pipeline.
- **Presents.** Tiles (partner leads, unassigned, in engagement, onboarded); a per-RM breakdown (assigned, scheduled, onboarded); and an attention list of unassigned partners with an **assign** action.
- **Rules.** **BR-B2B-3:** the Head assigns the Partnerships RM.
- **[PM INPUT — open item #2].** Whether to add a dedicated B2B qualification queue (mirroring S-05/S-06) rather than direct assignment by the Head.

#### S-39 — Leadership
- **Purpose.** Department oversight with an escalation feed.
- **Presents.** A department toggle (Sales / Investment / Compliance / Operations); per-department throughput tiles; a **"needs attention"** feed of escalations with one-click actions; and per-person scorecards. Escalations include: five-strike leads (write-off / reassign), overdue follow-ups (nudge), unqualified app leads (nudge the Lead Desk), reviews due/overdue (mark reviewed / open client), flagged or pending compliance (open verification), and blocked/overdue tasks (reassign / escalate).
- **Actions.** Nudge a team member; mark a review done; write off a lead; escalate a task (raises its priority and records the escalation).
- **[PM INPUT].** "Nudge" must be a real notification (channel + recipient), not a passive acknowledgement; confirm the throughput metrics and scorecard definitions.

---

### 4.10 · Universal screens

#### S-21 — Knowledge Hub
- In-app documentation available to every role (overview, teams & duties, lead flow, five-strike, assignment, onboarding, clients, tasks, compliance, reviews, leadership, a team-handoff diagram, a "how do I…" guide, and a glossary).
- **[PM INPUT].** Ownership and the update process for this content.

#### S-22 — Feature Suggestions
- A shared board where any user can submit and up-vote product suggestions, each with a status (Requested / Planned / In Progress / Shipped).
- **[PM INPUT].** Whether this ships in production, and if so its moderation and data-retention model.

#### Cross-cutting — navigation counters
- The navigation shall surface live counts to draw attention to work: e.g. active leads, out-listed leads, clients in scope, open tasks for the user's team, items awaiting verification, reviews due this week, the assignment queue, onboarding in flight, today's meetings, unread mail, PMS items not cleared, and the active partner pipeline. Each counter respects the user's scope.

---

## 5. Business Logic & Rules

### 5.1 RIA vs PMS routing
- **BR-ROUTE-1.** An account's track is determined by the initial lumpsum: **< ₹50 lakh → RIA track** (product *PMS Lite (RIA)*); **≥ ₹50 lakh → PMS track**. *International investing* is a separate product. Compliance routing follows the product: RIA accounts → RIA Compliance (S-30–S-33); PMS accounts → PMS Compliance (S-34–S-36).
- **[PM INPUT — open item #1].** Confirm the ₹50 lakh threshold and whether it is on the initial lumpsum or ongoing AUM; define **International** compliance routing explicitly (PMS regime, or its own); confirm whether the strategy list, fee or disclosure differ by track.

### 5.2 Household & accounts
- **BR-HH-1.** The mobile number is the household key; a person holds at most one account per product; family members are associated under the primary's number; account views show one row per account.
- **BR-HH-2.** Onboarding forms are keyed by mobile and resumable, so self-serve and RM-assisted starts converge.
- **[PM INPUT].** Whether a person may hold two accounts of the same product; handling of a number shared by unrelated people; OTP verification of the number.

### 5.3 Lead lifecycle & five-strike
- **BR-LEAD-1.** Stages: **L1 Cold → L2 Hot/Holding → L3 Onboarding → L4 Pre-Investment**.
- **BR-LEAD-2 (five-strike).** At L1, five unanswered outreaches flag the lead for the Out List; out-listing requires a reason; logging a genuine response resets the warning. Applies only at L1.
- **BR-LEAD-3.** Marking a lead *Not Interested* out-lists it.
- **[PM INPUT].** Hard cap vs advisory; whether the outreach count is system-derived from real channels.

### 5.4 Metrics & formulas
- **BR-METRIC-1 (CAGR).** CAGR since inception = (current ÷ invested)^(1 ÷ years) − 1; for tenure under one year, show *return since inception* instead.
- **BR-METRIC-2 (gain).** Gain = current value − invested, signed and colour-coded.
- **BR-METRIC-3 (RIA register).** As defined in S-33.
- **BR-METRIC-4 (AUM).** Σ current value over the scoped funded accounts.
- **[PM INPUT].** The "years" basis for CAGR (calendar vs 365-day); confirm absolute return and IRR originate from the custodian (A1).

### 5.5 Compliance status (SEBI report)
- **BR-COMP-1.** Each SEBI item i–x is green (complete) / amber (in progress) / red (missing), computed from the underlying records. A client is fully compliant only when all are green; any red ⇒ gap; otherwise any amber ⇒ pending.
- **[PM INPUT].** Ratify each item's green rule against SEBI's requirement and define what produces each underlying record.

### 5.6 FIU grey list (PMS)
- **BR-PMS-1.** An FIU AML match grey-lists the client and hard-blocks onboarding until cleared.

### 5.7 Fees (RIA)
- **BR-FEE-1.** Advisory fees are collected via e-NACH auto-debit; the system shows per-cycle status and failure reasons and supports retry / escalation.
- **[PM INPUT].** Fee computation source and cadence; mandate lifecycle (open item #12).

### 5.8 Schedules
- **BR-SCH-1.** Monthly client report by the 1st (following month); Half-yearly end-September & end-March; Tax in April for the prior FY. SEBI RIA register daily; PMR/APMI/PMSBazaar fund-level (monthly/periodic). Reviews: annual IPS + quarterly portfolio; annual risk refresh (no response within 14 days → flag the RM).
- **[PM INPUT].** Auto-send vs maker-checker (open item #4); the 14-day risk-refresh automation (BR-REVIEW-2).

### 5.9 B2B engagement-by-city
- **BR-B2B-1.** Assigned RM's city = partner's city → recommend in-person visit; else online. Scheduling advances the stage to "Meeting set".

### 5.10 Content routing & strategy
- **BR-CONTENT-1.** A client receives an article when the article's tags intersect the client's tags.
- **BR-STRAT-1.** Strategy is backend-assigned and read-only in the CRM; the RM cannot change it.
- **[PM INPUT — open item #5].** Standardise product and strategy naming with the RIA App, including whether to surface the Cruise strategy tiers (Shield / Steady / Navigator / Accelerate / Maverick) in the CRM.

---

## 6. Integrations
The system shall integrate with the following external services. For each, the project must define the named provider, authentication, field mapping, retry/fallback policy, and webhook/callback handling (consolidated as open item #7).

| # | Integration | Purpose | Screens |
|---|---|---|---|
| INT-1 | **DIGIO** | Agreement e-signature + digital KYC (PAN/name/DOB/Aadhaar e-KYC); signed-document storage | S-09, S-30 |
| INT-2 | **CKYC registry** | CKYC fetch/update (RIA) | S-09, S-30, S-31 |
| INT-3 | **KRA** | KYC Registration Agency status | S-30, S-31 |
| INT-4 | **FIU (AML)** | PMS screening by PAN → grey list | S-34 |
| INT-5 | **Custodian / fund administrator** | Holdings/valuations/returns; fund-level filing data; per-client custodian reports | S-10/S-11, S-19, S-35, S-36 |
| INT-6 | **Transactional email + tracking** | Send reports/content/IPS; capture delivered/opened/acknowledged | S-19, S-30, S-36, S-25 |
| INT-7 | **Calendar / video meeting** | Create events, meeting links, invites; pre-call reminders | S-06, S-14, S-15, S-16, S-37 |
| INT-8 | **Email / mailbox** | Inbox send/receive | S-18 |
| INT-9 | **Payment / e-NACH** | Mandate + advisory-fee auto-debit; status & failure reasons | S-32 |
| INT-10 | **SEBI PMR portal / APMI / PMSBazaar** | Fund-level submissions | S-35 |
| INT-11 | **WhatsApp Business** | Outreach + delivery receipts; client notifications | S-04, S-11 |
| INT-12 | **Account Aggregator (RBI AA)** | Optional auto-import of client financials during onboarding | S-09 |

> **[PM INPUT].** The **custodian/administrator sync (INT-5)** is the backbone the CRM depends on for all portfolio figures, reports and filings; define it first.

---

## 7. Error Handling

### 7.1 Access / permission
| Case | Behaviour |
|---|---|
| Out-of-scope record requested | Deny at the API with a human message ("You don't have access to this record."); log the attempt. |
| Wrong-product compliance role | RIA Compliance cannot open PMS clients and vice-versa. |

### 7.2 Validation
| Case | Behaviour |
|---|---|
| Lead saved without a name | Block; prompt for the name. |
| Onboarding form below the e-sign threshold | E-sign disabled until the threshold (BR-ONB-1) is met. |
| Invalid mobile number on onboarding | Block; require a valid 10-digit number. |
| Add an account without a member name | Block; require the name. |
| Reassign a task without a reason | Block; require a reason (BR-TASK-1). |
| Assign without a meeting date | Block; require a date. |
| Save a list/event/article without a name/title | Block; require it. |
| Schedule a B2B engagement with no RM | Block; require RM assignment (BR-B2B-2). |
| Send a report to a missing/invalid client email | Block and flag the client. |
| Add a second account of the same product | Block (BR-HH-1). |

### 7.3 Integration failures
| Integration | Behaviour |
|---|---|
| DIGIO e-sign fails | Retry; surface "e-sign pending"; no technical codes shown. |
| Custodian fetch fails | Mark the filing/report "fetch failed"; alert PMS Compliance. |
| e-NACH debit fails | Show the reason; offer retry / raise-to-RM. |
| Email send bounces | Mark failed; notify the sender. |

### 7.4 General
The system shall never show raw technical error codes; it shall always present a human-readable message and a recovery path.

---

## 8. Non-Functional Requirements
- **8.1 Performance.** P95 page load < 2s; report generation is asynchronous with progress indication. [PM INPUT — SLAs.]
- **8.2 Platform.** Web application (desktop + tablet). [PM INPUT — mobile support.]
- **8.3 Security.** RBAC enforced at the data layer (not only the UI); PAN/Aadhaar/demat/bank identifiers encrypted at rest (AES-256) with keys in a secrets manager; TLS 1.2+ in transit.
- **8.4 SEBI / DPDP.** DPDP consent captured and timestamped; unmasked PAN/Aadhaar restricted to the compliance officer, with **every unmasked view written to an immutable audit log**, exportable (CSV/JSON) and included in the monthly compliance report; SEBI retention norms for agreements and reports. [PM INPUT — the masking matrix per role; the audit-log store.]
- **8.5 Notifications.** [PM INPUT — channels (SMS / WhatsApp / email / push) and triggers for review-due, report dispatch, fee failure, filing-due, the 10-minute pre-call reminder, e-sign-pending, and five-strike.]

---

## 9. Out of Scope (first release)
| Item | Notes |
|---|---|
| Client-facing RIA App | Separate specification. |
| Live portfolio analytics / P&L engine | Holdings and returns are sourced from the custodian (INT-5); no calculation engine in the CRM. |
| Rebalancing / execution engine | Referenced (rebalance dates, advice records) but not built here. |
| HUF / intermediary onboarding | Deferred. |

---

## 10. Open Items — PM Sign-Off Required
| # | Item | Decision needed | Ref |
|---|---|---|---|
| 1 | RIA vs PMS threshold | Confirm ₹50 lakh; define International compliance routing | 5.1 |
| 2 | B2B Qualifier screen | Add a dedicated qualification queue, or keep Head-assigns? | S-38 |
| 3 | Lead → client conversion | Auto-create the account on signature? Who assigns id/product/strategy? | S-09 |
| 4 | Report & filing dispatch | Auto-send on schedule vs maker-checker approval | 5.8 |
| 5 | Product/strategy naming | Standardise with the RIA App; surface Cruise tiers? | 5.10 |
| 6 | Authentication | Internal SSO/MFA + external partner login + identity→role mapping | 3.3 |
| 7 | Integration providers | Provider, auth, mapping, retry, webhook for INT-1…INT-12 | 6 |
| 8 | Masking & audit | Roles that see unmasked PII; the immutable unmasked-view audit log | 8.4 |
| 9 | Notifications | Channels + triggers (incl. 14-day risk refresh, e-sign-pending, five-strike) | 8.5 |
| 10 | Marketing PII | Client-level data or aggregates only? | 4.8 |
| 11 | Field edit authority | Which role may edit which account/KYC fields; custodian-owned vs CRM-owned split | S-11 |
| 12 | Fee model | Advisory-fee computation, cadence, GST/invoice numbering, legal entity/GSTIN | 5.7, S-29 |
| 13 | Strategy performance source | The system of record for strategy performance figures | S-28 |
| 14 | Onboarding fields | Ratify the authoritative field list, mandatory set, and the e-sign gate rule | S-09 |
| 15 | Dedup on sign-up | Auto-merge a duplicate sign-up (same number) into the existing person | S-06 |
| 16 | Account lifecycle stages | Canonical account stages and their derivation from real state | S-10 |
| 17 | Concurrency | Per-entity concurrency/locking policy (esp. compliance records) | 2.2 |

---

## 11. End-to-End Flows

**B2C (acquire → serve).** Advertising / website / app sign-up creates a **Lead** (S-03 / S-05). For an app sign-up, the **Qualifier** selects the best-fit RM and books the intro meeting with a video invite (S-06); the lead becomes qualified (stage L2). The **RM** runs onboarding (S-07): the mobile-first household hub (S-08), one resumable form per account (S-09), reaching e-signature once the form meets the gate; signature advances the lead to L4 and (per the decision in open item #3) creates the funded **Account**, which appears in **Clients / Profiles** (S-10 / S-13). The RM then runs **meetings / reviews / reports** (S-14 / S-16 / S-19). **Compliance** runs in parallel — RIA: KYC file → monthly SEBI report → fee status → daily register (S-30–S-33); PMS: FIU screening → fund-level filings → per-client custodian reports (S-34–S-36). **Marketing** content reaches clients by tag intersection.

**B2B (partner).** A partner firm enters the pipeline (S-37); the **Head** assigns a Partnerships RM (S-38); engagement proceeds online or in-person by city; once onboarded, the partner receives the **Distributor portal** (S-26–S-29).

**Guardrails.** *Audit-acknowledge (not hard-block) unless noted:* five-strike out-listing, task-reassignment reason, strategy read-only, DPDP consent, unmasked-PII access logging. *Hard blocks:* FIU grey list (no onboarding), report send to an invalid client email, out-of-scope data access.

---

## Appendix A — Domain Entities & Relationships

Entities the system maintains (detailed attributes, types and validation are specified in the separate data-design document):

- **Lead** — a prospective B2C relationship (manual or app-originated); has a stage, status, owning RM, outreach history, and (for app sign-ups) qualification state.
- **Household** — the set of people and accounts sharing one mobile number (the household key).
- **Person** — an individual within a household (primary holder or family member, with a relationship).
- **Account** — one product holding (PMS Lite (RIA) / PMS / International) for one person; carries product/track, billing plan, lifecycle stage, funded state, attributed distributor, and links to portfolio data (sourced from the custodian).
- **Onboarding Form** — the data capture for opening one account; keyed to the household mobile; resumable; carries completion and e-signature state.
- **Meeting** — a calendar event (call / video / visit) with attendees, time, duration and a link.
- **Task** — a cross-team request with team, type, linked client, priority, status, assignee, and an activity thread.
- **Message** — an internal mail item (inbox/sent), including system-dispatched client communications.
- **Compliance Record (RIA)** — per RIA account: KYC file state, the SEBI i–x item states, suitability, demat-access record, and verification verdict.
- **AML Screening (PMS)** — per PMS account: FIU result and grey-list state.
- **Report Dispatch** — a report sent to a client with delivery/open/acknowledgement receipts.
- **Fee Cycle** — an advisory-fee auto-debit attempt with status and failure reason.
- **Distributor** — a channel partner; the external portal identity.
- **Audience List** — a saved marketing segment defined by filters.
- **Event** — a marketing event with attached audience lists.
- **Article** — tagged marketing content.
- **Tag** — the shared vocabulary of client pain-points/interests.
- **Regulatory Filing** — a fund-level submission (PMR / APMI / PMSBazaar) with due date and status.
- **Custodian Report** — a per-client custodian report type with delivery tracking.
- **Partner Lead** — a B2B prospect firm with type, source, city, stage, assigned RM, engagement mode and interaction history.
- **Audit Entry** — an immutable record of a sensitive action or data access.

**Primary relationships.** Household 1—* Person; Household 1—* Account; Person 1—* Account (≤ one per product); Account *—1 Distributor; Account 1—1 Compliance Record / AML Screening; Account 1—* Report Dispatch / Fee Cycle; Lead *—1 Relationship Manager; Onboarding Form *—1 Household; Audience List *—* Account; Event *—* Audience List; Article *—* Tag; Person/Account *—* Tag.

---

## Appendix B — Glossary, status enumerations & colour legend

**Enumerations**
- **Lead stage:** L1 Cold · L2 Hot/Holding · L3 Onboarding · L4 Pre-Investment.
- **Lead status:** New · Cold · Potential · Hot · Onboarding · Not Interested.
- **Onboarding steps:** Captured details · Authenticated · Choosing path · In progress · Advisory routing · Sign agreement · Fund account · Onboarded.
- **Products:** PMS Lite (RIA) · PMS · International investing.
- **Task status:** Open · In Progress · Blocked · Done. **Priority:** High · Medium · Low.
- **RIA compliance status:** Verified · Flagged · Pending.
- **PMS AML:** Not screened · Clear · Flagged (grey-listed).
- **B2B stage:** New · Qualified · Meeting set · In discussion · Onboarded · Not interested. **Mode:** Visit · Online.
- **Filing status:** Pending · Fetched · Submitted/Uploaded.
- **Report delivery:** Pending · Delivered · Seen; reports may add Acknowledged.
- **SEBI compliance items:** i–x (see S-31).

**Colour legend**
- **Green** — complete / compliant / cleared / success.
- **Amber** — in progress / due soon / pending.
- **Red** — missing / failed / overdue / blocked / grey-listed.

**Glossary**
- **Household** — all accounts and family members on one mobile number.
- **CAGR since inception** — annualised return; for accounts under one year, *return since inception* is shown instead.
- **Five-strike** — at L1, five unanswered outreaches flag a lead for the Out List.
- **Grey list** — an FIU AML-matched PMS client who cannot be onboarded.
- **e-NACH** — the auto-debit mandate used to collect advisory fees.
- **PMR** — SEBI Portfolio Manager Report (fund-level, monthly).
- **IPS** — Investment Policy Statement (suitability document).
- **Suspense holding** — an unreconciled position awaiting custodian reconciliation.
- **Track** — RIA vs PMS, determined by BR-ROUTE-1, governing compliance routing.

*End of document.*





