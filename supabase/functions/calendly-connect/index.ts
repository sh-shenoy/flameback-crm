// Supabase Edge Function: calendly-connect
// Called from the CRM's Settings page by a signed-in RM.
//   { action: "connect", token }  → checks the Calendly token, subscribes to that RM's bookings,
//                                   stores the connection, saves their booking link on their profile.
//   { action: "disconnect" }      → removes the Calendly subscription and the stored connection.
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

    const { action, token } = await req.json().catch(() => ({}));
    const { data: existing } = await admin.from('calendly_connections').select('*').eq('user_id', userId).maybeSingle();

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
