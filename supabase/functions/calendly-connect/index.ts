// Supabase Edge Function: calendly-connect
// Called from the CRM by a signed-in RM.
//   { action: "connect", token }  → checks the Calendly token, subscribes to that RM's bookings,
//                                   stores the connection, saves their booking link on their profile.
//   { action: "disconnect" }      → removes the Calendly subscription and the stored connection.
//   { action: "event_types" }     → the RM's active Calendly event types.
//   { action: "available_times", event_type, start_time, end_time } → open slots (max 7 days).
//   { action: "book", lead_id, event_type, start_time, email?, guests?[] }
//                                 → books the lead into the RM's Calendly; Calendly emails the invites,
//                                   and calendly-webhook then updates the lead as for any booking.
//   { action: "cancel", lead_id, event_uri?, reason? } → cancels that meeting, or the lead's next one.
// Deploy with "Verify JWT" ON (only signed-in CRM users may call it).

import { createClient } from 'npm:@supabase/supabase-js@2';

const CAL = 'https://api.calendly.com';
const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

async function cal(token: string, path: string, init: RequestInit = {}) {
  const res = await fetch(path.startsWith('http') ? path : CAL + path, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(init.headers ?? {}) },
  });
  const text = await res.text();
  let body: any = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = { message: text }; }
  return { ok: res.ok, status: res.status, body };
}

function calError(r: { status: number; body: any }): string {
  const msg = r.body?.message || r.body?.title || `Calendly returned ${r.status}`;
  if (r.status === 401) return 'Calendly rejected that token. Generate a new one and paste it again.';
  if (r.status === 403) return `Calendly says this account's plan doesn't allow this (${msg}).`;
  return msg;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  try {
    const url = Deno.env.get('SUPABASE_URL')!;
    const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

    // who is calling?
    const jwt = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
    const { data: who, error: whoErr } = await admin.auth.getUser(jwt);
    if (whoErr || !who.user) return json({ error: 'Please sign in again.' }, 401);
    const userId = who.user.id;
    const { data: prof } = await admin.from('profiles').select('id, is_active').eq('id', userId).maybeSingle();
    if (!prof?.is_active) return json({ error: 'Your CRM access is not active.' }, 403);

    const body = await req.json().catch(() => ({}));
    const { action, token } = body;
    const { data: existing } = await admin.from('calendly_connections').select('*').eq('user_id', userId).maybeSingle();

    if (['event_types', 'available_times', 'book', 'cancel'].includes(action)) {
      return await schedule(action, body, { url, admin, jwt, userId, conn: existing });
    }

    // remove the old subscription first (connect again, or disconnect)
    if (existing?.webhook_uri) {
      await cal(existing.access_token, existing.webhook_uri, { method: 'DELETE' }).catch(() => undefined);
    }

    if (action === 'disconnect') {
      await admin.from('calendly_connections').delete().eq('user_id', userId);
      await admin.from('profiles').update({ calendly_url: null, calendly_connected_at: null }).eq('id', userId);
      return json({ ok: true });
    }
    if (action !== 'connect' || typeof token !== 'string' || token.trim().length < 20) {
      return json({ error: 'Paste your Calendly personal access token.' }, 400);
    }
    const t = token.trim();

    const me = await cal(t, '/users/me');
    if (!me.ok) return json({ error: calError(me) }, 400);
    const calUser = me.body.resource;

    const hookUrl = `${url}/functions/v1/calendly-webhook?rm=${userId}`;
    const signingKey = crypto.randomUUID().replaceAll('-', '') + crypto.randomUUID().replaceAll('-', '');
    const payload = {
      url: hookUrl,
      events: ['invitee.created', 'invitee.canceled'],
      organization: calUser.current_organization,
      user: calUser.uri,
      scope: 'user',
      signing_key: signingKey,
    };
    let hook = await cal(t, '/webhook_subscriptions', { method: 'POST', body: JSON.stringify(payload) });
    if (hook.status === 409) {
      // a subscription to this URL already exists (e.g. connected before): remove it and retry
      const list = await cal(t, `/webhook_subscriptions?scope=user&organization=${encodeURIComponent(calUser.current_organization)}&user=${encodeURIComponent(calUser.uri)}&count=100`);
      for (const w of list.body?.collection ?? []) {
        if (w.callback_url === hookUrl) await cal(t, w.uri, { method: 'DELETE' });
      }
      hook = await cal(t, '/webhook_subscriptions', { method: 'POST', body: JSON.stringify(payload) });
    }
    if (!hook.ok) return json({ error: calError(hook) }, 400);

    const { error: saveErr } = await admin.from('calendly_connections').upsert({
      user_id: userId,
      calendly_user_uri: calUser.uri,
      organization_uri: calUser.current_organization,
      scheduling_url: calUser.scheduling_url,
      webhook_uri: hook.body.resource.uri,
      signing_key: signingKey,
      access_token: t,
      connected_at: new Date().toISOString(),
    });
    if (saveErr) return json({ error: saveErr.message }, 500);
    await admin.from('profiles').update({ calendly_url: calUser.scheduling_url, calendly_connected_at: new Date().toISOString() }).eq('id', userId);

    return json({ ok: true, scheduling_url: calUser.scheduling_url, calendly_email: calUser.email });
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
});

/* ───────── scheduling from inside the CRM ───────── */

type Ctx = { url: string; admin: ReturnType<typeof createClient>; jwt: string; userId: string; conn: any };

