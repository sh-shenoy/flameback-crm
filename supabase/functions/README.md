# Edge functions (Cal.com, Gmail, AI summary)

Small functions that run inside Supabase. Each is pasted in once through the Supabase dashboard; no tools to install.

| Function | What it does | JWT verification |
|---|---|---|
| `calcom` | Called from **Connections → Cal.com** and the lead page. Checks the RM's Cal.com API key, sets up the booking webhook, lists event types and free slots, books meetings (with extra invitees) and cancels them. | **On** (only signed-in CRM users) |
| `calcom-webhook` | Cal.com calls it when someone books, reschedules or cancels. Every request is checked against that RM's secret (X-Cal-Signature-256), then the lead is created or moved to Awaiting meeting. | **Off** (Cal.com can't sign in; the signature check protects it) |
| `gmail` | Called from **Connections → Gmail** and the lead page. Saves the RM's Gmail connection, sends emails from their address, and pulls emails with their leads onto the timeline. | **On** |
| `summarize` | Called from the lead page. Reads everything on the lead (with the RM's own permissions), strips phone numbers, emails, PAN and Aadhaar, asks OpenAI for a short structured summary and saves it. | **On** |
| `calendly-connect`, `calendly-webhook` | **Retired** (replaced by Cal.com). Safe to delete from Supabase once everyone has moved. | |

## Deploy (one time per function)

Supabase → **Edge Functions** → **Deploy a new function** → **Via Editor** → name it exactly as above → one file named `index.ts` with the contents of `<name>/index.ts` (GitHub → Raw → copy all) → **Deploy**. For `calcom-webhook`, then open its settings and turn **JWT verification off**.

Run the matching migration first (`0006_calcom.sql` for Cal.com).

## Updating a function

When a change touches one of these files: Supabase → Edge Functions → open the function → **Code** → replace the whole `index.ts` → **Deploy**.

## Cal.com: each RM (one time)

1. Sign up at cal.com with their `@flamebackcapital.com` Google account and connect **Google Calendar** (so busy times are respected and Google Meet links are created).
2. In Cal.com → Apps, install **Google Meet**. The CRM creates the standard Flameback meeting types (Admin → Meeting types) in their account when they connect. Optional booking questions: "Phone number" and "Interested in: RIA / PMS / US RIA"; the CRM picks these up.
3. Cal.com → **Settings → Developer → API keys → Add** → name "Flameback CRM", **never expires** → copy.
4. CRM → **Connections → Cal.com** → paste → **Connect**. If the CRM can't add the webhook itself, it shows the URL and secret to add under Cal.com → Settings → Developer → Webhooks (events: booking created, rescheduled, cancelled).

## Gmail (one time)

1. **Google Cloud Console** (the project that holds the CRM's Google sign-in, under the flamebackcapital.com organisation):
   - **APIs & Services → Library → Gmail API → Enable**.
   - **Google Auth Platform → Audience**: **Internal**. **Data access**: add `https://www.googleapis.com/auth/gmail.send` and `https://www.googleapis.com/auth/gmail.readonly`.
2. **Supabase → Edge Functions → Secrets**: `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` (same values as Authentication → Google).
3. Deploy `gmail` (JWT verification **on**).
4. Each RM: CRM → **Connections → Gmail → Connect Gmail**.

## If something goes wrong

- **"function was not found"**: not deployed, or the name differs.
- **Bookings don't arrive**: Supabase → Edge Functions → `calcom-webhook` → **Logs**. `401 bad signature` usually means JWT verification is still on, or the webhook secret in Cal.com doesn't match (reconnect under Connections).
- **Cal.com errors** are shown word for word in the CRM; send them over if unclear.

## AI summary (one time)

1. Run `../migrations/0010_lead_summaries.sql`.
2. **Supabase → Edge Functions → Secrets**:
   - `OPENAI_API_KEY`: your OpenAI API key (platform.openai.com → API keys)
   - `OPENAI_MODEL` (optional): the model to use; defaults to `gpt-5-mini`
3. Deploy `summarize` (JWT verification **on**).

Summaries refresh by themselves after new activity on a lead; RMs can also click Refresh or edit them.
