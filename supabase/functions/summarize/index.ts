// Supabase Edge Function: summarize
// Builds the AI conversation summary shown at the top of a lead. Deploy with "Verify JWT" ON.
//   { lead_id, force? }  → reads everything on the lead (with the caller's own permissions),
//                          strips phone numbers / emails / PAN / Aadhaar, asks OpenAI for a short
//                          structured summary, saves it and returns it.
// Secrets (Edge Functions → Secrets): OPENAI_API_KEY (required), OPENAI_MODEL (optional, default gpt-5-mini).

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

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  try {
    const key = Deno.env.get('OPENAI_API_KEY');
    if (!key) return json({ error: 'AI summaries aren’t set up yet: add OPENAI_API_KEY under Supabase → Edge Functions → Secrets.', code: 'not_configured' }, 400);
    const model = Deno.env.get('OPENAI_MODEL') || 'gpt-5-mini';

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

    const openai = new OpenAI({ apiKey: key });
    const completion = await openai.chat.completions.create({
      model,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: INSTRUCTIONS },
        { role: 'user', content: lines.join('\n') },
      ],
    });
    const text = completion.choices[0]?.message?.content ?? '';
    let parsed: any;
    try { parsed = JSON.parse(text); } catch { return json({ error: 'The AI returned something unreadable. Try Refresh again.' }, 502); }
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
    if (err?.status === 401) return json({ error: 'OpenAI rejected the API key. Check OPENAI_API_KEY in Supabase secrets.' }, 400);
    if (err?.status === 404) return json({ error: `OpenAI doesn’t recognise the model. Set OPENAI_MODEL in Supabase secrets to a model your account can use.` }, 400);
    if (err?.status === 429) return json({ error: 'OpenAI rate limit or quota reached. Try again shortly, or check billing on your OpenAI account.' }, 429);
    return json({ error: err?.message ?? String(e) }, 500);
  }
});
