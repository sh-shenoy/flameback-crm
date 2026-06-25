# Flameback CRM — Changelog

Live demo: https://sh-shenoy.github.io/flameback-crm/

## 2026-06-25

**RM dashboard — client book & monthly touch-base**
- The RM dashboard now covers servicing, not just the lead pipeline: cards for **Clients** (funded count), **AUM** (your book), and **Touch-base due** (monthly check-in), alongside reviews-due and follow-ups-due.
- New **Monthly touch-base** panel — clients not contacted in 30+ days, sorted by longest-since-contact, each with product, AUM, last contact, next review, a **contextual "why now" talking point** (e.g. "Portfolio below cost — reassure", "Quarterly review overdue", "Discuss tax-harvesting before FY-end", "SIP step-up opportunity"), and **📅 Schedule** (creates a 30-min touch-base call + Meet invite) / **✓ Log call** (records the contact, clears them from the list).

**Clients → account view now includes the merged profile**
- Clicking a client (CID or number) opens the account view as before — now with a **Profile** tab (shown first) that merges the **household/person information** alongside the account: person details, **Tags** (pain points/interests, add/remove), **all accounts on that mobile number** (click to switch), **communication preferences**, **timeline** and **notes**, plus an **Open full profile ↗** link to the dedicated profile page. So one click gives both the account detail and the profile in one place.

**Custodian reports — real report set, viewable, auto-sent**
- Replaced the placeholder custodian report list with the **actual 10 reports the custodian sends for PMS clients**: Portfolio Statement, Transaction Statement, Performance Report, Factsheet, Corporate Benefits, Statement of Capital Gain/Loss, Statement of Dividend, Corpus Report, Expense Statement, and Profit & Loss / Balance Sheet (each with its real frequency).
- Each report is now **openable as a realistic preview** built from the client's own portfolio — matching the custodian's actual layout (e.g. Portfolio Statement = appraisal by asset class with Qty/Unit Cost/Cost/Market Value/Gain-Loss/%Assets; Performance Report = allocation + summary + returns vs NIFTY 500 TRI; Capital Gain/Loss with LT/ST; Dividend with TDS; P&L + Balance Sheet, etc.). Download PDF.
- **PMS Compliance** sends them to clients (per report or **Send all**), with **Auto-send** flagged per report type and delivery/seen tracking — unchanged.
- **RMs can now view** their own PMS clients' custodian reports: a new read-only **Custodian Reports** page (scoped to their book) — open/download any report, no send (those are auto-dispatched by Compliance).
- Custodian reports are scoped to **true PMS clients only** (`product = PMS`) — RIA and International-investing clients are excluded.

