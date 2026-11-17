// Supabase Edge Function: calcom
// Called from the CRM by a signed-in RM. Deploy with "Verify JWT" ON.
//   { action: "connect", api_key }  → checks the Cal.com API key, sets up the booking webhook, saves the connection
//   { action: "disconnect" }         → removes the webhook and the saved connection
//   { action: "event_types" }        → the RM's Cal.com event types
//   { action: "slots", event_type_id, date }  → free start times on that date (IST)
//   { action: "book", lead_id, event_type_id, start_time, email?, guests?[] } → books the lead; Cal.com emails invites
//   { action: "cancel", lead_id, booking_uid?, reason? } → cancels that meeting (or the lead's next one)
//   { action: "sync_event_types" }   → creates any Flameback standard meeting types (Admin → Meeting types)
//                                      missing from the RM's Cal.com; never changes or removes existing ones
// Bookings come back through calcom-webhook, which updates the lead.

import { createClient } from 'npm:@supabase/supabase-js@2';

const API = 'https://api.cal.com/v2';
const V_BOOKINGS = '2024-08-13', V_SLOTS = '2024-09-04', V_EVENT_TYPES = '2024-06-14';
const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

async function cal(key: string, path: string, init: RequestInit & { version?: string } = {}) {
  const { version, ...rest } = init;
  const res = await fetch(path.startsWith('http') ? path : API + path, {
    ...rest,
    headers: {
      Authorization: `Bearer ${key}`, 'Content-Type': 'application/json',
      ...(version ? { 'cal-api-version': version } : {}), ...(rest.headers ?? {}),
    },
  });
  const text = await res.text();
  let body: any = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = { message: text }; }
  return { ok: res.ok, status: res.status, body };
}

function calError(r: { status: number; body: any }): string {
  const e = r.body?.error;
  const msg = (typeof e === 'string' ? e : e?.message) || r.body?.message || `Cal.com returned ${r.status}`;
  const details = e?.details ? ` · ${typeof e.details === 'string' ? e.details : JSON.stringify(e.details)}` : '';
  if (r.status === 401) return 'Cal.com rejected that API key. Create a new one (Cal.com → Settings → Developer → API keys) and paste it again.';
  return `Cal.com: ${msg}${details}`;
}

/** Create the Flameback standard meeting types that this RM's Cal.com doesn't have yet. */
async function syncEventTypes(admin: any, key: string, username: string | null) {
  const { data: templates } = await admin.from('meeting_templates').select('*').eq('is_active', true).order('sort_order');
  let r = await cal(key, '/event-types', { version: V_EVENT_TYPES });
  if (r.ok && !list(r.body?.data).length && username) r = await cal(key, `/event-types?username=${encodeURIComponent(username)}`, { version: V_EVENT_TYPES });
  if (!r.ok) return { created: [], existing: [], failed: [{ title: 'all', error: calError(r) }] };
  const have = new Set(list(r.body?.data).map((e: any) => String(e.slug)));
  const created: string[] = [], existing: string[] = [], failed: { title: string; error: string }[] = [];
  let meetFallback = false;
  for (const t of templates ?? []) {
    if (have.has(t.slug)) { existing.push(t.title); continue; }
    const base = { title: t.title, slug: t.slug, lengthInMinutes: t.length_minutes, description: t.description ?? undefined };
    // prefer Google Meet; if Cal.com won't accept it (e.g. Google not connected), create with Cal.com's default video
    let c = await cal(key, '/event-types', { method: 'POST', version: V_EVENT_TYPES,
      body: JSON.stringify({ ...base, locations: [{ type: 'integration', integration: 'google-meet' }] }) });
    if (!c.ok && c.status === 400) {
      c = await cal(key, '/event-types', { method: 'POST', version: V_EVENT_TYPES, body: JSON.stringify(base) });
      if (c.ok) meetFallback = true;
    }
    if (c.ok) created.push(t.title); else failed.push({ title: t.title, error: calError(c) });
  }
  return { created, existing, failed, meet_fallback: meetFallback };
}