async function schedule(action: string, body: any, ctx: Ctx): Promise<Response> {
  const { conn } = ctx;
  if (!conn && action !== 'cancel') return json({ error: 'Connect your Calendly first (Settings → Calendly).' }, 400);

  if (action === 'event_types') {
    const r = await cal(conn.access_token, `/event_types?user=${encodeURIComponent(conn.calendly_user_uri)}&active=true&count=100`);
    if (!r.ok) return json({ error: calError(r) }, 400);
    const types = (r.body?.collection ?? []).map((e: any) => ({
      uri: e.uri, name: e.name, duration: e.duration, kind: e.kind,
      locations: (e.locations ?? []).map((l: any) => ({ kind: l.kind, location: l.location ?? null })),
    }));
    return json({ event_types: types });
  }

  if (action === 'available_times') {
    const { event_type, start_time, end_time } = body;
    if (!event_type || !start_time || !end_time) return json({ error: 'Pick an event type and a date.' }, 400);
    const q = `event_type=${encodeURIComponent(event_type)}&start_time=${encodeURIComponent(start_time)}&end_time=${encodeURIComponent(end_time)}`;
    const r = await cal(conn.access_token, `/event_type_available_times?${q}`);
    if (!r.ok) return json({ error: calError(r) }, 400);
    const slots = (r.body?.collection ?? []).filter((x: any) => x.status === 'available').map((x: any) => x.start_time);
    return json({ slots });
  }

  // book / cancel act on a lead: the caller must be able to open it (row-level security decides)
  const userDb = createClient(ctx.url, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: `Bearer ${ctx.jwt}` } } });
  const { data: lead } = await userDb.from('leads').select('id, name, email, phone').eq('id', body.lead_id ?? '').maybeSingle();
  if (!lead) return json({ error: 'Lead not found.' }, 404);

  if (action === 'book') {
    const email = String(body.email || lead.email || '').trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json({ error: 'Calendly needs the client\'s email. Add it and try again.' }, 400);
    if (!body.event_type || !body.start_time) return json({ error: 'Pick a time slot.' }, 400);
    const guests = (Array.isArray(body.guests) ? body.guests : [])
      .map((g: unknown) => String(g).trim().toLowerCase())
      .filter((g: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(g) && g !== email)
      .slice(0, 10);

    // use the event type's own location (e.g. Google Meet) so Calendly accepts the booking
    const et = await cal(conn.access_token, body.event_type);
    const loc = et.ok ? (et.body?.resource?.locations ?? [])[0] : null;

    const payload: Record<string, unknown> = {
      event_type: body.event_type,
      start_time: new Date(body.start_time).toISOString().replace(/\.\d{3}Z$/, 'Z'),
      invitee: { name: lead.name, email, timezone: 'Asia/Kolkata' },
    };
    if (loc?.kind) payload.location = loc.location ? { kind: loc.kind, location: loc.location } : { kind: loc.kind };
    if (guests.length) payload.event_guests = guests;

    // Tag the booking with the lead id so the webhook matches it to this lead.
    // Calendly wants every tracking field present; try the full set, then variants, then no tag
    // (the webhook still matches on the client's email).
    const base = { utm_source: 'flameback_crm', utm_medium: 'crm', utm_campaign: 'crm_booking', utm_content: lead.id, utm_term: 'crm' };
    const attempts: (Record<string, unknown> | null)[] = [
      { ...base, salesforce_uuid: null },
      { ...base, salesforce_uuid: '' },
      null,
    ];
    let r: Awaited<ReturnType<typeof cal>> | null = null;
    for (const tracking of attempts) {
      const body2 = tracking ? { ...payload, tracking } : payload;
      r = await cal(conn.access_token, '/invitees', { method: 'POST', body: JSON.stringify(body2) });
      const aboutTracking = r.status === 400 && JSON.stringify(r.body ?? {}).includes('tracking');
      if (r.ok || !aboutTracking) break;
    }
    if (!r!.ok) return json({ error: calError(r!) + (r!.body?.details ? ` · ${JSON.stringify(r!.body.details)}` : '') }, 400);
    const res = r!;
    // remember the email we booked with, if the lead didn't have one
    if (!lead.email) await ctx.admin.from('leads').update({ email }).eq('id', lead.id).is('email', null);
    return json({ ok: true, invitee: res.body?.resource?.uri ?? null });
  }

  if (action === 'cancel') {
    // a specific meeting (when rescheduling), else the lead's next upcoming one
    let q = ctx.admin.from('calendly_events').select('*').eq('lead_id', lead.id).eq('status', 'active');
    q = body.event_uri ? q.eq('event_uri', body.event_uri) : q.gt('start_time', new Date().toISOString()).order('start_time', { ascending: true });
    const { data: ev } = await q.limit(1).maybeSingle();
    if (!ev) return json({ error: 'This lead has no upcoming Calendly meeting.' }, 404);
    // cancel with the token of the RM whose calendar holds the meeting
    const { data: owner } = await ctx.admin.from('calendly_connections').select('access_token').eq('user_id', ev.rm_id).maybeSingle();
    if (!owner) return json({ error: 'The RM whose Calendly holds this meeting has disconnected Calendly. Cancel it in Calendly.' }, 400);
    const uuid = String(ev.event_uri).split('/').pop();
    const r = await cal(owner.access_token, `/scheduled_events/${uuid}/cancellation`, {
      method: 'POST', body: JSON.stringify({ reason: String(body.reason || 'Cancelled by Flameback').slice(0, 500) }),
    });
    if (!r.ok) return json({ error: calError(r) }, 400);
    return json({ ok: true });
  }
  return json({ error: 'Unknown action' }, 400);
}
