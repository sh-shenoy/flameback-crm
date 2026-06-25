# FLAMEBACK CAPITAL — Flameback CRM (Back-Office)
## FUNCTIONAL SPECIFICATION DOCUMENT — BUILD-READY
Version: 4.0 | June 2026 | CONFIDENTIAL
Prepared by: Shashank Shenoy | Status: Draft for PM sign-off

> Companion to the **Flameback India RIA App** specification (the client-facing application). This CRM is the system Flameback's internal teams use to acquire, onboard, serve and stay compliant.

> **Purpose of this version (4.0).** A **build-ready** functional specification: every screen is documented to the field level — each input with its type, full option list, source, editability and validation; every table with its exact columns; every action with its behaviour and confirmation; every computed value with its formula; and every empty/error state. A developer should be able to implement each screen from this document without further reference. Items still needing a product decision are marked **[PM INPUT]** and consolidated in Section 10.

---

### HOW TO READ THIS DOCUMENT
- **Section 1** — Overview & Scope
- **Section 2** — Architecture, Domain Model & Screen Inventory
- **Section 3** — Roles, Scoping & Authentication
- **Section 4** — Screen-by-Screen Specifications (build-ready; 40 screens)
- **Section 5** — Business Logic & Rules
- **Section 6** — Integrations
- **Section 7** — Error Handling
- **Section 8** — Non-Functional Requirements
- **Section 9** — Out of Scope
- **Section 10** — Open Items Requiring PM Sign-Off
- **Section 11** — End-to-End Flows
- **Appendix A** — Domain Entities & Relationships
- **Appendix B** — Glossary, Enumerations & Colour Legend

**Conventions**
- **Field tables** read: *Field — Type — Options / values — Source — Editable — Validation / notes.* "Source" is who owns the value: **User** (entered here), **System** (computed/auto), **Custodian** (from the custodian/administrator), **DIGIO/CKYC/KRA/FIU** (from that integration), or **Admin** (upstream admin/onboarding system).
- **"Confirmation"** is the message the system shows after a successful action.
- Identifiers **S-01…S-41** (screens) and **BR-\*** (rules) are stable cross-references.
- Money is ₹ with Indian digit grouping; dates use the `en-IN` locale (e.g. *24 Jun 2026*).
- **[PM INPUT]** = decision required before building the affected area.

---

## 1. Overview & Scope

### 1.1 Purpose
Defines the complete behaviour, data, rules and integrations of the **Flameback CRM** — the internal back-office for Sales, Onboarding (RM-led), Investment, Operations, Compliance (RIA + PMS), Marketing, Partnerships (B2B) and Leadership, plus an external portal for distributors / wealth managers.

### 1.2 Scope (in)
B2C lead acquisition & qualification; RM-led household onboarding with e-signature; clients, accounts and unified person profiles; tags & content auto-routing; calendar, reviews, tasks, internal mail; client reporting; the distributor portal; RIA compliance (KYC file, monthly SEBI report, fee auto-debit, daily register); PMS compliance (FIU AML, fund-level filings, per-client custodian reports); B2B partnerships; and Leadership oversight.

### 1.3 Scope (out)
The client-facing app; a live portfolio-analytics / P&L calculation engine; a rebalancing/execution engine; HUF / intermediary onboarding (Section 9).

### 1.4 Key assumptions
- **A1 — Holdings system of record.** Portfolio holdings, valuations and returns come from the **custodian / fund administrator**; the CRM displays and reports on them and does not compute them. [PM INPUT — source, cadence, mapping; INT-5.]
- **A2 — CRM system of record** for relationship, onboarding and compliance state.
- **A3 — Server-side identity & authorization** (Section 3).

### 1.5 Version Log
| Version | Date | Author | Changes |
|---|---|---|---|
| 1.0 | Jun 2026 | S. Shenoy | First CRM functional spec. |
| 2.0 | Jun 2026 | S. Shenoy | Field-level expansion. |
| 3.0 | Jun 2026 | S. Shenoy | Reframed as forward-looking product requirements. |
| 4.0 | Jun 2026 | S. Shenoy | **Build-ready**: exhaustive per-screen field/option/column/action/formula/state tables; full enumerations. |

---

## 2. Architecture, Domain Model & Screen Inventory

### 2.1 Two motions, role-based
The CRM supports **B2C** (individuals/families from advertising, website, referrals, app sign-ups) and **B2B / Partnerships** (partner firms). Every user operates within a **role** that governs both the modules they see and the records they may access. Two structural principles:
1. **Household = one mobile number.** A person holds **at most one account per product** — *PMS Lite (RIA)*, *PMS*, *International investing*; family members are associated under the primary holder's number. Account views show **one row per account**; person profiles consolidate accounts + leads.
2. **Scoping.** RM = own book; Distributor = own clients; RIA Compliance = RIA clients; PMS Compliance = PMS clients; Investment & Leadership = all. Enforced server-side (Section 3.2).

### 2.2 Target architecture (requirements)
- **ARCH-1.** Server-backed web application with a persistent database as the system of record for the entities in Appendix A.
- **ARCH-2.** All authorization (role access + record scoping) enforced at the API/data layer, never solely in the client; the UI may additionally hide controls.
- **ARCH-3.** An **immutable audit log** for sensitive actions and data access (unmasked PII views, compliance verdicts, task reassignments, e-sign dispatch) — NFR 8.4.
- **ARCH-4.** A defined integration layer (Section 6) with retry, fallback and webhook/callback handling.
- **ARCH-5.** Multi-user with safe concurrent access; compliance records require locking/versioning (last-writer-wins not acceptable). [PM INPUT — per-entity concurrency policy.]
- **ARCH-6.** PAN, Aadhaar, demat and bank identifiers encrypted at rest; TLS 1.2+ in transit.

### 2.3 Domain model (overview)
Entities and relationships are summarised in Appendix A; detailed attributes belong to a separate data-design document. Core entities: **Lead, Household, Person, Account, Onboarding Form, Meeting, Task, Message, Compliance Record (RIA), AML Screening (PMS), Report Dispatch, Fee Cycle, Distributor, Audience List, Event, Article, Tag, Regulatory Filing, Custodian Report, Partner Lead, Audit Entry.** Key relationships: Household 1—* Account; Person 1—* Account (≤1 per product); Account *—1 Distributor; Account 1—1 Compliance Record / AML Screening; Account 1—* Report Dispatch / Fee Cycle; Lead *—1 RM; Audience List *—* Account; Event *—* Audience List; Person/Account *—* Tag.

### 2.4 Path tags
| Tag | Path | Screens |
|---|---|---|
| B2C-ACQ | Acquire | S-03 → S-05 → S-06 |
| B2C-ONB | Onboard | S-07 → S-08 → S-09 |
| B2C-SERVE | Serve | S-10/S-13 → S-14/S-16/S-19 |
| COMP-RIA | RIA compliance | S-30 → S-33 |
| COMP-PMS | PMS compliance | S-34 → S-36 |
| B2B | Partnerships | S-37 → S-38 |
| PARTNER | Distributor portal | S-26 → S-29 |

### 2.5 Screen Inventory (41)
| ID | Screen | Primary roles |
|----|--------|---------------|
| S-01 | Login / Authentication | All |
| S-02 | Role Dashboard (RM) | RM |
| S-03 | Leads | RM |
| S-04 | Lead Detail | RM |
| S-05 | Assignment Queue | Qualifier |
| S-06 | Qualify & Assign | Qualifier |
| S-07 | Onboarding Journey | RM |
| S-08 | Household Hub | RM |
| S-09 | Onboarding Form | RM |
| S-10 | Clients | RM, Investment, Ops, Leadership |
| S-11 | Account Detail | RM, Investment, Ops, Leadership |
| S-12 | Profiles Directory | RM, Investment, Leadership |
| S-13 | Person Profile | RM, Investment, Leadership |
| S-14 | Calendar | RM, Distributor, Investment, Leadership, Qualifier, B2B |
| S-15 | Schedule Meeting / Call | as above |
| S-16 | Reviews & Reminders | RM, Investment, Distributor |
| S-17 | Tasks & Requests | All operating roles |
| S-18 | Inbox | All |
| S-19 | Client Reports | RM, Investment, Distributor |
| S-20 | Out List | RM, Leadership |
| S-21 | Knowledge Hub | All |
| S-22 | Feature Suggestions | All |
| S-23 | Audience Lists | Marketing |
| S-24 | Events | Marketing |
| S-25 | Content | Marketing |
| S-26 | Distributor Dashboard | Distributor |
| S-27 | Distributor Clients | Distributor |
| S-28 | Distributor Strategies | Distributor |
| S-29 | Distributor Invoices | Distributor |
| S-30 | RIA Compliance — KYC File | RIA Compliance |
| S-31 | Monthly SEBI Report | RIA Compliance |
| S-32 | Fee Payments (e-NACH) | RIA Compliance |
| S-33 | SEBI RIA Daily Report | RIA Compliance |
| S-34 | PMS Review (FIU) | PMS Compliance |
| S-35 | Regulatory Filings | PMS Compliance |
| S-36 | Custodian Reports | PMS Compliance (send); RM (view own) |
| S-37 | Partner Pipeline (B2B) | Partnerships RM, Head |
| S-38 | B2B Dashboard | Partnerships Head |
| S-39 | Leadership | Leadership |
| S-40 | Role Dashboards | Qualifier / Investment / Ops / Compliance / Distributor |
| S-41 | Strategies Catalog (internal) | RM, Investment, Leadership |

