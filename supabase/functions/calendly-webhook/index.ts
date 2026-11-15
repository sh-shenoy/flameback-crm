// Supabase Edge Function: calendly-webhook
// Calendly calls this when someone books or cancels with an RM.
// URL: <project>/functions/v1/calendly-webhook?rm=<CRM user id>   (set up by calendly-connect)
// Deploy with "Verify JWT" OFF: Calendly can't sign in. Every request is checked against
// that RM's signing key instead, and anything unsigned or stale is rejected.

import { createClient } from 'npm:@supabase/supabase-js@2';

const TOLERANCE_SECONDS = 5 * 60;

async function hmacHex(key: string, message: string): Promise<string> {
  const k = await crypto.subtle.importKey('raw', new TextEncoder().encode(key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', k, new TextEncoder().encode(message));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

/** Calendly-Webhook-Signature: t=<unix seconds>,v1=<hex hmac of "t.body"> */
export async function verify(header: string | null, body: string, key: string, now = Date.now() / 1000): Promise<boolean> {
  if (!header) return false;
  const parts = Object.fromEntries(header.split(',').map((p) => p.trim().split('=') as [string, string]));
  const t = Number(parts.t);
  if (!parts.v1 || !Number.isFinite(t) || Math.abs(now - t) > TOLERANCE_SECONDS) return false;
  return safeEqual(await hmacHex(key, `${parts.t}.${body}`), parts.v1);
}

function answer(qas: { question: string; answer: string }[] | undefined, re: RegExp): string | null {
  return qas?.find((q) => re.test(q.question ?? ''))?.answer ?? null;
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return new Response('ok');
  const rm = new URL(req.url).searchParams.get('rm') ?? '';
  if (!/^[0-9a-f-]{36}$/.test(rm)) return new Response('unknown rm', { status: 404 });

  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const { data: conn } = await admin.from('calendly_connections').select('signing_key').eq('user_id', rm).maybeSingle();
  if (!conn) return new Response('not connected', { status: 404 });

  const raw = await req.text();
  if (!(await verify(req.headers.get('Calendly-Webhook-Signature'), raw, conn.signing_key))) {
    return new Response('bad signature', { status: 401 });
  }

  const msg = JSON.parse(raw);
  const p = msg.payload ?? {};
  try {
    if (msg.event === 'invitee.created') {
      const qas = p.questions_and_answers as { question: string; answer: string }[] | undefined;
      const productAnswer = answer(qas, /ria|pms|product|interest/i) ?? '';
      const product = /pms/i.test(productAnswer) ? 'PMS' : /ria/i.test(productAnswer) ? 'RIA' : '';
      const { error } = await admin.rpc('apply_calendly_booking', {
        p_rm: rm,
        p: {
          invitee_uri: p.uri,
          event_uri: p.event ?? p.scheduled_event?.uri,
          name: p.name,
          email: p.email,
          phone: p.text_reminder_number ?? answer(qas, /phone|mobile|whatsapp|contact/i),
          event_name: p.scheduled_event?.name,
          start_time: p.scheduled_event?.start_time,
          end_time: p.scheduled_event?.end_time,
          join_url: p.scheduled_event?.location?.join_url ?? null,
          lead_id: p.tracking?.utm_content ?? null,
          product,
        },
      });
      if (error) throw error;
    } else if (msg.event === 'invitee.canceled') {
      const { error } = await admin.rpc('apply_calendly_cancel', {
        p_invitee_uri: p.uri,
        p_rescheduled: !!p.rescheduled,
        p_reason: p.cancellation?.reason ?? null,
      });
      if (error) throw error;
    }
    return new Response('ok');
  } catch (e) {
    console.error('calendly-webhook', e);
    // 500 makes Calendly retry later
    return new Response('error', { status: 500 });
  }
});
