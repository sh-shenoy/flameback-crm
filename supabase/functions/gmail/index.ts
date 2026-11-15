// Supabase Edge Function: gmail
// Called by a signed-in RM from the CRM. Deploy with "Verify JWT" ON.
//   { action: "save", refresh_token }  → stores the RM's Gmail connection (after "Connect Gmail")
//   { action: "disconnect" }           → revokes and forgets it
//   { action: "send", lead_id, subject, body, cc?, thread_id? } → sends from the RM's Gmail; logged on the lead
//   { action: "sync", lead_id? }       → pulls emails with that lead (or with any of the RM's leads, recent)
//                                        onto the lead timelines; a lead's reply counts as a response
// Needs two secrets (Edge Functions → Secrets): GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET
// (the same values as Supabase → Authentication → Google).

import { createClient } from 'npm:@supabase/supabase-js@2';

const G = 'https://gmail.googleapis.com/gmail/v1/users/me';
const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

async function accessToken(refresh: string): Promise<string> {
  const id = Deno.env.get('GOOGLE_CLIENT_ID'), secret = Deno.env.get('GOOGLE_CLIENT_SECRET');
  if (!id || !secret) throw new Error('Gmail isn’t set up yet: add GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET under Supabase → Edge Functions → Secrets.');
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: id, client_secret: secret, refresh_token: refresh, grant_type: 'refresh_token' }),
  });
  const b = await res.json();
  if (!res.ok) throw new Error(b.error === 'invalid_grant' ? 'Google access has expired. Reconnect Gmail in Settings.' : `Google: ${b.error_description || b.error}`);
  return b.access_token;
}

async function g(token: string, path: string, init: RequestInit = {}) {
  const res = await fetch(path.startsWith('http') ? path : G + path, {
    ...init, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(init.headers ?? {}) },
  });
  const b = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = b?.error?.message || `Gmail returned ${res.status}`;
    throw new Error(res.status === 403 ? `Gmail refused (${msg}). Check the Gmail API is enabled in Google Cloud.` : msg);
  }
  return b;
}