const list = (d: any): any[] => Array.isArray(d) ? d : Array.isArray(d?.eventTypes) ? d.eventTypes
  : Array.isArray(d?.eventTypeGroups) ? d.eventTypeGroups.flatMap((g: any) => g.eventTypes ?? []) : [];

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  try {
    const url = Deno.env.get('SUPABASE_URL')!;
    const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    const jwt = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
    const { data: who } = await admin.auth.getUser(jwt);
    if (!who?.user) return json({ error: 'Please sign in again.' }, 401);
    const userId = who.user.id;
    const { data: prof } = await admin.from('profiles').select('id, is_active').eq('id', userId).maybeSingle();
    if (!prof?.is_active) return json({ error: 'Your CRM access is not active.' }, 403);

    const body = await req.json().catch(() => ({}));
    const { data: conn } = await admin.from('calcom_connections').select('*').eq('user_id', userId).maybeSingle();

    /* ── connect / disconnect ── */
    if (body.action === 'connect' || body.action === 'disconnect') {
      if (conn?.webhook_id) await cal(conn.api_key, `/webhooks/${conn.webhook_id}`, { method: 'DELETE' }).catch(() => undefined);
      if (body.action === 'disconnect') {
        await admin.from('calcom_connections').delete().eq('user_id', userId);
        await admin.from('profiles').update({ cal_url: null, cal_connected_at: null }).eq('id', userId);
        return json({ ok: true });
      }
      const key = String(body.api_key ?? '').trim();
      if (key.length < 10) return json({ error: 'Paste your Cal.com API key.' }, 400);
      const me = await cal(key, '/me');
      if (!me.ok) return json({ error: calError(me) }, 400);
      const u = me.body?.data ?? me.body;
      const username = u?.username ?? null;
      const bookingUrl = username ? `https://cal.com/${username}` : null;

      const hookUrl = `${url}/functions/v1/calcom-webhook?rm=${userId}`;
      const secret = crypto.randomUUID().replaceAll('-', '') + crypto.randomUUID().replaceAll('-', '');
      const hook = await cal(key, '/webhooks', { method: 'POST', body: JSON.stringify({
        active: true, subscriberUrl: hookUrl, secret,
        triggers: ['BOOKING_CREATED', 'BOOKING_CANCELLED', 'BOOKING_RESCHEDULED'],
      }) });
      const webhookId = hook.ok ? String(hook.body?.data?.id ?? hook.body?.id ?? '') || null : null;

      const { error: saveErr } = await admin.from('calcom_connections').upsert({
        user_id: userId, calcom_user_id: u?.id ?? null, username, booking_url: bookingUrl,
        api_key: key, webhook_id: webhookId, webhook_secret: secret, connected_at: new Date().toISOString(),
      });
      if (saveErr) return json({ error: saveErr.message }, 500);
      await admin.from('profiles').update({ cal_url: bookingUrl, cal_connected_at: new Date().toISOString() }).eq('id', userId);

      const types = await syncEventTypes(admin, key, username).catch((e) => ({ created: [], existing: [], failed: [{ title: 'all', error: String(e) }] }));
      // If Cal.com wouldn't create the webhook, hand back what the RM needs to add it by hand.
      return json({
        ok: true, booking_url: bookingUrl, event_types: types,
        webhook_ok: !!webhookId,
        ...(webhookId ? {} : { webhook_error: calError(hook), webhook_url: hookUrl, webhook_secret: secret }),
      });
    }

    if (!conn) return json({ error: 'Connect your Cal.com first (Connections → Cal.com).' }, 400);
    const key = conn.api_key;

    if (body.action === 'sync_event_types') {
      return json({ ok: true, ...(await syncEventTypes(admin, key, conn.username)) });
    }

    if (body.action === 'event_types') {
      let r = await cal(key, '/event-types', { version: V_EVENT_TYPES });
      if (r.ok && !list(r.body?.data).length && conn.username) {
        r = await cal(key, `/event-types?username=${encodeURIComponent(conn.username)}`, { version: V_EVENT_TYPES });
      }
      if (!r.ok) return json({ error: calError(r) }, 400);
      const types = list(r.body?.data).filter((e: any) => !e.hidden).map((e: any) => ({
        id: e.id, title: e.title, slug: e.slug, length: e.lengthInMinutes ?? e.length ?? null,
        // video apps this meeting type offers, e.g. ["google-meet", "zoom"] (Cal.com: { type: "integration", integration })
        locations: (Array.isArray(e.locations) ? e.locations : [])
          .filter((l: any) => l?.type === 'integration' && typeof l.integration === 'string')
          .map((l: any) => l.integration as string),
      }));
      return json({ event_types: types });
    }

    if (body.action === 'slots') {
      const { event_type_id, date } = body;
      if (!event_type_id || !/^\d{4}-\d{2}-\d{2}$/.test(date ?? '')) return json({ error: 'Pick a meeting type and a date.' }, 400);
      const q = `eventTypeId=${encodeURIComponent(event_type_id)}&start=${date}&end=${date}&timeZone=Asia/Kolkata`;
      const r = await cal(key, `/slots?${q}`, { version: V_SLOTS });
      if (!r.ok) return json({ error: calError(r) }, 400);
      const d = r.body?.data ?? {};
      const raw: any[] = Array.isArray(d) ? d : (d[date] ?? d.slots?.[date] ?? Object.values(d.slots ?? d).flat());
      const now = Date.now();
      const slots = raw.map((s) => (typeof s === 'string' ? s : s.start ?? s.time)).filter(Boolean)
        .map((s: string) => new Date(s).toISOString()).filter((s: string) => new Date(s).getTime() > now);
      return json({ slots: [...new Set(slots)].sort() });
    }

    // book / cancel act on a lead: the caller must be able to open it (row-level security decides)
    const userDb = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: `Bearer ${jwt}` } } });
    const { data: lead } = await userDb.from('leads').select('id, name, email, phone').eq('id', body.lead_id ?? '').maybeSingle();
    if (!lead) return json({ error: 'Lead not found.' }, 404);

    if (body.action === 'book') {
      const email = String(body.email || lead.email || '').trim().toLowerCase();
      if (!EMAIL_RE.test(email)) return json({ error: 'Cal.com needs the client\'s email. Add it and try again.' }, 400);
      if (!body.event_type_id || !body.start_time) return json({ error: 'Pick a time slot.' }, 400);
      const guests = (Array.isArray(body.guests) ? body.guests : []).map((g: unknown) => String(g).trim().toLowerCase())
        .filter((g: string) => EMAIL_RE.test(g) && g !== email).slice(0, 10);
      const payload: Record<string, unknown> = {
        start: new Date(body.start_time).toISOString(),
        eventTypeId: Number(body.event_type_id),
        attendee: { name: lead.name, email, timeZone: 'Asia/Kolkata', language: 'en' },
        metadata: { lead_id: lead.id, source: 'flameback_crm' },
        ...(guests.length ? { guests } : {}),
      };
      // video app picked for this meeting (only when the meeting type offers more than one)
      const loc = typeof body.location === 'string' && /^[a-z0-9-]{2,40}$/.test(body.location) ? body.location : null;
      if (loc) payload.location = { type: 'integration', integration: loc };
      const r = await cal(key, '/bookings', { method: 'POST', version: V_BOOKINGS, body: JSON.stringify(payload) });
      if (!r.ok) return json({ error: calError(r) }, 400);
      if (!lead.email) await admin.from('leads').update({ email }).eq('id', lead.id).is('email', null);
      if (loc === 'google-meet' || loc === 'zoom') await admin.from('leads').update({ meeting_pref: loc }).eq('id', lead.id);
      return json({ ok: true, booking_uid: r.body?.data?.uid ?? null });
    }

    if (body.action === 'cancel') {
      let q = admin.from('meetings').select('*').eq('lead_id', lead.id).eq('status', 'active').eq('provider', 'calcom');
      q = body.booking_uid ? q.eq('booking_uid', body.booking_uid) : q.gt('start_time', new Date().toISOString()).order('start_time');
      const { data: m } = await q.limit(1).maybeSingle();
      if (!m) return json({ error: 'This lead has no upcoming Cal.com meeting.' }, 404);
      const { data: owner } = await admin.from('calcom_connections').select('api_key').eq('user_id', m.rm_id).maybeSingle();
      if (!owner) return json({ error: 'The RM whose calendar holds this meeting has disconnected Cal.com. Cancel it in Cal.com.' }, 400);
      const r = await cal(owner.api_key, `/bookings/${m.booking_uid}/cancel`, {
        method: 'POST', version: V_BOOKINGS,
        body: JSON.stringify({ cancellationReason: String(body.reason || 'Cancelled by Flameback').slice(0, 500) }),
      });
      if (!r.ok) return json({ error: calError(r) }, 400);
      return json({ ok: true });
    }

    return json({ error: 'Unknown action' }, 400);
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
});
