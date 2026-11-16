// Supabase Edge Function: calcom-webhook
// Cal.com calls this when someone books, reschedules or cancels with an RM.
// URL: <project>/functions/v1/calcom-webhook?rm=<CRM user id>   (set up by the calcom function)
// Deploy with "Verify JWT" OFF: Cal.com can't sign in. Every request must carry Cal.com's
// X-Cal-Signature-256 header (HMAC-SHA256 of the body with that RM's secret); anything else is rejected.

import { createClient } from 'npm:@supabase/supabase-js@2';

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
export async function verify(header: string | null, body: string, secret: string): Promise<boolean> {
  if (!header) return false;
  const given = header.trim().replace(/^sha256=/i, '').toLowerCase();
  return safeEqual(await hmacHex(secret, body), given);
}

const str = (v: unknown): string | null => (v === null || v === undefined || v === '' ? null : String(v));
/** Cal.com booking-form answers come as { field: { value } } or { field: value }. */
function answer(responses: any, re: RegExp): string | null {
  if (!responses || typeof responses !== 'object') return null;
  for (const [k, v] of Object.entries(responses)) {
    if (!re.test(k)) continue;
    const val = typeof v === 'object' && v !== null && 'value' in (v as any) ? (v as any).value : v;
    if (val && typeof val !== 'object') return String(val);
  }
  return null;
}

export function toBooking(p: any) {
  const attendee = (p.attendees ?? [])[0] ?? {};
  const responses = p.responses ?? {};
  const productText = Object.values(responses).map((v: any) => (typeof v === 'object' && v ? v.value : v)).filter((v) => typeof v === 'string').join(' ');
  const location = str(p.location);
  return {
    booking_uid: str(p.uid) ?? str(p.bookingId),
    provider: 'calcom',
    name: str(attendee.name) ?? answer(responses, /^name$/i),
    email: str(attendee.email) ?? answer(responses, /^email$/i),
    phone: str(attendee.phoneNumber) ?? answer(responses, /phone|mobile|whatsapp/i),
    event_name: str(p.eventTitle) ?? str(p.title) ?? str(p.type),
    start_time: str(p.startTime),
    end_time: str(p.endTime),
    join_url: str(p.videoCallData?.url) ?? str(p.metadata?.videoCallUrl) ?? (location && /^https?:\/\//.test(location) ? location : null),
    lead_id: str(p.metadata?.lead_id),
    product: /\bus\s*-?\s*ria\b/i.test(productText) ? 'US RIA' : /\bpms\b/i.test(productText) ? 'PMS' : /\bria\b/i.test(productText) ? 'RIA' : '',
  };
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return new Response('ok');
  const rm = new URL(req.url).searchParams.get('rm') ?? '';
  if (!/^[0-9a-f-]{36}$/.test(rm)) return new Response('unknown rm', { status: 404 });

  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const { data: conn } = await admin.from('calcom_connections').select('webhook_secret').eq('user_id', rm).maybeSingle();
  if (!conn) return new Response('not connected', { status: 404 });

  const raw = await req.text();
  if (!(await verify(req.headers.get('X-Cal-Signature-256'), raw, conn.webhook_secret))) {
    return new Response('bad signature', { status: 401 });
  }

  const msg = JSON.parse(raw);
  const event = String(msg.triggerEvent ?? '');
  const p = msg.payload ?? {};
  try {
    if (event === 'BOOKING_CREATED' || event === 'BOOKING_RESCHEDULED') {
      const b = toBooking(p);
      if (!b.booking_uid || !b.start_time) return new Response('ignored');
      const { error } = await admin.rpc('apply_booking', { p_rm: rm, p: b });
      if (error) throw error;
      // the booking this one replaces
      const old = str(p.rescheduleUid) ?? str(p.fromReschedule) ?? str(p.rescheduledFromUid);
      if (event === 'BOOKING_RESCHEDULED' && old && old !== b.booking_uid) {
        const { error: e2 } = await admin.rpc('apply_booking_cancel', { p_uid: old, p_rescheduled: true, p_reason: null });
        if (e2) throw e2;
      }
    } else if (event === 'BOOKING_CANCELLED') {
      const { error } = await admin.rpc('apply_booking_cancel', {
        p_uid: str(p.uid), p_rescheduled: false, p_reason: str(p.cancellationReason),
      });
      if (error) throw error;
    }
    return new Response('ok');   // PING and anything else: acknowledged
  } catch (e) {
    console.error('calcom-webhook', e);
    return new Response('error', { status: 500 });   // Cal.com retries later
  }
});
