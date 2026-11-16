// Supabase Edge Function: summarize
// Builds the AI conversation summary shown at the top of a lead. Deploy with "Verify JWT" ON.
//   { lead_id, force? }  → reads everything on the lead (with the caller's own permissions),
//                          strips phone numbers / emails / PAN / Aadhaar, asks our hosted model (through
//                          its OpenAI-compatible API) for a short structured summary, saves it and returns it.
// Secrets (Edge Functions → Secrets), all three required, no defaults:
//   OPENAI_BASE_URL  base URL of the hosted, OpenAI-compatible endpoint (e.g. https://…/v1)
//   OPENAI_API_KEY   key for that endpoint
//   OPENAI_MODEL     model name served there

import { createClient } from 'npm:@supabase/supabase-js@2';
import OpenAI from 'npm:openai@4';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

/** Remove contact details and ID numbers before anything leaves for the AI provider. */
export function redact(text: string | null | undefined): string {
  if (!text) return '';
  return String(text)
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[email]')
    .replace(/\b[A-Z]{5}[0-9]{4}[A-Z]\b/g, '[PAN]')
    .replace(/\b\d{4}\s?\d{4}\s?\d{4}\b/g, '[ID number]')
    .replace(/(\+?\d[\d\s-]{8,}\d)/g, '[phone]');
}

const IST = (ts: string | null | undefined) => ts
  ? new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata' }).format(new Date(ts))
  : '';

const INSTRUCTIONS = `You write the conversation summary a Relationship Manager at Flameback Capital (an Indian wealth manager)
reads before contacting a lead. Products: RIA (advisory), PMS (portfolio management), US RIA.
Use only the record provided; never invent amounts, dates or facts. If something is unknown, leave it out.
Be concise and concrete; write in plain English. Refer to the lead by first name.
Return a JSON object with exactly these keys:
- "headline": one sentence capturing where this relationship stands right now
- "who": 1-2 sentences on who they are (occupation, city, family, investing background) if known
- "wants": what they want: goals, budget/ticket size, product interest, time horizon
- "status": where things stand: stage, last real conversation and its outcome, meetings booked or held
- "concerns": array of short strings, their objections or worries (empty array if none)
- "next_steps": array of short strings, agreed or sensible next actions with dates if known (max 4)`;