---

## 3. Roles, Scoping & Authentication

### 3.1 Roles & module access
| Role | Function | Accessible modules (in order) |
|---|---|---|
| Relationship Manager (RM) | B2C relationship owner | Dashboard, Leads, Onboarding, Calendar, Reviews, Clients, Profiles, Reports, Invoices, Tasks, Out List, Suggestions, Knowledge Hub, Inbox |
| Qualifier (Lead Desk) | Qualifies app sign-ups, assigns RM | Dashboard, Assignment Queue, Calendar, Tasks, Suggestions, Knowledge Hub, Inbox |
| Investment | Portfolios/IPS/reviews, all clients | Dashboard, IPS/Portfolios, Reviews, Clients, Profiles, Reports, Invoices, Calendar, Tasks, Suggestions, Knowledge Hub, Inbox |
| Operations | Account/demat/recon, ops tasks | Dashboard, Tasks, Clients, Suggestions, Knowledge Hub, Inbox |
| RIA Compliance | RIA compliance | Dashboard, KYC File, Monthly SEBI Report, Fee Payments, RIA Daily Register, Tasks, Clients, Suggestions, Knowledge Hub, Inbox |
| PMS Compliance | PMS compliance | PMS Review, Regulatory Filings, Custodian Reports, Tasks, Inbox, Knowledge Hub |
| Marketing | Segments, events, content | Events, Audience Lists, Content, Calendar, Tasks, Suggestions, Knowledge Hub, Inbox |
| Distributor (external) | A partner's own book | Dashboard, Clients, Reports, Invoices, Calendar, Reviews, IPS, Strategies, Inbox |
| Partnerships RM (B2B) | Own partner leads | Partner Pipeline, Calendar, Tasks, Inbox, Knowledge Hub |
| Partnerships Head (B2B) | Assigns RMs, oversees pipeline | B2B Dashboard, Partner Pipeline, Calendar, Tasks, Inbox, Knowledge Hub |
| Leadership / Dept Heads | All-up oversight | Leadership, Clients, Profiles, Reports, Invoices, Tasks, KYC File, IPS, Reviews, Calendar, Leads, Out List, Suggestions, Knowledge Hub, Inbox |

[PM INPUT — whether a user may hold multiple roles and how access composes.]

