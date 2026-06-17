# Flameback CRM — Changelog

Live demo: https://sh-shenoy.github.io/flameback-crm/

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

**Distributor / Wealth Manager portal**
- New external partner role with its own scoped view (seeded as ABC Wealth).
- Dashboard: welcome, AUM with Flameback (invested + current), net gain, number of clients, and a client list — plus a "Your Flameback relationship" contact card.
- Clients page: all of the partner's clients with city, AUM and CAGR; click through to a full client profile (personal details incl. DOB/profession, portfolio, IPS, reports).
- Strategies page: the strategies the partner can access, each with 1Y / 3Y CAGR / since-inception performance and the partner's AUM + client count in it.
- Contact button to call / email / WhatsApp the partner's Flameback RM.