const b64url = (s: string) => btoa(unescape(encodeURIComponent(s))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const b64 = (s: string) => btoa(unescape(encodeURIComponent(s)));
function decodeB64url(d: string): string {
  try {
    const bin = atob(d.replace(/-/g, '+').replace(/_/g, '/'));
    return decodeURIComponent(escape(bin));
  } catch { return ''; }
}
function header(msg: any, name: string): string {
  return msg.payload?.headers?.find((h: any) => h.name.toLowerCase() === name.toLowerCase())?.value ?? '';
}
function addresses(v: string): string[] {
  return [...v.matchAll(/[^\s<>,;"]+@[^\s<>,;"]+/g)].map((m) => m[0].toLowerCase());
}
function findPart(part: any, mime: string): string {
  if (!part) return '';
  if (part.mimeType === mime && part.body?.data) return decodeB64url(part.body.data);
  for (const p of part.parts ?? []) { const t = findPart(p, mime); if (t) return t; }
  return '';
}
// prefer the plain-text version anywhere in the email; fall back to HTML with tags removed
function plainText(part: any): string {
  return findPart(part, 'text/plain')
    || findPart(part, 'text/html').replace(/<br\s*\/?>|<\/p>/gi, '\n').replace(/<[^>]+>/g, ' ').replace(/[ \t]+/g, ' ').trim();
}
// drop the quoted earlier conversation from replies
function stripQuoted(t: string): string {
  const cut = t.search(/\n(On .+wrote:|-{2,} ?Original Message|From: .+\n)/);
  return (cut > 0 ? t.slice(0, cut) : t).trim();
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  try {
    const url = Deno.env.get('SUPABASE_URL')!;
    const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    const jwt = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
    const { data: who } = await admin.auth.getUser(jwt);
    if (!who?.user) return json({ error: 'Please sign in again.' }, 401);
    const userId = who.user.id;
    const { data: prof } = await admin.from('profiles').select('id, email, full_name, is_active').eq('id', userId).maybeSingle();
    if (!prof?.is_active) return json({ error: 'Your CRM access is not active.' }, 403);
    const body = await req.json().catch(() => ({}));
    const { data: conn } = await admin.from('google_connections').select('*').eq('user_id', userId).maybeSingle();

    if (body.action === 'save') {
      if (typeof body.refresh_token !== 'string' || body.refresh_token.length < 10) {
        return json({ error: 'Google didn’t return offline access. Disconnect the CRM in your Google account settings and connect again.' }, 400);
      }
      const at = await accessToken(body.refresh_token);
      const me = await g(at, '/profile');
      const address = String(me.emailAddress || '').toLowerCase();
      if (address !== String(prof.email).toLowerCase()) {
        return json({ error: `Connect the Gmail for ${prof.email} (you picked ${address}).` }, 400);
      }
      await admin.from('google_connections').upsert({ user_id: userId, google_email: address, refresh_token: body.refresh_token, connected_at: new Date().toISOString() });
      await admin.from('profiles').update({ gmail_address: address, gmail_connected_at: new Date().toISOString() }).eq('id', userId);
      return json({ ok: true, address });
    }

    if (body.action === 'disconnect') {
      if (conn) await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(conn.refresh_token)}`, { method: 'POST' }).catch(() => undefined);
      await admin.from('google_connections').delete().eq('user_id', userId);
      await admin.from('profiles').update({ gmail_address: null, gmail_connected_at: null }).eq('id', userId);
      return json({ ok: true });
    }

    if (!conn) return json({ error: 'Connect your Gmail first (Settings → Gmail).' }, 400);
    const at = await accessToken(conn.refresh_token);

    if (body.action === 'send') {
      // the caller must be able to open the lead (row-level security decides)
      const userDb = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: `Bearer ${jwt}` } } });
      const { data: lead } = await userDb.from('leads').select('id, name, email').eq('id', body.lead_id ?? '').maybeSingle();
      if (!lead) return json({ error: 'Lead not found.' }, 404);
      if (!lead.email) return json({ error: 'This lead has no email address.' }, 400);
      const subject = String(body.subject ?? '').trim();
      const text = String(body.body ?? '').trim();
      if (!subject || !text) return json({ error: 'Add a subject and a message.' }, 400);
      const cc = (Array.isArray(body.cc) ? body.cc : []).map((x: unknown) => String(x).trim()).filter((x: string) => EMAIL_RE.test(x)).slice(0, 10);

      const headers = [
        `From: ${prof.full_name ? `"${prof.full_name.replace(/"/g, '')}" ` : ''}<${conn.google_email}>`,
        `To: "${lead.name.replace(/"/g, '')}" <${lead.email}>`,
        ...(cc.length ? [`Cc: ${cc.join(', ')}`] : []),
        `Subject: =?UTF-8?B?${b64(subject)}?=`,
        'MIME-Version: 1.0',
        'Content-Type: text/plain; charset="UTF-8"',
        'Content-Transfer-Encoding: base64',
      ];
      let threadId: string | undefined;
      if (body.thread_id) {
        // reply in the same conversation
        try {
          const th = await g(at, `/threads/${body.thread_id}?format=metadata&metadataHeaders=Message-ID`);
          const last = th.messages?.[th.messages.length - 1];
          const mid = last ? header(last, 'Message-ID') : '';
          if (mid) headers.push(`In-Reply-To: ${mid}`, `References: ${mid}`);
          threadId = body.thread_id;
        } catch { /* thread gone: send as a new email */ }
      }
      const raw = b64url(headers.join('\r\n') + '\r\n\r\n' + b64(text).replace(/(.{76})/g, '$1\r\n'));
      const sent = await g(at, '/messages/send', { method: 'POST', body: JSON.stringify({ raw, ...(threadId ? { threadId } : {}) }) });
      await admin.rpc('apply_gmail_message', { p_user: userId, p: {
        message_id: sent.id, thread_id: sent.threadId, direction: 'out', counterpart: lead.email, lead_id: lead.id,
        subject, body: text, sent_at: new Date().toISOString(),
      } });
      return json({ ok: true, thread_id: sent.threadId });
    }

    if (body.action === 'sync') {
      // which addresses to look for: one lead, or all of this RM's leads with an email
      let emails: string[] = [];
      let q: string;
      if (body.lead_id) {
        const userDb = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: `Bearer ${jwt}` } } });
        const { data: lead } = await userDb.from('leads').select('id, email').eq('id', body.lead_id).maybeSingle();
        if (!lead?.email) return json({ ok: true, added: 0 });
        emails = [lead.email];
        q = `(from:${lead.email} OR to:${lead.email} OR cc:${lead.email}) newer_than:180d`;
      } else {
        const { data: leads } = await admin.from('leads').select('email').eq('rm_id', userId).not('email', 'is', null).limit(5000);
        emails = (leads ?? []).map((l: any) => l.email);
        const since = conn.last_sync_at ? Math.floor(new Date(conn.last_sync_at).getTime() / 1000) - 3600 : Math.floor(Date.now() / 1000) - 3 * 86400;
        q = `after:${since} -in:chats`;
      }
      if (!emails.length) return json({ ok: true, added: 0 });
      const wanted = new Set(emails.map((e) => e.toLowerCase()));
      const mine = conn.google_email.toLowerCase();

      const list = await g(at, `/messages?maxResults=100&q=${encodeURIComponent(q)}`);
      let added = 0;
      for (const m of list.messages ?? []) {
        const meta = await g(at, `/messages/${m.id}?format=metadata&metadataHeaders=From&metadataHeaders=To&metadataHeaders=Cc&metadataHeaders=Subject`);
        const from = addresses(header(meta, 'From'));
        const out = from.includes(mine);
        const others = out ? [...addresses(header(meta, 'To')), ...addresses(header(meta, 'Cc'))] : from;
        const match = others.find((a) => wanted.has(a));
        if (!match) continue;
        const full = await g(at, `/messages/${m.id}?format=full`);
        const text = stripQuoted(plainText(full.payload)) || full.snippet || '';
        const { data: leadId } = await admin.rpc('apply_gmail_message', { p_user: userId, p: {
          message_id: m.id, thread_id: m.threadId, direction: out ? 'out' : 'in', counterpart: match,
          subject: header(meta, 'Subject'), body: text, sent_at: new Date(Number(full.internalDate)).toISOString(),
        } });
        if (leadId) added++;
      }
      if (!body.lead_id) await admin.from('google_connections').update({ last_sync_at: new Date().toISOString() }).eq('user_id', userId);
      return json({ ok: true, added });
    }

    return json({ error: 'Unknown action' }, 400);
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
});
