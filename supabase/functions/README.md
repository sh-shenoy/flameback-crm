# Edge functions (Calendly)

Two small functions run inside Supabase. They are pasted in once through the Supabase dashboard; no tools to install.

| Function | What it does | JWT verification |
|---|---|---|
| `calendly-connect` | Called from **Settings → Connect my Calendly**. Checks the RM's Calendly token and asks Calendly to notify the CRM of that RM's bookings. | **On** (only signed-in CRM users) |
| `calendly-webhook` | Calendly calls it when someone books or cancels. Every request is checked against that RM's secret signing key, then the lead is created or moved to Awaiting meeting. | **Off** (Calendly can't sign in; the signature check protects it) |

## Deploy (one time)

1. Run `../migrations/0003_calendly.sql` in **SQL Editor** first.
2. Supabase → **Edge Functions** → **Deploy a new function** → **Via Editor**.
   - Name: `calendly-connect` (exactly this)
   - Replace the sample code with the contents of `calendly-connect/index.ts` → **Deploy**.
3. Repeat for `calendly-webhook` with `calendly-webhook/index.ts`.
4. Open `calendly-webhook` → its settings → turn **JWT verification off** → save.

Nothing else to configure: the functions use the project's own URL and service key, which Supabase provides to them automatically.

## Each RM (one time)

1. Sign up for Calendly with their `@flamebackcapital.com` email and set up an event type (e.g. "Intro call", with Google Meet as the location).
2. Optional: add booking questions "Phone number" and "Interested in: RIA / PMS". The CRM picks these up.
3. Calendly → **Integrations & apps → API and webhooks → Personal access tokens → Generate new token**.
4. CRM → **Settings → Calendly** → paste the token → **Connect**.

## If something goes wrong

- **"The Calendly connector isn't set up in Supabase yet"**: step 2 above wasn't done, or the name differs.
- **"Calendly says this account's plan doesn't allow this"**: that Calendly account's plan can't send booking notifications. Upgrade that account, or use the booking link without automatic updates.
- **Bookings don't arrive**: Supabase → Edge Functions → `calendly-webhook` → **Logs**. A `401 bad signature` means JWT verification is still on, or the RM reconnected and an old subscription is still pointing here (reconnecting again fixes it).