**Pre-review brief (Review prep)**
- A one-click **Review prep** brief on every funded client (Reviews & Reminders page, and the account's Portfolio tab) that surfaces, ahead of a client review:
  1. **Portfolio concentration** — top holdings by weight, flagged when a single name is over-concentrated (watch ≥15%, over-concentrated ≥25%).
  2. **Drift from target allocation** — actual vs the IPS target across equity/debt/cash (drift in pp, flagged ≥5pp), **plus model-vs-actual security deviation**: the blended model weight (across the account's strategies) vs the client's actual holding, the deviation, and the **trim/add delta in ₹** — i.e. live, per-account delta-rebalancing. **Generate rebalance proposal** button.
  3. **Top gainers & losers** — best/worst holdings by return.
  4. **Capital-gains tax position** — unrealised **STCG / LTCG**, harvestable losses, estimated tax if sold now, and India-specific **harvesting opportunities**: realise up to the ₹1.25L LTCG exemption tax-free (re-buy to step up basis), and **tax-loss harvesting** to offset gains.
  5. **SIP status** — flags any **SIP that bounced** (amount, date, reason) with Retry / Raise-to-RM, else confirms on-track.
- Demo data now spans realistic client **tenure** (new clients → STCG; the established Khanna household → LTCG) so both tax cases show.

**Strategy-level visibility for RMs**
- The account view now has a **Strategies** tab showing **what the client has invested in each strategy in that account** — invested, current value, gain, return and since-inception CAGR per strategy, summing exactly to the account total. Read-only (strategies are assigned by the Investment team).
- Each strategy opens a **Fact sheet & holdings** card: category, benchmark, inception, strategy AUM, minimum investment, risk, fund manager, objective and 1Y/3Y/since-inception performance — plus the **strategy's model holdings** (weights), with the client's value per holding shown for this account.
- The same per-strategy breakdown and fact-sheet link now appear on the **Person Profile** account cards (under "Strategy performance").
- New standalone **Strategies** page in the sidebar (RM, Investment, Leadership) — a catalog of every strategy with category, benchmark, 1Y/3Y/since-inception performance, risk, manager, min investment, strategy AUM, top holdings, how many of your clients are invested (+ their AUM in it), and one click into the full fact sheet & holdings.
- The strategy **fact sheet is now a full report**: a **performance graph** with **toggleable timeframes** (1M / 3M / 6M / 1Y / 3Y / 5Y / Since inception), the **since-inception CAGR** *and* the client's **return since their own investment** (with a "Your entry" marker plotted on the chart), and an **asset-allocation split** across **equity / debt / cash** (shown both as % and as rupee amounts in the client's account) — alongside the existing fact-sheet fields and holdings.

## 2026-06-15

**Profiles**
- New searchable directory of every lead and client (by name, email or number); leads and a household's accounts link into one person.
- Profile page with four tabs:
  - **Accounts** — each PMS / RIA / International account with amount invested, current value, CAGR since inception, strategy performance, holdings, last rebalance proposal sent, and last rebalanced by client (for RIA).
  - **Communication preferences** — editable channels, frequency, language, preferred time, do-not-disturb.
  - **Timeline** — reach-outs for leads (method, date, notes); onboarding / funding / rebalance history for clients.
  - **Notes** — free-text notes about the client as a person (family, interests, context).
- Each account now shows a **portfolio performance graph**, per-strategy performance and holdings. Open an account to its own page — a family member's account shows their name with "linked to [primary holder] · [relation]" — and **Reports are a tab inside that account** (account-specific, not client-level).
- Removed the Strategies tab (strategies are pre-decided / backend-managed) and the KYC tab (not RM-visible) from the account detail.

**Accounts & households**
- One person (one number) can hold a PMS, an RIA and an International account — one of each.
- Family members (e.g. spouse) are linked under the primary's number.
- Clients list shows one row per account, grouped by household, with a quick-view dropdown (holdings, CAGR since inception, invested / current).
- Onboarding is now a household hub: enter a number → see every account on it → resume any, or add more accounts (PMS / RIA / International) and family members, each with its own product and agreement / e-sign.
- Product tags on clients (PMS Lite (RIA) / PMS / International investing) with a filter.

**Calendar & reminders**
- Pop-up alert 10 minutes before each call (Join / Snooze), with a Preview button.
- RMs can manually schedule a meeting or call with any client, lead or colleague — auto-generates a Google Meet link and sends the Google Calendar + Gmail invite.

**Roles & access**
- RMs see only their own leads, clients, onboarding, calendar and reviews.
- Investment team sees all clients, performance and the team calendar (not allotted clients), plus tasks.
- Qualifier focuses on the assignment queue (onboarding tab removed; onboarding is RM-only).

**Tags & content routing**
- **Client tags** capture pain points / interests (Tax implications, Multi-generational dialogue, Retirement, Real estate, Succession, Children's education, ESG, Liquidity event, Sector focus, Market volatility, …). Add from a preset list or create your own.
- **AI-suggested tags** — the profile suggests tags inferred from RM notes & meeting transcripts that the RM hasn't added yet; one click to accept.
- **Content auto-routing** — Marketing uploads an article under **Content**, tags it, and it auto-delivers to every client carrying a matching tag. Each client profile shows the content shared with them; the article shows its reach.

**Marketing**
- New Marketing team role and view, centred on event planning.
- **Audience Lists** — reusable, saved segments with **multi-select** filters (pick several cities, distributors, categories, etc. at once). Filter by **Category** (Direct/Retail, HNI/UHNI, Family Office, Corporate, Trust/HUF, NRI, Distributor, Wealth Manager, IFA/Referral, Institution), City, Zone, Account type, Distributor, RM, minimum AUM, and optionally include prospects. Live member preview. Channel partners (distributors, wealth managers, family offices, IFAs) are included in the audience pool.
- **Events** — name the event, assign a lead and co-lead, attach one or more audience lists as groups, set date/venue; shows the unique invitee count (deduped across groups).

**Knowledge Hub**
- Added a team handoff flow diagram (Qualifier → RM → Operations / Compliance → Investment → ongoing reviews).

## Earlier

- Onboarding form linked by mobile number (resume self-serve drop-offs), with advisory routing (PMS Lite (RIA) / PMS / International) and an e-sign request for the agreement.
- Leadership / owner view with per-department throughput, "needs your attention" escalations, and per-person scorecards.
- Leads pipeline (L1–L4, Five-Strike rule, Out list), assignment queue, tasks & requests board, compliance verification, portfolios & IPS, reviews & reminders, and a shared feature-suggestions board.

## 2026-06-16

**SEBI RIA daily report + client metrics**
- New SEBI RIA Report (RIA Compliance): the daily client register submitted to SEBI — start date, name, contact, email, product, strategy, PAN, CKYC/KRA proof link, resident status (Individual-Resident / NRI / NRO / Non-Individual / Non-Resident), agreement PDF link, city & state, country, gender — viewable as a list and exportable to CSV.
- Month selector (5-year history) with new-added / exited / active / inactive / total counts as of the chosen month.
- Fixed an unclosed-table bug in the B2B dashboard that nested later sections incorrectly.

**Docs**
- Restructured **FUNCTIONAL_SPEC.md** to match the Flameback RIA App spec format (the gold standard): Sections 1–11 — Overview & Scope, Architecture & Screen Inventory (40 screens), Roles & Auth, Screen-by-Screen specs, Business Logic & Rules, Integrations, Error Handling tables, NFRs, Out of Scope, **Open Items requiring PM sign-off**, and End-to-End Flows — with **PM INPUT** boxes. Aligned product truth to the app (RIA <₹50L / PMS ≥₹50L routing, Cruise strategy tiers, the app's onboarding feeding the CRM). **FLOWS.md** keeps the one-page overview.
- Added FUNCTIONAL_SPEC.md — a full functional spec of the project (roles, modules, B2C/B2B flows, compliance, data model, simulated integrations, known gaps).
- Refreshed the in-app Knowledge Hub: updated team roster, added a "Modules & roles map" section, and expanded the glossary (DIGIO, FIU, grey list, SEBI PMR, APMI/PMSBazaar, e-NACH, custodian, B2B vs B2C).

**B2B / Partnerships module**
- A B2C→B2B counterpart for acquiring partner firms (distributors, wealth managers, family offices, IFAs) who reach us via Instagram / ads / referrals / inbound.
- **Partner Pipeline:** firm, type, source, city, stage, assigned RM and engagement mode. Open a partner to log interactions, set stage, and (Head) assign a Partnerships RM.
- **City-based engagement:** the CRM recommends an in-person visit when the RM is in the partner's city, else an online meet — with one-click "Schedule online meet" (Google Meet) or "Schedule in-person visit".
- **Partnerships RM** sees only their assigned partners; **Partnerships Head** gets a dashboard (pipeline by stage, per-RM breakdown, unassigned partners needing an RM).

**RIA fee payments (auto-debit status)**
- Fee Payments view for the RIA Compliance officer: advisory fee auto-debit (e-NACH) status per RIA client — cleared vs failed with the failure reason (e.g. insufficient balance, mandate expired) — with Retry and Raise-to-RM (opens a pre-filled follow-up task).

**PMS Compliance module (PMS Compliance Team)**
- New PMS Compliance role with three workspaces, scoped to PMS clients:
  - **PMS Review (FIU screening & grey list):** PMS KYC/CKYC/document checks are done by the onboarding partner outside the CRM; here the officer runs the FIU AML check (by PAN) — any FIU match is grey-listed and cannot be onboarded.
  - **Regulatory Filings:** fund-level / firm-wide submissions — SEBI Monthly PMR (links to the SEBI PMR portal), APMI and PMSBazaar — fetched from the custodian and uploaded, with due-date reminders. (Per-client statements are under Custodian Reports.)
  - **Custodian Reports:** per-client — each PMS client has their own panel of the 8 custodian reports; send each (or all) to the client, with per-report email delivery / seen tracking via the connected 3rd-party email system.
- APIs (custodian, FIU, email tracking) are simulated in this wireframe.

**Monthly SEBI compliance report**
- New compliance report (compliance officer): header with Flameback's SEBI registration number + generation timestamp, exportable to PDF. Four summary metrics (active clients, fully compliant, pending, gaps). A client-level table with green/amber/red status for all ten SEBI mandatory items (i–x). Click any client for a drill-down: identity (PAN/Aadhaar masked to last 4), document links, trade & advice audit trail (approval token, broker order ID, confirmation status), report dispatch log, and correspondence log.

**Client Reports console**
- New Client Reports page: for each client, view and send the **Monthly** (holdings summary, trades, P&L, valuation, advisor commentary + attached fee invoice), **Half-yearly**, and **Tax** (STCG / LTCG / dividend income, ITR-ready) reports. Each send logs **delivery, open and acknowledgement receipts** in the CRM and posts the report to the client's inbox. Scoped per role (RM/Distributor see their own clients; Investment/Leadership see all).

**Compliance — form-facing KYC files**
- Reworked the compliance officer's Verification view into a per-client KYC & Compliance File: the account-opening form (name, email, mobile, address), uploaded KYC documents (PAN card, Aadhaar card, bank proof) with view + match checks, CKYC, KRA, and the agreement/disclosure/risk section (Client Disclosure accepted, risk profile + communicated, DIGIO-signed agreement PDF, welcome kit). Verify / flag-to-RM per client.
- Stage 3 added: Suitability assessment (IPS) — prepared, document link, sent-to-client with one-click email — and demat/trading access logging (broker, masked account no., read-only access type, date granted; grant/revoke events logged as correspondence).

**Inbox (Gmail-linked)**
- Every role now has an Inbox (Inbox / Sent tabs) showing email to and from their address. The existing Gmail composer now delivers into it; opening a mail marks it read and Reply pre-fills to the sender. Unread count shows on the sidebar. Seeded with sample mail across RM, distributor and client addresses.

**Distributor / Wealth Manager portal**
- New external partner role with its own scoped view (seeded as ABC Wealth).
- Dashboard: the same RM-style dashboard we give our own RMs, scoped to the partner's clients — cards for clients, AUM, net gain and reviews-due-this-week, a client panel, and a "Reach out to your Flameback RM" contact card (call / email / WhatsApp). Only difference vs an internal RM: the RM they contact is us.
- Clients page: all of the partner's clients with city, AUM and CAGR; click through to a full client profile (personal details incl. DOB/profession, portfolio, IPS, reports).
- Strategies page: the strategies the partner can access, each with 1Y / 3Y CAGR / since-inception performance and the partner's AUM + client count in it.
- Contact button to call / email / WhatsApp the partner's Flameback RM.
- Partners get the RM action tools for their own book too: **Calendar** (schedule meetings with their clients — and their Flameback RM — generating a Google Meet invite), **Reviews & Reminders** (IPS reviews due) and **Portfolios & IPS** (review IPS) — all scoped to their clients.
