# Flameback CRM — Decisions & Rationale (the "why")

Why things are the way they are, and the corrections made along the way. Read this with `CONTINUE_HERE.md` (status) and `FUNCTIONAL_SPEC.md` (the what). **The product source-of-truth is Shashank's *Flameback India RIA App* functional spec** (`~/Downloads/Cruise/FLAMEBACK CAPITAL RIA APP.docx`, CONFIDENTIAL — not in this repo). The CRM is its back-office counterpart; when in doubt, that doc and the open-items list win.

Format: **Decision · Why · Status/notes.**

## Platform & ways of working
- **Single self-contained `index.html`, no build/deps.** Why: fastest possible iteration for a demo/wireframe the PM shows to stakeholders; double-click to open. Status: keep until it becomes a real app.
- **Host on GitHub Pages, not Netlify.** Why: Netlify's credit allowance was burning down from frequent deploys; the repo is already on GitHub, Pages is free for a static file. Status: live, master auto-deploys. Repo made **public** (it's a wireframe with mock data; the Supabase anon key is safe to expose).
- **Edit via Python exact-match string-replace scripts.** Why: the file is large; harness line-numbers/Read can drift, and the shell cwd sometimes resets to `/Users/shenoy/CRM` (a stale copy). On-disk grep/sed/Python is the source of truth. Verify in the local preview before pushing.

## Core data model
- **Household = one mobile number; one row per account.** Why: a real client holds multiple products (one each of PMS/RIA/International) and family members (spouse/parent) sit under the same number. Clients list and onboarding are organised this way. One product per person (no duplicates) — flagged for confirmation.
- **Onboarding forms keyed by mobile (resumable).** Why: a client may start self-serve, drop off, then ask an RM for help — the same form must resume, not fork. Whoever picks it up (qualifier→RM) continues it.
- **Strategies are backend-assigned, read-only in the CRM.** Why: investment team/engine decides strategy; CRM shows performance, doesn't let RMs change it. (Removed the editable Strategies tab.)

## Roles & scoping
- **RM sees only their own book** (leads/clients/calendar/reviews/reports). **Investment & Leadership see all.** Why: RMs shouldn't browse the whole firm; leadership/investment need the all-up view. Distributors see only their own clients.
- **Qualifier focuses on the assignment queue; onboarding is RM-only.** Why: clear handoff — qualifier routes, RM owns onboarding. (Removed onboarding from the qualifier.)
- **Compliance is split: RIA Compliance (RIA clients) vs PMS Compliance (PMS clients).** Why: different SEBI regimes (IA vs PMS) → different obligations; each officer is scoped to their product set.

## Compliance — the important corrections
- **RIA KYC is verified digitally by DIGIO — no manual PAN/bank-proof uploads, no CRM-vs-doc match.** Why (correction): DIGIO does PAN/name/DOB/Aadhaar e-KYC itself; the earlier "upload + match" model was wrong.
- **PMS KYC/CKYC/document checks are done by the onboarding partner (Silver Bullet) OUTSIDE the CRM.** The CRM's only PMS-compliance job is **FIU AML screening → grey list** (an FIU match = cannot onboard). Why (correction): the partner handles KYC; don't rebuild it in the CRM.
- **Demat/trading access is client-granted, read-only, and CANNOT be revoked by us.** Why (correction): the client grants read-only access on the broker side; we only record it (removed the Revoke action).
- **To SEBI on the PMS side we file the Monthly PMR** via the SEBI portal (`…doPmr=yes`); APMI & PMSBazaar are also **fund-level/overall** submissions — NOT per client. **Per-client statements are the custodian reports** (8 of them), sent to each client with email delivery/seen tracking. Why: clarified fund-level vs per-client.
- **RIA fee is auto-debit (e-NACH) but the officer must still see status** — success/failure + reason, with retry / raise-to-RM. Why: automation still fails (insufficient balance, mandate expired) and compliance/RM must act.
- **SEBI RIA register is filed daily** with a fixed column set; plus a 5-year month view of new/exited/active/inactive. Why: SEBI daily reporting requirement.
- **Compliance officer is the only role with unmasked PAN/Aadhaar, and every unmasked view is audit-logged.** Why: DPDP/SEBI accountability. (Earlier we built a heavier RBAC/audit module, then the PM said keep it simpler/form-facing — so the masking/audit is present but the UI centres on the form-facing KYC file.)

## Distributors / B2B
- **Distributors get the SAME RM dashboard we give internal RMs**, scoped to their own clients, plus contact-your-RM. Why: a partner manages their book like an RM; only difference is the RM they reach is us. They also get clients/strategies/calendar/reviews/IPS/invoices.
- **B2B mirrors B2C** (partner firms via ads/referrals → qualify → RM → engage). **Engagement mode is decided by city** (RM in the partner's city → in-person visit, else online). Why: how partner relationships actually run.
- **B2B currently has the Head assign (no separate B2B qualifier yet).** Status: open item — PM to decide whether to add a B2B qualification queue.

## Marketing
- **Client tags = pain points/interests; tagged content auto-routes to matching clients.** Why: relevant content to the right clients. **AI-suggested tags are human-in-the-loop** (RM confirms) — never auto-applied.
- **Audience lists are multi-select** (many cities/distributors/categories at once) and segment by category (Direct/HNI/Family Office/Corporate/NRI/Distributor/WM/IFA/Institution).

## Unresolved / needs PM sign-off (don't guess — confirm)
1. **Product/strategy naming:** RIA App says "OMS Lite / OMS / International" in one place and "RIA / PMS" elsewhere; strategy tiers are **Cruise Shield/Steady/Navigator/Accelerate/Maverick**. The CRM currently shows "PMS Lite (RIA)/PMS/International" + generic Flameback strategies. Standardise.
2. **RIA vs PMS routing by lumpsum (< ₹50L RIA, ≥ ₹50L PMS)** — confirm threshold + how International routes for compliance.
3. **B2B qualifier** screen.
4. **Lead→client auto-conversion** on agreement signed (accounts are seeded today).
5. **Report auto-send vs maker-checker approval** before dispatch.
6. **Marketing PII** — segments only, or client-level?
7. Real integration providers (DIGIO/CKYC/FIU/custodian/ESP/AA/e-NACH/SMS) — see FUNCTIONAL_SPEC §6.