// JSON from the model: tolerate ```json fences or text around the object
function parseJson(text: string): any {
  const t = text.replace(/^\s*```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '');
  try { return JSON.parse(t); } catch { /* fall through */ }
  const a = t.indexOf('{'), b = t.lastIndexOf('}');
  if (a >= 0 && b > a) { try { return JSON.parse(t.slice(a, b + 1)); } catch { /* unreadable */ } }
  return null;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  try {
    const baseURL = Deno.env.get('OPENAI_BASE_URL')?.trim();
    const key = Deno.env.get('OPENAI_API_KEY')?.trim();
    const model = Deno.env.get('OPENAI_MODEL')?.trim();
    const missing = [!baseURL && 'OPENAI_BASE_URL', !key && 'OPENAI_API_KEY', !model && 'OPENAI_MODEL'].filter(Boolean);
    if (missing.length) {
      return json({ error: `AI summaries aren’t set up yet: add ${missing.join(', ')} under Supabase → Edge Functions → Secrets.`, code: 'not_configured' }, 400);
    }

    const url = Deno.env.get('SUPABASE_URL')!;
    const jwt = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
    const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    const { data: who } = await admin.auth.getUser(jwt);
    if (!who?.user) return json({ error: 'Please sign in again.' }, 401);

    const { lead_id, force } = await req.json().catch(() => ({}));
    // read with the caller's own permissions: no access, no summary
    const db = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: `Bearer ${jwt}` } } });
    const { data: lead } = await db.from('leads').select('*').eq('id', lead_id ?? '').maybeSingle();
    if (!lead) return json({ error: 'Lead not found.' }, 404);

    const [entries, events, tasks, meetings, profiles] = await Promise.all([
      db.from('lead_entries').select('kind, outcome, notes, occurred_at, bucket_at').eq('lead_id', lead.id).order('occurred_at').limit(300),
      db.from('lead_events').select('kind, from_value, to_value, detail, at').eq('lead_id', lead.id).eq('kind', 'bucket').order('at').limit(100),
      db.from('tasks').select('title, details, status, to_team, due_date, created_at, task_comments(body, created_at)').eq('lead_id', lead.id).order('created_at').limit(30),
      db.from('meetings').select('event_name, start_time, status').eq('lead_id', lead.id).order('start_time').limit(30),
      admin.from('profiles').select('id, full_name'),
    ]);
    const rmName = (profiles.data ?? []).find((p: any) => p.id === lead.rm_id)?.full_name ?? 'their RM';

    const lines: string[] = [];
    lines.push(`LEAD: ${lead.name}`);
    lines.push(`Stage: ${lead.bucket.replace('_', ' ')} · Product interest: ${lead.product} · Source: ${lead.source}${lead.campaign ? ` (${lead.campaign})` : ''}${lead.referred_by ? ` · Referred by ${lead.referred_by}` : ''}`);
    lines.push(`RM: ${rmName} · Added ${IST(lead.created_at)} · Next follow-up ${lead.next_follow_up ?? 'none'}${lead.meeting_at ? ` · Meeting ${IST(lead.meeting_at)}` : ''}${lead.deferred_until ? ` · Deferred until ${lead.deferred_until}` : ''}`);
    const profile = [
      lead.city && `City: ${lead.city}`, lead.age && `Age: ${lead.age}`, lead.marital_status && `Marital: ${lead.marital_status}`,
      lead.income_band && `Income: ${lead.income_band}`, lead.language && `Language: ${lead.language}`, lead.budget && `Budget: ${lead.budget}`,
    ].filter(Boolean).join(' · ');
    if (profile) lines.push(profile);
    if (lead.requirement) lines.push(`What they want (RM note): ${redact(lead.requirement)}`);

    lines.push('', 'ACTIVITY (oldest first):');
    for (const e of entries.data ?? []) {
      lines.push(`- ${IST(e.occurred_at)} · ${e.kind.replace('_', ' ')}${e.outcome ? ` · ${e.outcome.replace('_', ' ')}` : ''}${e.notes ? `: ${redact(e.notes).slice(0, 2500)}` : ''}`);
    }
    if ((events.data ?? []).length) {
      lines.push('', 'STAGE CHANGES:');
      for (const v of events.data ?? []) lines.push(`- ${IST(v.at)}: ${v.from_value ?? '?'} → ${v.to_value}${v.detail?.reason ? ` (${v.detail.reason})` : ''}`);
    }
    if ((meetings.data ?? []).length) {
      lines.push('', 'MEETINGS:');
      for (const m of meetings.data ?? []) lines.push(`- ${IST(m.start_time)} · ${m.event_name ?? 'meeting'} · ${m.status}`);
    }
    if ((tasks.data ?? []).length) {
      lines.push('', 'TASKS RAISED ABOUT THIS LEAD:');
      for (const t of tasks.data ?? []) {
        lines.push(`- ${t.title} (${t.to_team}, ${t.status}${t.due_date ? `, due ${t.due_date}` : ''})${t.details ? `: ${redact(t.details).slice(0, 500)}` : ''}`);
        for (const c of (t as any).task_comments ?? []) lines.push(`  · comment: ${redact(c.body).slice(0, 300)}`);
      }
    }

    const { data: coversUntil } = await admin.rpc('lead_last_activity', { p_lead: lead.id });

    const ai = new OpenAI({ baseURL, apiKey: key });
    const messages = [
      { role: 'system' as const, content: INSTRUCTIONS },
      { role: 'user' as const, content: lines.join('\n') },
    ];
    let completion;
    try {
      completion = await ai.chat.completions.create({ model: model!, response_format: { type: 'json_object' }, messages });
    } catch (e) {
      // some hosted servers don't support JSON mode; the instructions already ask for JSON only
      if ((e as { status?: number }).status !== 400) throw e;
      completion = await ai.chat.completions.create({ model: model!, messages });
    }
    const text = completion.choices[0]?.message?.content ?? '';
    const parsed = parseJson(text);
    if (!parsed) return json({ error: 'The AI returned something unreadable. Try Refresh again.' }, 502);
    const summary = {
      headline: String(parsed.headline ?? '').trim(),
      who: String(parsed.who ?? '').trim(),
      wants: String(parsed.wants ?? '').trim(),
      status: String(parsed.status ?? '').trim(),
      concerns: (Array.isArray(parsed.concerns) ? parsed.concerns : []).map(String).filter(Boolean).slice(0, 6),
      next_steps: (Array.isArray(parsed.next_steps) ? parsed.next_steps : []).map(String).filter(Boolean).slice(0, 4),
    };

    const { data: saved, error: saveErr } = await admin.rpc('save_lead_summary', {
      p_lead: lead.id, p_summary: summary, p_covers_until: coversUntil ?? new Date().toISOString(), p_model: completion.model ?? model, p_force: !!force,
    });
    if (saveErr) return json({ error: saveErr.message }, 500);
    return json({ ok: true, saved, summary });
  } catch (e) {
    const err = e as { status?: number; message?: string };
    if (err?.status === 401 || err?.status === 403) return json({ error: 'The AI endpoint rejected the API key. Check OPENAI_API_KEY in Supabase secrets.' }, 400);
    if (err?.status === 404) return json({ error: 'The AI endpoint returned “not found”. Check OPENAI_BASE_URL (usually ends in /v1) and OPENAI_MODEL in Supabase secrets.' }, 400);
    if (err?.status === 429) return json({ error: 'The AI endpoint is busy or over its limit. Try again shortly.' }, 429);
    if ((err as { name?: string })?.name === 'APIConnectionError') return json({ error: 'Couldn’t reach the AI endpoint. Check OPENAI_BASE_URL in Supabase secrets.' }, 502);
    return json({ error: `AI endpoint error: ${err?.message ?? String(e)}` }, 500);
  }
});