### 3.2 Data scoping (record visibility) — enforced server-side
| Role | Scope |
|---|---|
| RM | Own leads, clients, calendar, reviews, reports. |
| Distributor | Only accounts attributed to that distributor. |
| RIA Compliance | RIA-track accounts only. |
| PMS Compliance | PMS-track (PMS + International) accounts only. |
| Investment, Leadership | All records. |
| Qualifier | The assignment queue + own calendar. |
| Partnerships RM | Own partner leads. |
| Partnerships Head | All partner leads. |
| Marketing | Segments/aggregates (client-level PII — open item #10). |

- **BR-SCOPE-1.** Out-of-scope retrieval is denied at the API and logged (7.1).
- [PM INPUT — ratify the full role × entity matrix incl. edit rights and PII visibility (#8, #11).]

### 3.3 Authentication
- **BR-AUTH-1.** RBAC enforced at the API/data layer, not only the UI.
- [PM INPUT — internal auth (SSO vs email+MFA; session/MFA/password policy); external partner login; identity→role mapping. #6.]

### 3.4 Personnel & teams
- **BR-ORG-1.** RMs, team members and partnership RMs (with base cities, used by BR-B2B-1) come from the identity/HR system, not maintained in the CRM.

---

## 4. Screen-by-Screen Specifications

### 4.0 · S-01 — Login / Authentication
Authenticate the user, resolve role(s) and scope, present the role's modules, and land on the role's first module. [PM INPUT — auth method, MFA, session, partner provisioning; Section 3.3.]

---

### 4.1 · Sales (RM) & Role Dashboards

#### S-02 / S-40 — Role Dashboard
A role-specific page: a title, subtitle, optional header action, a row of **KPI tiles** (each = label, value, caption, proportional bar), and one **priority worklist** table. All values respect the user's scope (Section 3.2).

**RM dashboard.** Header action: **+ Add Lead** → opens new Lead Detail (S-04).
KPI tiles:
| Tile | Value | Formula |
|---|---|---|
| Active leads | count | the RM's leads not out-listed |
| Hot leads | count | leads with status = Hot |
| Onboarding + | count | leads at stage L3 or L4 |
| Follow-ups due | count | leads whose follow-up date ≤ today (local midnight) |
| Reviews due this week | count | the RM's funded clients where next annual OR next quarterly review is within 7 days |

Worklist **"Follow-ups due today & overdue"** (link: *View all leads →* S-03). Columns: **Lead · RM · Stage · Status · Interaction · Follow-up**. Row → Lead Detail. Empty: "🎉 No follow-ups due."

**Qualifier dashboard.** Tiles: Awaiting qualification (app sign-ups not yet qualified) · Recovery (those flagged as self-serve drop-offs) · Meetings today (all RMs, not done) · RM availability *[PM INPUT — real capacity]*. Worklist **"Leads awaiting assignment"** (link *Open queue →* S-05). Columns: **Lead (+ "recovery" flag) · Source · Flow · Recommended RM · (Qualify & assign)**. Empty: "Queue is clear."

**RIA Compliance dashboard.** Tiles over RIA clients: Pending verification (status Pending) · Flagged (status Flagged) · Verified (status Verified) · Open tasks (Compliance team, not Done). Worklist **"Clients needing verification"** → KYC File (S-30). Columns: **Client · Client ID · PAN · Status**. Empty: "All clients verified."

**Operations dashboard.** Tiles over Operations tasks: Open · In progress · Blocked · Completed. Worklist **"My operations queue"** → Tasks (S-17). Columns: **Priority · Task · Client · From · Due · Status**. Empty: "No open operations tasks."

**Investment dashboard.** Tiles: Funded portfolios (count) · AUM (Σ current value of funded) · Reviews due this week · Open tasks (Investment). Worklist **"Reviews due this week"**. Columns: **Client · Risk band · Annual review · Quarterly review**. Empty: "No reviews due."

**Distributor dashboard.** See S-26.

#### S-03 — Leads
- **Scope.** The RM's leads, excluding app sign-ups not yet qualified.
- **Filters:** Search (matches name + RM + comments) · Stage (L1/L2/L3/L4) · Status (New/Cold/Potential/Hot/Onboarding/Not Interested) · Source.
- **Columns:**
| Column | Content |
|---|---|
| Lead | Name + a one-line comment preview (truncated ~42 chars) |
| Source | e.g. Referral, LinkedIn, Meta, Google, Direct, Search, Tools, Instagram |
| Status | colour pill |
| Stage | L1–L4 chip |
| RM | owning RM |
| Type | last interaction type (Call/Email/Meeting/WhatsApp) |
| Count | interaction count |
| Strikes | five-strike indicator (see S-04 rules); "n/a" when stage ≠ L1 |
| Follow-up | date |
- Row → Lead Detail (S-04). Empty: "No leads match your filters."

#### S-04 — Lead Detail (drawer)
- **Fields:**
| Field | Type | Options / values | Source | Editable | Notes |
|---|---|---|---|---|---|
| Name | text | — | User | Yes | required |
| Source | select | Referral, LinkedIn, Meta, Google, Direct, Search, Tools, Instagram (extensible) | User | Yes | default Referral |
| Status | select | New, Cold, Potential, Hot, Onboarding, Not Interested | User | Yes | default New |
| Stage | select | L1, L2, L3, L4 | User | Yes | default L1 |
| RM | select | the RM list (from HR) | User | Yes | default the current RM |
| Type (last interaction) | select | Call, Email, Meeting, WhatsApp | System/User | — | set by logging |
| Interaction count | number | — | System | No | incremented by logging |
| Comments | textarea | — | User | Yes | — |
| Follow-up date | date | — | User | Yes | — |
| Interaction history | list | dated {type, date} entries | System | No | newest first |
- **Actions:**
| Control | Behaviour | Confirmation |
|---|---|---|
| Log Call / Email / Meeting / WhatsApp | +1 count, record dated interaction, set last type, refresh five-strike | "<type> logged · count = <n>" |
| Save | validate name present; persist | "Lead saved" |
| Start onboarding (RM, saved, non-out lead) | open onboarding (S-08) | — |
| Move to Out | out-list with reason (default "Five-Strike Rule") | "Moved to Out list (Five-Strike Rule)" |
| Delete | confirm, then remove | "Lead deleted" |
| Dismiss five-strike | keep in pipeline; re-grade Cold/New → Potential | "Kept in pipeline — marked Potential" |
- **Rules.** **BR-LEAD-2 (five-strike):** at stage L1, reaching 5 unanswered outreaches flags the lead for the Out List and shows a prompt; applies only at L1; logging a genuine response clears the dismissal. Setting status *Not Interested* out-lists on save. [PM INPUT — hard cap vs advisory; system-derived count.]

#### S-20 — Out List
- **Scope.** The RM's out-listed leads.
- **Columns:** Lead · Source · RM · Count · Reason (out-reason; default "Five-Strike Rule") · Last date (most recent interaction) · Action.
- **Action — Restore:** return to pipeline; a "Not Interested" lead returns as Cold. Confirmation "Lead restored to pipeline." Empty: "No leads in the Out list."

---

### 4.2 · Lead Desk (Qualifier)

#### S-05 — Assignment Queue
- **Scope.** App sign-ups not yet qualified.
- **Columns:** **Lead** (name + "recovery" flag if a self-serve drop-off + comments) · **Contact** (phone, email) · **Source** · **Flow** (Self-serve / RM-assisted) · **Recommended RM** (name + reason) · **Onboarding step** · **(Qualify & assign)**. Empty: "No leads awaiting assignment."

#### S-06 — Qualify & Assign (modal)
- **Fields:**
| Field | Type | Default | Notes |
|---|---|---|---|
| RM | select (RM list) | the recommended RM | — |
| Meeting date | date | next day | required |
| Meeting time | time | 15:00 | — |
| Preview | read-only | — | recommendation reason; generated video link; attendees = client, RM, qualifier |
- **Confirm:** require a date; mark lead qualified; assign RM; advance lead (status Potential, stage L2, onboarding step ≥ "Choosing path"); **create the intro meeting** (default 30 min) with a video link and invites to client + RM + qualifier. Confirmation "<RM> assigned · added to the meeting invite."
- **Rules.** **BR-DUP-1** a sign-up whose number already exists should attach to the existing person [PM INPUT #15]. **BR-ASSIGN-1** the recommended RM must be computed and **explainable** [PM INPUT — algorithm].

---

### 4.3 · Onboarding (RM only)

#### S-07 — Onboarding Journey
- **Funnel** across steps (with counts): *Captured details · Authenticated · Choosing path · In progress · Advisory routing · Sign agreement · Fund account · Onboarded.*
- **Worklist** (in-flight leads): Name · Flow · Current step · RM · Action (**Start / Resume onboarding**; where the household already has accounts in progress, show the count). Empty: "No leads currently in onboarding."

#### S-08 — Household Hub
- **Entry.** Onboarding begins by prompting for the **mobile number first** (validated to 10 digits). An existing number auto-populates and lists existing accounts.
- **Presents.** Header: mobile · holder · account count. A list of accounts on the number, each: product · member · relationship · status · **Resume (% complete)** or **Open**. Empty: "No accounts yet on this number — add the first one below."
- **Add account / family member fields:**
| Field | Type | Options | Notes |
|---|---|---|---|
| Holder / member name | text | — | required |
| Relationship | select | Self, Spouse, Parent, Child, Sibling, Other | default Self |
| Product | select | PMS Lite (RIA), PMS, International investing | one per product per person (BR-HH-1) |
- **Rules.** **BR-HH-1** (household key = mobile; ≤1 account per product; one row per account); **BR-HH-2** (forms keyed by mobile; resumable, never forked). [PM INPUT — two of same product? OTP-verify number?]

#### S-09 — Onboarding Form
- **Layout.** Nine numbered sections with a live completion %; each completed section is marked done. **Every field:**

**1 · Personal details**
| Field | Type | Options |
|---|---|---|
| Full name (as per PAN) | text | — |
| Date of birth | date | — |
| Gender | select | Male, Female, Other |
| PAN | text | — |
| Aadhaar (last 4) | text | — |
| Nationality | text | — |

**2 · Contact & address**
| Field | Type | Options |
|---|---|---|
| Mobile (linked) | text, read-only | — |
| Email | email | — |
| Residential address | textarea (full width) | — |
| City | text | — |
| State | text | — |
| PIN code | text | — |

**3 · Financial profile**
| Field | Type | Options |
|---|---|---|
| Occupation | select | Salaried; Self-employed / Business; Professional; Retired; Other |
| Annual income | select | < ₹10L; ₹10–25L; ₹25–50L; ₹50L–1Cr; > ₹1Cr |
| Net worth band | select | < ₹50L; ₹50L–2Cr; ₹2–5Cr; > ₹5Cr |
| Source of funds | select | Salary; Business income; Investments; Inheritance; Other |

**4 · Investment objective**
| Field | Type | Options |
|---|---|---|
| Primary goal | select | Wealth creation; Retirement; Income generation; Child education; Capital preservation |
| Time horizon | select | < 3 yrs; 3–5 yrs; 5–10 yrs; > 10 yrs |
| Initial investment (₹) | number | — |
| Monthly SIP (₹) | number | — |

**5 · Advisory routing — product fit**
| Field | Type | Options |
|---|---|---|
| Recommended product (RM selects based on the conversation) | select (full width) | PMS Lite (RIA); PMS; International investing |
| Why this fit — notes | textarea (full width) | — |

**6 · Risk profile**
| Field | Type | Options |
|---|---|---|
| If your portfolio dropped 20%, you would… | select | Sell everything; Sell some; Hold; Buy more |
| Investment experience | select | None; Some; Experienced; Professional |
| Risk appetite | select | Low; Moderate; High; Very high |
| Resulting risk band | select | Conservative; Moderate; Aggressive |

**7 · Bank & demat**
| Field | Type | Options |
|---|---|---|
| Bank name | text | — |
| Account number | text | — |
| IFSC | text | — |
| Demat / broker | select | Zerodha — to open; Zerodha — active; Other broker; None yet |

**8 · Nominee**
| Field | Type | Options |
|---|---|---|
| Nominee name | text | — |
| Relationship | select | Spouse; Parent; Child; Sibling; Other |
| Share % | number | — |

**9 · Declarations & FATCA**
| Field | Type | Options |
|---|---|---|
| Politically exposed person? | select | No; Yes |
| Tax resident of India only? | select | Yes; No |
| Consents | checkboxes (full width) | Terms & conditions; Privacy policy; Risk disclosure; Fee schedule |

- **Completion %** = filled fields ÷ total fields (a checkbox group counts as filled when ≥1 is checked). A section is "done" when all its fields are filled.
- **Actions.** **Save** (persists partial; resumable). **Send for e-signature** — requires ≥ 85% complete (**BR-ONB-1**); sends the investment-management agreement (INT-1); records the dispatch; advances the lead (step "Sign agreement", stage L3, status Onboarding); confirmation notes the recipient. **Record signature** — on e-sign completion, advances the lead (step "Fund account", stage L4).
- **Rules.** **BR-ONB-2** resumability; **BR-ONB-3** an unsigned-after-send agreement triggers a reminder then an RM task [PM INPUT — cadence].
- **[PM INPUT — significant].** Ratify the authoritative field list & mandatory set; the 85% gate vs a mandatory-field gate; **lead→client conversion** on signature (auto-create the Account? who assigns the id? how product/strategy/distributor/segment are set — #3); DIGIO mapping (INT-1); optional AA import (INT-12).

---

### 4.4 · Clients & Profiles

#### S-10 — Clients
- **Scope.** Per Section 3.2. **Sort:** accounts within a household cluster together (by mobile, then holder, then product).
- **Filters:** Search (id + name + contact + RM + holder) · Billing plan (Monthly/Quarterly/Yearly) · Lifecycle stage · Product (PMS Lite (RIA)/PMS/International investing).
- **Columns:**
| Column | Content |
|---|---|
| CID | account id (e.g. FBC-1001) → opens Account Detail |
| Name | first + last; a relationship chip if not Self; for a family member a "↳ linked to <holder>" sub-line, else "source · country" |
| Contact | phone → opens Account Detail |
| RM | owning RM |
| Product | product tag |
| Plan | billing cycle |
| Stage | lifecycle stage badge |
| Invested | invested amount |
| Current Value | current value |
| Gain | current − invested (green if >0, red if <0, muted if 0) |
| Quick View | expander: holdings, return since inception, invested/current |
- Empty: "No clients match your filters." [PM INPUT — canonical lifecycle stages (#16).]

#### S-11 — Account Detail
Header: avatar (initials); name; sub-line — for a family member "🔗 linked to <holder> <relationship> ·" then product · CID · contact · RM. A lifecycle **stepper** and a **next-step** prompt. **Eight tabs:**

**Tab 1 — Overview** (two columns).
*Client information* (read-only; source: Admin):
| Field | Source |
|---|---|
| Date of sign-up · First name · Last name · Date of birth · Profession · Contact number | Admin |
| WhatsApp number (shows "(same as contact)" when identical) · Email · Country · Postal code · Source · Zerodha account (Yes/No) | Admin |
*Account & engagement:*
| Field | Type | Options | Editable | Action |
|---|---|---|---|---|
| RM | select | RM list | Yes (permitted roles) | confirmation "RM updated" |
| Billing cycle | select | Monthly, Quarterly, Yearly | Yes | confirmation "Billing cycle updated" |
| Questionnaire | badge | Done / Pending | No | — |
| Agreement | badge | Signed / Pending | No | — |
| Recommended strategies | chips | — | No (read-only, BR-STRAT-1) | — |
| Investment goal | text | — | No | — |
| SIP | badge | Yes / No | No | — |

**Tab 2 — Investment & SIP.** Goal, billing cycle, recommended strategies (joined); SIP details (strategy, frequency, start month/year, amount) or "No SIP configured for this client."

**Tab 3 — Risk Profile & Agreement.** Rows: **Risk Profile Questionnaire** (status + Download) · **Client Agreement** (Download signed when signed; **Send for signing** always) · **Subscription Invoice — latest** (description + "View invoices →").

**Tab 4 — Portfolio.** A reconciliation **suspense alert** when unreconciled positions exist (each: holding — amount · reason; action **Send repair notification** to the client). Metric cards: Investment amount · Current value · **Gain** (signed) · Absolute return % · IRR %. Holdings table: **Holding · Invested · Current value · Gain** (signed). Empty: "No holdings yet — client not funded." All figures: source Custodian (A1).

**Tab 5 — Strategies.** *What the client has invested in each strategy in this account* (read-only — **BR-STRAT-1**). A table, one row per assigned strategy: **Strategy** (+ category · benchmark) · **Invested** (this account) · **Current value** · **Gain** (signed) · **Return %** · **Since-inception CAGR** · **Fact sheet & holdings** action. The per-strategy invested/current are derived by allocating the account's portfolio across its strategies (deterministic weights) and **sum exactly to the account total** (BR-METRIC-5). For an unfunded account, amounts show "—". The same breakdown is mirrored on the Person Profile account card (S-13).
- **Strategy fact sheet & holdings (modal).** Opens for a strategy in the context of this account and shows five sections: **(a) Client position** — invested · current value · gain · **return since investment**; **(b) Performance** — a **NAV growth graph** with a **timeframe toggle** (1M · 3M · 6M · 1Y · 3Y · 5Y · Since inception); the headline figure is the **cumulative** return over the selected window; below it, the **since-inception CAGR (% p.a.)** and, when the client is funded, their **return since their own investment** with the entry date — and a **"Your entry" marker** drawn on the chart at the client's start point (shown when that date falls inside the selected window); **(c) Asset allocation** — an **equity / debt / cash** split as a stacked bar with %s, plus the rupee value of each sleeve in this account when funded; **(d) Fact sheet** — category, benchmark, inception, strategy AUM, minimum investment, risk, fund manager, objective and 1Y/3Y/SI CAGR; **(e) Holdings** — each holding's model **weight %** and, when funded, the client's **value** for this account (weight × current). Download fact sheet (PDF). Source: Investment team / custodian (A1, INT-5). [PM INPUT — authoritative per-strategy NAV series, allocation & holdings source; today derived deterministically for the demo.]

**Tab 6 — Reports.** Downloadable account reports: **Holding statement · Tax report — capital gains · Strategy performance report · Fund inflows & outflows · Basic information report** (PDF, on demand). [PM INPUT — definitions & generator; INT-5/6.]

**Tab 7 — Invoices.** Table: **Date · Description · Amount · Status (Paid/▢) · Download**; plus **Download all (CSV)**. Empty: "No invoices generated yet."

**Tab 8 — Call Sync.** Follow-ups synced from the calendar (datetime · note · source); **+ Schedule follow-up**. Empty: "No follow-ups scheduled."

- **Rules.** **BR-STRAT-1** strategy is backend-assigned, read-only in the CRM. **BR-KYC-OWN-1** KYC editing is a Compliance function (S-30), not here. **BR-METRIC-1** under one year show return-since-inception, not annualised CAGR. [PM INPUT — field edit authority (#11).]

#### S-12 — Profiles Directory
- **Consolidation (BR-PROFILE-1):** all accounts + leads sharing a mobile number form one **person**; the primary holder is canonical; account-less leads appear as prospects.
- **Columns:** Name + email · Kind (Client / Lead) · Phone · RM (or "unassigned") · Account count (or "— prospect"). Search matches name + phone + email; filter by kind. Row → Person Profile. Empty: "No profiles match." Scope per 3.2.

#### S-13 — Person Profile
Header: avatar; name; kind badge; phone; email. Meta: DOB · RM · Source · Accounts (count). **Five tabs:**
- **Accounts** — one card per account: product · current value · invested · CAGR/return · performance chart · per-strategy performance · holdings · last-rebalance info (RIA: "rebalance proposal sent / rebalanced by client"; PMS: "last rebalanced") · **Open account →**. Empty: prospect/not-onboarded message.
- **Communication** — preferences:
| Field | Type | Options |
|---|---|---|
| Preferred channels | checkboxes | Email; WhatsApp; SMS; Phone call |
| Contact frequency | select | Weekly; Monthly; Quarterly; On key events only |
| Preferred language | select | English; Hindi; Marathi; Gujarati; Tamil |
| Preferred time of day | select | Morning; Afternoon; Evening |
| Do not disturb | select | No; Yes |
  Each change confirms "Communication preference saved."
- **Timeline** — merged newest-first: outreach, lifecycle (Onboarded / Funded & executed / Rebalanced), and calls. Empty: "No timeline events yet."
- **Notes** — free-text relationship notes; **Save notes**.
- **Tags** — current tags (removable); **add** from the vocabulary; **create new**; **✨ assisted suggestions** (advisory; one-click accept — **BR-TAG-1**, never auto-applied); and **📨 content auto-shared** with this person (articles whose tags intersect — **BR-CONTENT-1**). Empty: prompt to add/accept.
- [PM INPUT — assisted-suggestion source; tag sensitivity; preset vocabulary.]

---

### 4.5 · Operating tools

#### S-17 — Tasks & Requests
- **Views.** Board (columns **Open · In Progress · Blocked · Done**) and list.
- **Fields:**
| Field | Type | Options | Notes |
|---|---|---|---|
| Title | text | — | required |
| Team | select | Compliance, Operations, Investment, RM, Marketing | drives Type & Assignee lists |
| Type | select | depends on team (below) | — |
| Linked client | select | any client (id · name) | optional |
| Priority | select | High; Medium; Low | default Medium |
| Status | select | Open; In Progress; Blocked; Done | default Open |
| Due date | date | — | — |
| Assignee | select | members of the team, or "Unassigned (whole team)" | — |
| Notes | textarea | — | — |
| Reassignment reason | textarea | — | required when team or assignee changes (BR-TASK-1) |
- **Type options by team:** Compliance → KYC document verification, PAN–Name mismatch review, Re-KYC, AML screening, PEP review. Operations → Open bank account, Demat / Zerodha activation, Cheque collection, Address / detail change, Resolve login issue, Statement request. Investment → Portfolio review, Rebalance portfolio, IPS review, Strategy change, Suspense reconciliation. RM → Schedule meeting, Quarterly review, Yearly review, Follow up, Collect document.
- **Actions.** Create; edit; change status (drag or control) — records a system thread line; add comment. **BR-TASK-1** reassignment requires a reason, recorded immutably; **BR-TASK-2** status/reassignment changes are system thread entries. Empty: "No tasks in this view." / per column "Drop a ticket here."

#### S-14 — Calendar & S-15 — Schedule
- **Scope.** RM = own; Distributor = own + meetings with their clients; Investment/Leadership = team.
- **Presents.** Meetings grouped by day (Today/Tomorrow/date) with time, duration, status, title, RM, attendees, and a **Join** link for video meetings; overlaps flagged with a **Call client & reschedule** action (**BR-CAL-1**).
- **Schedule fields:**
| Field | Type | Default | Notes |
|---|---|---|---|
| Title | text | — | required |
| Date | date | next day | required |
| Time | time | 11:00 | — |
| Duration (min) | number | 45 | — |
| Type | select | Video meeting; Phone call | video → meeting link; phone → no link |
| With | select | a client/lead/colleague | primary invitee |
| Colleagues | checkboxes | team members | additional attendees |
- **Create:** generate the meeting + invites (INT-7). Confirmations: video "📅 Meeting scheduled · link created · invite sent"; phone "📞 Call scheduled · reminder added."
- **BR-CAL-2 (pre-call reminder):** remind the owner ~10 min before, with **Join / Snooze 5m / Dismiss**. [PM INPUT — server-driven multi-channel reminders (NFR 8.5).]

#### S-16 — Reviews & Reminders
- **Scope.** The user's funded clients.
- **Presents.** A summary of reviews due this week, then rows: Client (→ profile) · RM · Last reviewed · Status (overdue / this week) + due date · Actions.
- **Actions:**
| Action | Behaviour |
|---|---|
| Schedule call | create a review meeting (3 days out, 45 min, attendees client/RM/Investment) + invite |
| Send reminder | open a pre-filled message to the client (annual vs quarterly copy) |
| View IPS | the IPS document: investor profile (incl. age), objective, target allocation (equity = target %, debt = max(0, 95 − equity), cash = remainder), recommended strategies, blended benchmark, constraints/liquidity, review schedule, signature block |
| Email IPS | send the IPS to the client |
| Mark reviewed | set last review = today, next = +1 year (annual) / +1 quarter (quarterly) |
- **BR-REVIEW-1** cadence (annual IPS + quarterly portfolio). **BR-REVIEW-2** annual risk refresh; no client response within 14 days → flag the RM [PM INPUT — required automation]. Empty: "No reviews due this week — you're all caught up."
- **Review prep (pre-review brief).** A **📋 Review prep** action (here and on S-11 Portfolio) opens a per-account brief the RM reads before the meeting, with five sections:
  1. **Portfolio concentration** — holdings ranked by weight of current value; flag **watch ≥15%**, **over-concentrated ≥25%** (BR-REVIEW-3).
  2. **Drift from target allocation** — actual vs IPS target for **equity / debt / cash** (target equity = `ips.targetEquity`, debt = `max(0,95−equity)`, cash = remainder), drift in **pp**, flagged at **≥5pp**; **plus model-vs-actual security deviation** — the account's **blended model weight** (each strategy's model holdings weighted by that strategy's current value) vs the client's **actual** weight, the deviation in pp (flag ≥2pp), and the **Trim/Add amount in ₹** (= |dev| × current value). A **Generate rebalance proposal** action drafts the deltas to Investment. (BR-REVIEW-4 — live, per-account delta-rebalancing; divergence arises from entry date, cash flows and partial fills.)
  3. **Top gainers & losers** — holdings by return %.
  4. **Capital-gains tax position (this FY)** — **unrealised STCG / LTCG**, harvestable losses, and **estimated tax if sold now** (equity: STCG 20%, LTCG 12.5% on gains above the ₹1.25L FY exemption); harvesting prompts: realise up to the **₹1.25L LTCG exemption tax-free** then re-buy to step up basis, and **tax-loss harvesting** to offset realised gains. Holding period is estimated per lot from the funding/SIP dates (BR-REVIEW-5). *Not tax advice.* [PM INPUT — per-lot cost basis & acquisition dates from custodian (INT-5); confirm current FY rates/exemption.]
  5. **SIP status** — flags any **bounced SIP** (amount, date, reason) with **Retry** / **Raise to RM** (creates an RM follow-up task), else "on track". [PM INPUT — SIP mandate/bounce feed (INT-9).]
  - Download brief (PDF). Source: custodian holdings (A1, INT-5) + IPS + strategy models.

#### S-18 — Inbox
- **Scope.** Per user — Inbox = messages to the user; Sent = messages from the user. Unread indicator on the inbox.
- **Presents.** Inbox/Sent tabs; list rows (sender/recipient · subject · 110-char snippet · timestamp; unread styled); a reader.
- **Compose/reply fields:** From (the user's address) · To · Subject · Body. **Reply** pre-fills to=sender, subject "Re: …", body quoting the original. **Send** persists and delivers; confirmation "Email sent from <address>."
- **Rule.** System-dispatched communications (reports S-19, IPS, agreements, custodian reports S-36) appear here and in the client's correspondence. [PM INPUT — mailbox integration, attachments, inbound capture; INT-8.]

---

### 4.6 · Reporting & Compliance

#### S-19 — Client Reports
- **Scope.** The user's clients. **List:** per client, last-sent date for Monthly / Half-yearly / Tax, and a View & send action.
- **Report contents:**
| Report | Contents |
|---|---|
| Monthly | current valuation; invested; P&L (signed); holdings summary; the month's trades; advisor commentary; the period fee invoice |
| Half-yearly | as Monthly, over the half-year |
| Tax | STCG, LTCG and dividend income for the FY; formatted ITR-ready (Schedule CG + Schedule OS) |
- **Send:** records the dispatch with **delivery → open → acknowledgement** receipts and delivers to the client (recorded in correspondence). Confirmation "<report> sent · delivery & open receipts logged."
- **BR-DISPATCH-1** schedule (Monthly by the 1st of the next month; Half-yearly end-Sep & end-Mar; Tax in April for the prior FY). **BR-DISPATCH-2** figures sourced from custodian + fee engine. [PM INPUT — auto-send vs maker-checker (#4); templates; tracking provider (INT-6); attach the document.]

#### S-30 — RIA Compliance · KYC File
- **Scope.** RIA-track clients. Per client: a status (**Verified / Flagged / Pending**) and a checklist; actions **Mark verified**, **Raise to RM** (flags + raises an RM task), **Send IPS to client**, **Record the client's read-only demat grant**.
- **Checklist (item → complete-when):**
| Group | Item | Complete when |
|---|---|---|
| Account opening | Full name / Email / Mobile / Residential address | present (display) |
| KYC (DIGIO) | PAN & identity verified | DIGIO-verified |
| | Aadhaar e-KYC completed | DIGIO-verified |
| | Date of birth verified | DIGIO-verified |
| | CKYC registered | registered (amber while "pending") |
| | KRA KYC verified | KRA status = Verified |
| Agreement etc. | Disclosure document accepted | accepted |
| | Risk profile questionnaire (+ communicated) | present (+ communicated flag) |
| | Client agreement (DIGIO e-sign) | signed (link to signed PDF; else "Pending signature") |
| | Boarding letter / welcome kit | dispatched |
| Suitability & demat | Suitability assessment (IPS) | prepared (+ sent date); **Send to client** action |
| | Demat / trading access | client-granted, **read-only**, **not revocable by Flameback** (BR-DEMAT-1); officer records the grant + access log |
- **Rules.** **BR-KYC-1** RIA KYC is digital via DIGIO — **no manual proof uploads, no CRM-vs-document matching.** **BR-DEMAT-1** demat is client-granted read-only and non-revocable. [PM INPUT — DIGIO/CKYC/KRA fields & exact complete rules; who may mark verified.]

#### S-31 — Monthly SEBI Report
- **Header.** Firm name · SEBI registration number · "all active clients" · generation timestamp. **Export to PDF.**
- **Summary tiles.** Active clients · Fully compliant · Pending items · Gaps — action needed.
- **Matrix.** Each RIA client × the ten SEBI items, each **green / amber / red**:
| # | Item | Green | Amber | Red |
|---|---|---|---|---|
| i | Client agreement | signed | questionnaire done | else |
| ii | Client disclosure document | accepted | — | else |
| iii | Risk profile questionnaire | communicated to client | present | else |
| iv | Boarding letter / welcome kit | dispatched | — | else |
| v | Rationale for investment advice | advice record exists | funded | else |
| vi | KYC & CKYC documents | KRA verified & CKYC not pending | CKYC pending | else |
| vii | Client correspondence | ≥1 call or email on record | — | else |
| viii | Suitability assessment / financial plan | prepared | — | else |
| ix | Investment advice record | ≥1 trade/advice record | funded | else |
| x | Invoice issued | ≥1 invoice | — | else |
- **Roll-up (BR-COMP-1):** any red → "gap"; else any amber → "pending"; else "complete" (fully compliant only when all green).
- **Drill-down (per client):** SEBI item grid; **identity** (name, email, CKYC #, **PAN masked**, **Aadhaar masked**, RM, client-since); **document links** (signed agreement, risk questionnaire, suitability, financial plan); **trade & advice audit trail** (advice, approval token, broker order id, confirmation); **report dispatch log**; **correspondence log** (calls + emails, newest first).
- **BR-PII-1** PAN/Aadhaar masked by default; unmasked viewing restricted to the compliance officer and **every unmasked view is written to the immutable audit log** and included in the monthly report. [PM INPUT — SEBI reg no; ratify item rules; masking matrix (#8).]

#### S-32 — Fee Payments (e-NACH)
- **Scope.** Funded RIA clients. **Tiles:** Collected (Σ successful) · Failed · On auto-debit (count).
- **Table:** Client · Amount · Debit date · **Status** (Success / Failed / Pending) · **Failure reason** · Actions.
- **Actions (failed rows):** **Retry** (mark cleared, today's date; confirmation "Auto-debit retried — cleared") · **Raise to RM** (create an RM follow-up task). **BR-FEE-1.** Example failure reasons: insufficient balance; mandate expired — re-authorisation needed. [PM INPUT — fee computation source, debit cadence, mandate lifecycle (#12).] Empty: "No fee debits."

#### S-33 — SEBI RIA Daily Report
- **Controls.** Month selector (multi-year range). **Export CSV.**
- **Tiles (selected month):** New added (signed-up in month) · Exited (exit date in month) · Active (funded & not exited) · Inactive (not funded & not exited) · Total on books (signed up ≤ month-end and not exited before month-end).
- **Register columns (14):** Start date · Client name (+ "exited" flag) · Contact · Email · Product · Strategy · **PAN** · CKYC/KRA proof (link) · Resident status · Agreement link · City · State · Country · Gender. Empty: "No RIA clients."
- **BR-METRIC-3** register definitions. [PM INPUT — confirm SEBI column set; PAN shown unmasked here — confirm authority + audit (BR-PII-1).]

#### S-34 — PMS Review (FIU / grey list)
- **Banner.** PMS KYC/CKYC/document checks are performed by the onboarding partner **outside the CRM**; the officer's only in-CRM job is FIU AML screening.
- **Scope.** PMS-track clients. **Tiles:** PMS clients · FIU cleared · Grey-listed.
- **Table:** Client (+ product) · PAN · **FIU AML** (Not screened / Clear + date / Flagged + date) · **Onboarding eligibility** (Eligible / ⛔ Grey-listed — cannot onboard) · **Run / Re-run FIU check**.
- **Run effect:** record result + date. **BR-PMS-1** an FIU match grey-lists the client and **hard-blocks onboarding** until cleared. [PM INPUT — FIU provider & match logic (INT-4); clearance workflow; partner hand-off boundary.]

#### S-35 — Regulatory Filings
- **Filings (fund-level):**
| Filing | Frequency | Source | Submission |
|---|---|---|---|
| SEBI — Monthly PMR (Portfolio Manager Report) | Monthly | Custodian API | via the SEBI PMR portal |
| APMI — fund-level submission | Quarterly | CRM | direct |
| PMSBazaar — fund performance upload | Monthly | CRM | direct |
- **Tiles:** Tracked · Due this week · Overdue · Uploaded. **Table:** Filing (+ portal link) · Frequency · Source · **Due** (overdue/today/tomorrow styling) · **Status** (Pending/Fetched/Uploaded) · Action.
- **Actions:** **Fetch from custodian** (custodian-sourced filings) → Fetched; **Upload / Upload via SEBI portal** → opens the portal, marks Uploaded with date. **BR-FILING-1** these are fund-level, not per client. [PM INPUT — custodian mapping (INT-5); PMR portal confirmation flow (INT-10); APMI/PMSBazaar formats.]

#### S-36 — Custodian Reports
- **The 10 reports (the actual custodian set for PMS clients):**
| Report | Frequency | Contents (mirrors the custodian PDF) |
|---|---|---|
| Portfolio Statement | Monthly | Portfolio appraisal by asset class — security, qty, unit cost, cost, market value, gain/loss, %G/L, %assets, + cash |
| Transaction Statement | Monthly | Buys/sells — date, security, qty, unit price, settlement amount, brokerage, STT, exchange |
| Performance Report | Monthly | Portfolio allocation; summary (net capital in, realised/unrealised gain, income, fees, value); returns 1M–SI vs **NIFTY 500 TRI** |
| Factsheet | Monthly | Sector allocation; portfolio summary; **TWRR** (MTD/QTD/YTD/SI) vs S&P BSE 200; holdings |
| Corporate Benefits | Monthly | Corporate actions — bonus, dividend, split, merger, spin-off |
| Statement of Capital Gain/Loss | Quarterly | Realised gains — sale/purchase, **LT/ST**, days held; ST/LT summary |
| Statement of Dividend | Quarterly | Dividends — security, qty, rate, gross, TDS, net; summary |
| Corpus Report | Quarterly | Capital register — contributions, withdrawals, balance |
| Expense Statement | Quarterly | Management fees, custodian fees, STT, transaction charges |
| Profit & Loss / Balance Sheet | Half-yearly | P&L account + balance sheet for the period |
| *(Custody cut-off timings — Axis Bank)* | Reference | Operational custody cut-offs — not a per-client report |
  Each report type has an **auto-send** flag (auto-dispatched to the client each period).
- **Scope.** Funded PMS clients. **Tiles:** PMS clients · Reports sent (of clients × types) · Report types (10). **List:** Client (+ product) · Sent count (n/10) · Last sent · **Manage & send** (Compliance) / **View reports** (RM).
- **Per-client view:** per report — name + description · frequency · **Auto/Manual** flag · last sent · **delivery status** (Pending / Delivered / Seen) · **👁 View** (opens a faithful preview built from the client's holdings; Download PDF) · **Send** (Compliance only); plus **Send all to client** (Compliance). **BR-FILING-2** per-client (distinct from S-35).
- **RM access (read-only).** RMs get the same screen **scoped to their own PMS clients** — they can **view and download** each report but **not send** (sending is auto-dispatched by PMS Compliance). [PM INPUT — custodian source & field mapping per report (INT-5); delivered-vs-seen tracking (INT-6); auto-send schedule per type.]

---

### 4.7 · Distributor / Wealth Manager portal (external)
RM-style experience scoped to the partner's own book; the only difference from an internal RM is that the RM they contact is Flameback.

#### S-26 — Distributor Dashboard
- **Tiles:** AUM with Flameback (Σ current) · Total invested (across N clients) · **Net gain** (current − invested; caption = return %) · Clients (count) · Reviews due this week.
- **Worklist "Your clients":** Client (→ profile) · City · AUM (current) · CAGR · Next review (earliest of next quarterly/annual). Plus a **Contact your Flameback RM** affordance. Empty: "No clients yet."

#### S-27 — Distributor Clients
- **Columns:** Client ID · Name · City · AUM (current) · CAGR · Product. Row → profile. Empty: "No clients yet."

#### S-28 — Distributor Strategies
- **Per strategy card:** 1Y · 3Y CAGR · Since-inception returns; footer = count of the distributor's clients in the strategy + their AUM. [PM INPUT — performance source (#13).]

#### S-29 — Distributor Invoices
- **Filters:** Date range (All / Past 1 year / Past 3 years / This year) · Status (Paid / Unpaid).
- **Tiles:** Total invoiced · Paid (bar = paid/total) · Outstanding.
- **Table:** Date · Client (+ id) · Description · Amount · Status (Paid/Pending) · **Download** (individual). Plus **Download all (CSV)**. Generated invoice shows an 18% GST split (base + GST = total). Empty: "No invoices yet." [PM INPUT — invoice numbering, GST treatment, legal entity/GSTIN, document format (#12).]

---

### 4.8 · Marketing

#### S-25 — Content
- **Article fields:** Title · Summary · Tags (multi-select from the vocabulary) · Date.
- **List columns:** Title · Tags · Date · **Reach** (count of unique clients whose tags intersect) · Actions **Edit** / **Who** (lists matching recipients). Editor shows a live reach preview. **BR-CONTENT-1.** Empty: "No articles yet — add one and tag it; it auto-delivers to matching clients." [PM INPUT — delivery channel/timing; Marketing PII (#10).]

#### S-23 — Audience Lists
- **Filters (all multi-select unless noted):**
| Filter | Values |
|---|---|
| Category | Direct / Retail; HNI / UHNI; Family Office; Corporate Account; Trust / HUF; NRI; Distributor; Wealth Manager; IFA / Referral; Institution |
| City | the set of client/distributor cities |
| Zone | North; South; West; East |
| Account type | PMS; PMS Lite (RIA); International investing |
| Distributor | Direct + the distributor list |
| RM | the RM list |
| Minimum AUM | number |
| Include prospects | toggle |
- **Resolution:** the set of clients (and, if prospects included, leads) matching all selected filters; a list shows its live member count and a filter summary; editor shows a member preview. Empty: "No lists yet — create one to segment your audience."

#### S-24 — Events
- **Fields:** Name · Lead · Co-lead · Date · Venue · Groups (attached audience lists).
- **List columns:** Name · Lead · Co-lead · Date · Groups · **Count** (de-duplicated unique invitees across the attached lists) · Edit. Editor shows a live unique-invitee counter. Empty: "No events yet — plan one to get started."

---

### 4.9 · B2B / Partnerships & Leadership

#### S-37 — Partner Pipeline
- **Scope.** Partnerships RM = own; Head = all.
- **Partner fields:** Firm · Type (Wealth Manager / Family Office / Distributor / IFA · Referral) · Source (Instagram / Referral / LinkedIn / Meta ad / Inbound) · City · Contact name · Phone · Email · Stage (New / Qualified / Meeting set / In discussion / Onboarded / Not interested) · Assigned RM · Mode (Visit / Online) · Interaction history · Notes.
- **Pipeline columns:** Firm · Type · Source · City · Stage · RM (or "unassigned") · Mode (🏢 In-person / 🎥 Online / —) · **Work**.
- **Work-a-partner view:** an **engagement recommendation** (in-person if the assigned RM shares the partner's city, else online — **BR-B2B-1**); contact details; editable **Stage** and **Assigned RM** (assignment is the Head's right; assigning an RM to a New lead auto-promotes to Qualified); **log Call/Email/Meeting**; **Schedule online meet** / **Schedule in-person visit** (requires an RM — **BR-B2B-2**; sets the mode, auto-promotes New/Qualified → Meeting set, creates a meeting — 60 min visit / 30 min online); Notes; interaction history.

#### S-38 — B2B Dashboard (Head)
- **Tiles:** Partner leads · Unassigned (no RM, not "Not interested") · In engagement (Meeting set / In discussion) · Onboarded.
- **Per-RM table:** RM · City · Assigned · Scheduled (mode set) · Onboarded.
- **Attention list:** unassigned partners with an **Assign** action. **BR-B2B-3** the Head assigns the Partnerships RM. [PM INPUT — add a dedicated B2B qualifier queue? (#2).]

#### S-39 — Leadership
- **Department toggle:** Sales · Investment · Compliance · Operations.
- **Tiles.** *Sales:* Active leads · Outreach this week · Meetings this week · Pre-investment (L4) · Needs attention. *Investment / Compliance / Operations:* Completed · In progress · Open · Overdue · Needs attention.
- **"Needs attention" feed** with one-click actions, by department:
| Department | Items → actions |
|---|---|
| Sales | Five-strike leads → Write off / Reassign · Overdue follow-ups → Nudge RM · Unqualified app leads → Nudge Lead Desk |
| Investment | Quarterly/Annual review due or overdue → Mark reviewed / Open client |
| Compliance | Flagged client → Open verification / Open client · KYC pending → Open verification |
| All | Blocked task → Reassign / Escalate · Overdue task → Reassign / Escalate |
- **Actions:** Nudge (notify a team member) · Mark reviewed · Write off (out-list) · Escalate (raise priority + record). Plus per-person scorecards. [PM INPUT — "Nudge" must be a real notification; confirm metrics/scorecards.]

---

### 4.10 · Universal screens

#### S-41 — Strategies Catalog (internal)
- **Scope.** RM, Investment, Leadership (sidebar **Strategies**). A firm-wide catalog of every strategy, independent of any one client.
- **Per strategy card:** name · category · benchmark · **1Y / 3Y / since-inception** performance · risk band · fund manager · minimum investment · strategy AUM · top-3 holdings preview · **count of the viewer's funded clients invested + their AUM in the strategy** (scoped per 3.2: RM/Distributor = own book, Investment/Leadership = all). Action **View fact sheet & holdings** opens the same modal as S-11 Tab 5 — here with no client position (the model fact sheet + holdings only). **BR-STRAT-1** (read-only). [PM INPUT — fact-sheet & holdings system of record (INT-5).]

#### S-21 — Knowledge Hub
In-app documentation for every role (overview, teams & duties, lead flow, five-strike, assignment, onboarding, clients, tasks, compliance, reviews, leadership, a team-handoff diagram, a "how do I…" guide, and a glossary). [PM INPUT — ownership and update process.]

#### S-22 — Feature Suggestions
A shared board where any user submits and up-votes suggestions, each with a status (Requested / Planned / In Progress / Shipped). [PM INPUT — ships in production? moderation, retention.]

#### Cross-cutting — navigation counters
Navigation surfaces live, scope-respecting counts to draw attention: active leads, out-listed leads, clients in scope, open team tasks, items awaiting verification, reviews due this week, the assignment queue, onboarding in flight, today's meetings, unread mail, PMS items not cleared, and the active partner pipeline.

---

## 5. Business Logic & Rules

### 5.1 RIA vs PMS routing
- **BR-ROUTE-1.** Initial lumpsum **< ₹50 lakh → RIA track** (*PMS Lite (RIA)*); **≥ ₹50 lakh → PMS track**. *International investing* is a separate product. Compliance routing follows the product: RIA → S-30–S-33; PMS → S-34–S-36. [PM INPUT #1 — confirm threshold; International routing.]

### 5.2 Household & accounts
- **BR-HH-1.** Mobile number = household key; ≤1 account per product per person; family members under the primary's number; one row per account.
- **BR-HH-2.** Onboarding forms keyed by mobile and resumable. [PM INPUT — two of same product; OTP verification.]

### 5.3 Lead lifecycle & five-strike
- **BR-LEAD-1.** Stages L1 Cold → L2 Hot/Holding → L3 Onboarding → L4 Pre-Investment.
- **BR-LEAD-2.** At L1, five unanswered outreaches flag for the Out List (reason required; logging a response resets). L1 only.
- **BR-LEAD-3.** *Not Interested* out-lists the lead.

### 5.4 Metrics & formulas
- **BR-METRIC-1 (CAGR).** CAGR = (current ÷ invested)^(1 ÷ years) − 1; under one year, show *return since inception* instead.
- **BR-METRIC-2 (Gain).** current − invested, signed and colour-coded.
- **BR-METRIC-3 (RIA register).** active = funded & not exited; inactive = not funded & not exited; exited = exit date set; counts as of month-end; new/exited keyed to the month.
- **BR-METRIC-4 (AUM).** Σ current value over the scoped funded accounts. [PM INPUT — CAGR "years" basis; absReturn/IRR sourced from custodian.]
- **BR-METRIC-5 (per-strategy allocation).** An account's invested/current value is split across its assigned strategies by deterministic weights; the parts **reconcile exactly** to the account total (the last strategy absorbs the rounding remainder). [PM INPUT — replace the demo derivation with the custodian's true per-strategy holdings (INT-5).]

### 5.5 Compliance status (SEBI report)
- **BR-COMP-1.** Each item i–x green/amber/red (5.31 rules); fully compliant only when all green (any red → gap; else any amber → pending).

### 5.6 FIU grey list (PMS)
- **BR-PMS-1.** An FIU AML match grey-lists the client and hard-blocks onboarding until cleared.

### 5.7 Fees (RIA)
- **BR-FEE-1.** Advisory fees via e-NACH auto-debit; per-cycle status + failure reason; retry / escalation. [PM INPUT — fee computation & cadence (#12).]

### 5.8 Schedules
- **BR-SCH-1.** Monthly report by the 1st (next month); Half-yearly end-Sep & end-Mar; Tax in April for the prior FY. SEBI RIA register daily; PMR/APMI/PMSBazaar fund-level. Reviews: annual IPS + quarterly portfolio; annual risk refresh (no response 14 days → flag RM). [PM INPUT — auto-send vs maker-checker (#4); the 14-day automation.]

### 5.9 B2B engagement-by-city
- **BR-B2B-1.** Assigned RM's city = partner's city → in-person visit; else online. Scheduling advances stage to "Meeting set".

### 5.10a Review prep & rebalancing
- **BR-REVIEW-3 (concentration).** A holding ≥15% of current value = *watch*; ≥25% = *over-concentrated*.
- **BR-REVIEW-4 (model-vs-actual drift).** The account's model is the **blend of its strategies' model holdings**, each weighted by that strategy's current value. Per-security deviation = actual weight − model weight; |deviation| ≥2pp is actionable (Trim if over, Add if under), sized in ₹ as |deviation| × current value. Asset-class drift vs the IPS target is flagged at ≥5pp. Divergence from the model is expected (entry date, cash flows, partial fills); the brief makes it visible per account and feeds a rebalance proposal.
- **BR-REVIEW-5 (capital gains).** Equity STCG (held <12m) taxed 20%; LTCG (≥12m) 12.5% on gains above the ₹1.25L FY exemption. Estimated tax = STCG×20% + max(0, LTCG−₹1.25L)×12.5%. Per-lot holding period estimated from funding & SIP dates pending true cost-basis data. [PM INPUT — custodian cost basis; current FY rates.]

### 5.10 Content routing & strategy
- **BR-CONTENT-1.** A client receives an article when the article's tags intersect the client's tags.
- **BR-STRAT-1.** Strategy is backend-assigned, read-only in the CRM. [PM INPUT #5 — standardise product/strategy naming with the RIA App; surface Cruise tiers (Shield/Steady/Navigator/Accelerate/Maverick)?]

---

## 6. Integrations
For each, define provider, auth, field mapping, retry/fallback, webhook/callback (open item #7).

| # | Integration | Purpose | Screens |
|---|---|---|---|
| INT-1 | DIGIO | Agreement e-signature + digital KYC (PAN/name/DOB/Aadhaar); signed-doc storage | S-09, S-30 |
| INT-2 | CKYC registry | CKYC fetch/update (RIA) | S-09, S-30, S-31 |
| INT-3 | KRA | KYC Registration Agency status | S-30, S-31 |
| INT-4 | FIU (AML) | PMS screening by PAN → grey list | S-34 |
| INT-5 | Custodian / fund administrator | Holdings/valuations/returns; fund-level filing data; per-client custodian reports | S-10/S-11, S-19, S-35, S-36 |
| INT-6 | Transactional email + tracking | Send reports/content/IPS; delivered/opened/acknowledged | S-19, S-30, S-36, S-25 |
| INT-7 | Calendar / video meeting | Events, links, invites; reminders | S-06, S-14, S-15, S-16, S-37 |
| INT-8 | Email / mailbox | Inbox send/receive | S-18 |
| INT-9 | Payment / e-NACH | Mandate + advisory-fee auto-debit; status & reasons | S-32 |
| INT-10 | SEBI PMR portal / APMI / PMSBazaar | Fund-level submissions | S-35 |
| INT-11 | WhatsApp Business | Outreach + delivery receipts; client notifications | S-04, S-11 |
| INT-12 | Account Aggregator (RBI AA) | Optional financials import during onboarding | S-09 |

> [PM INPUT] The custodian/administrator sync (INT-5) is the backbone for all portfolio figures, reports and filings; define it first.

---

## 7. Error Handling
### 7.1 Access
| Case | Behaviour |
|---|---|
| Out-of-scope record requested | Deny at the API ("You don't have access to this record."); log the attempt. |
| Wrong-product compliance role | RIA Compliance cannot open PMS clients and vice-versa. |

### 7.2 Validation
| Case | Behaviour |
|---|---|
| Lead without a name | Block; require name. |
| Onboarding below the e-sign threshold | E-sign disabled until ≥85% (BR-ONB-1). |
| Invalid onboarding mobile | Block; require a valid 10-digit number. |
| Account without a member name | Block; require name. |
| Task reassignment without a reason | Block; require reason (BR-TASK-1). |
| Assign without a meeting date | Block; require date. |
| List/event/article without a name/title | Block; require it. |
| B2B schedule with no RM | Block; require RM (BR-B2B-2). |
| Report to a missing/invalid client email | Block and flag the client. |
| Second account of the same product | Block (BR-HH-1). |

### 7.3 Integration failures
| Integration | Behaviour |
|---|---|
| DIGIO e-sign fails | Retry; show "e-sign pending"; no technical codes. |
| Custodian fetch fails | Mark "fetch failed"; alert PMS Compliance. |
| e-NACH debit fails | Show the reason; offer retry / raise-to-RM. |
| Email send bounces | Mark failed; notify the sender. |

### 7.4 General
Never show raw technical error codes; always a human message + a recovery path.

---

## 8. Non-Functional Requirements
- **8.1 Performance.** P95 page < 2s; report generation asynchronous with progress. [PM INPUT — SLAs.]
- **8.2 Platform.** Web (desktop + tablet). [PM INPUT — mobile.]
- **8.3 Security.** RBAC at the data layer; PAN/Aadhaar/demat/bank encrypted at rest (AES-256), keys in a secrets manager; TLS 1.2+.
- **8.4 SEBI / DPDP.** DPDP consent captured & timestamped; unmasked PAN/Aadhaar restricted to the compliance officer with **every unmasked view audit-logged** (immutable, exportable, included in the monthly report); SEBI retention norms. [PM INPUT — masking matrix; audit store.]
- **8.5 Notifications.** [PM INPUT — channels (SMS/WhatsApp/email/push) + triggers: review-due, report dispatch, fee failure, filing-due, 10-min pre-call, e-sign-pending, five-strike.]

---

## 9. Out of Scope (first release)
| Item | Notes |
|---|---|
| Client-facing RIA App | Separate spec. |
| Live portfolio analytics / P&L engine | Sourced from custodian (INT-5). |
| Rebalancing / execution engine | Referenced, not built here. |
| HUF / intermediary onboarding | Deferred. |

---

## 10. Open Items — PM Sign-Off Required
| # | Item | Decision | Ref |
|---|---|---|---|
| 1 | RIA vs PMS threshold | Confirm ₹50L; International routing | 5.1 |
| 2 | B2B Qualifier | Dedicated queue or Head-assigns? | S-38 |
| 3 | Lead → client conversion | Auto-create the account on signature? id/product/strategy assignment | S-09 |
| 4 | Report & filing dispatch | Auto-send vs maker-checker | 5.8 |
| 5 | Product/strategy naming | Standardise; Cruise tiers? | 5.10 |
| 6 | Authentication | SSO/MFA; partner login; identity→role | 3.3 |
| 7 | Integration providers | Provider/auth/mapping/retry/webhook for INT-1…12 | 6 |
| 8 | Masking & audit | Roles seeing unmasked PII; the audit log | 8.4 |
| 9 | Notifications | Channels + triggers | 8.5 |
| 10 | Marketing PII | Client-level or aggregates? | 4.8 |
| 11 | Field edit authority | Who edits which account/KYC fields | S-11 |
| 12 | Fee model | Computation, cadence, GST/invoice numbering, entity/GSTIN | 5.7, S-29 |
| 13 | Strategy performance source | System of record | S-28 |
| 14 | Onboarding fields | Authoritative list, mandatory set, gate rule | S-09 |
| 15 | Dedup on sign-up | Auto-merge same-number sign-ups | S-06 |
| 16 | Account lifecycle stages | Canonical stages + derivation | S-10 |
| 17 | Concurrency | Per-entity locking/versioning | 2.2 |

---

## 11. End-to-End Flows
**B2C.** Advertising / website / app sign-up → **Lead / Assignment** (S-03/S-05). For an app sign-up the **Qualifier** picks the best-fit RM and books the intro with a video invite (S-06); lead → qualified, L2. The **RM** runs onboarding (S-07): mobile-first hub (S-08), one resumable form per account (S-09), reaching e-signature at the gate; signature → L4 and (per #3) creates the funded **Account**, visible in **Clients/Profiles** (S-10/S-13); the RM runs **meetings/reviews/reports** (S-14/S-16/S-19). **Compliance** runs in parallel — RIA: S-30→S-33; PMS: S-34→S-36. **Marketing** content reaches clients by tag intersection.

**B2B.** Partner inbound (S-37) → the **Head assigns** a Partnerships RM (S-38) → engage online/visit by city → onboarded → the partner receives the **Distributor portal** (S-26–S-29).

**Guardrails.** *Audit-acknowledge (don't hard-block) unless noted:* five-strike out-listing, task-reassignment reason, strategy read-only, DPDP consent, unmasked-PII logging. *Hard blocks:* FIU grey list (no onboarding), report send to an invalid email, out-of-scope data access.

---

## Appendix A — Domain Entities & Relationships
(Detailed attributes are specified in a separate data-design document.)

- **Lead** — a prospective B2C relationship (manual or app-originated); stage, status, owning RM, outreach history, qualification state.
- **Household** — the set of people and accounts sharing one mobile number (the household key).
- **Person** — an individual within a household (primary holder or family member, with a relationship).
- **Account** — one product holding (PMS Lite (RIA) / PMS / International) for one person; product/track, billing plan, lifecycle stage, funded state, attributed distributor; links to custodian-sourced portfolio data.
- **Onboarding Form** — data capture for opening one account; keyed to the household mobile; resumable; completion & e-sign state.
- **Meeting** — a calendar event (call/video/visit) with attendees, time, duration, link.
- **Task** — a cross-team request: team, type, linked client, priority, status, assignee, activity thread.
- **Message** — an internal mail item (inbox/sent), including system-dispatched client communications.
- **Compliance Record (RIA)** — per RIA account: KYC file state, SEBI i–x states, suitability, demat-access record, verdict.
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
- **Partner Lead** — a B2B prospect firm: type, source, city, stage, assigned RM, mode, interaction history.
- **Audit Entry** — an immutable record of a sensitive action or data access.

**Relationships.** Household 1—* Person; Household 1—* Account; Person 1—* Account (≤1 per product); Account *—1 Distributor; Account 1—1 Compliance Record / AML Screening; Account 1—* Report Dispatch / Fee Cycle; Lead *—1 RM; Onboarding Form *—1 Household; Audience List *—* Account; Event *—* Audience List; Article *—* Tag; Person/Account *—* Tag.

---

## Appendix B — Glossary, Enumerations & Colour Legend

**Enumerations**
- **Lead stage:** L1 Cold · L2 Hot/Holding · L3 Onboarding · L4 Pre-Investment.
- **Lead status:** New · Cold · Potential · Hot · Onboarding · Not Interested.
- **Onboarding steps:** Captured details · Authenticated · Choosing path · In progress · Advisory routing · Sign agreement · Fund account · Onboarded.
- **Products:** PMS Lite (RIA) · PMS · International investing.
- **Billing plan:** Monthly · Quarterly · Yearly.
- **Task status:** Open · In Progress · Blocked · Done. **Priority:** High · Medium · Low.
- **RIA compliance status:** Verified · Flagged · Pending.
- **PMS AML:** Not screened · Clear · Flagged (grey-listed).
- **B2B stage:** New · Qualified · Meeting set · In discussion · Onboarded · Not interested. **Mode:** Visit · Online.
- **Filing status:** Pending · Fetched · Uploaded.
- **Report delivery:** Pending · Delivered · Seen (reports may add Acknowledged).
- **Marketing categories:** Direct/Retail · HNI/UHNI · Family Office · Corporate Account · Trust/HUF · NRI · Distributor · Wealth Manager · IFA/Referral · Institution.
- **Zones:** North · South · West · East.
- **SEBI compliance items:** i–x (S-31).

**Colour legend**
- **Green** — complete / compliant / cleared / success.
- **Amber** — in progress / due soon / pending.
- **Red** — missing / failed / overdue / blocked / grey-listed.

**Glossary**
- **Household** — all accounts and family members on one mobile number.
- **CAGR since inception** — annualised return; under one year, *return since inception* is shown.
- **Five-strike** — at L1, five unanswered outreaches flag a lead for the Out List.
- **Grey list** — an FIU AML-matched PMS client who cannot be onboarded.
- **e-NACH** — the auto-debit mandate used to collect advisory fees.
- **PMR** — SEBI Portfolio Manager Report (fund-level, monthly).
- **IPS** — Investment Policy Statement (suitability document).
- **Suspense holding** — an unreconciled position awaiting custodian reconciliation.
- **Track** — RIA vs PMS, per BR-ROUTE-1, governing compliance routing.

*End of document.*





