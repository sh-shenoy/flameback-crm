import { useEffect, useRef, useState } from 'react';
import { useApp } from '../auth';
import { rpc, supabase } from '../lib/supabase';
import { timeAgo } from '../lib/format';
import { useToast } from './ui';

interface Summary { headline: string; who: string; wants: string; status: string; concerns: string[]; next_steps: string[] }
interface Row { lead_id: string; summary: Summary; covers_until: string; model: string | null; generated_at: string; edited_by: string | null; edited_at: string | null }

async function callSummarize(leadId: string, force: boolean): Promise<{ error?: string; code?: string }> {
  const { data, error } = await supabase.functions.invoke('summarize', { body: { lead_id: leadId, force } });
  const d = data as { error?: string; code?: string } | null;
  if (d?.error) return d;
  if (error) {
    const ctx = (error as { context?: Response }).context;
    try { const b = ctx ? await ctx.clone().json() : null; if (b?.error) return b; } catch { /* ignore */ }
    if (ctx?.status === 404) return { error: 'The summarize function isn’t deployed in Supabase yet.', code: 'not_configured' };
    return { error: error.message };
  }
  return {};
}

/**
 * AI conversation summary at the top of a lead. Refreshes by itself when there is activity
 * newer than the summary (unless an RM has edited it); RMs can refresh or edit by hand.
 * `version` changes whenever the lead page reloads its data.
 */
export default function SummaryBox({ leadId, version }: { leadId: string; version: string }) {
  const { teamName } = useApp();
  const toast = useToast();
  const [row, setRow] = useState<Row | null | undefined>(undefined);
  const [lastActivity, setLastActivity] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<{ error?: string; code?: string } | null>(null);
  const [editing, setEditing] = useState<Summary | null>(null);
  const autoTried = useRef<string>('');

  async function load() {
    const [s, a] = await Promise.all([
      supabase.from('lead_summaries').select('*').eq('lead_id', leadId).maybeSingle(),
      supabase.rpc('lead_last_activity', { p_lead: leadId }),
    ]);
    setRow((s.data as Row) ?? null);
    setLastActivity((a.data as string) ?? null);
    return { row: (s.data as Row) ?? null, last: (a.data as string) ?? null };
  }

  async function generate(force: boolean) {
    setBusy(true); setErr(null);
    const r = await callSummarize(leadId, force);
    if (r.error) setErr(r);
    else if (force) toast('Summary refreshed');
    await load();
    setBusy(false);
  }

  // load, then refresh automatically if the summary is missing or out of date (and not hand-edited)
  useEffect(() => {
    let cancelled = false;
    load().then(({ row: r, last }) => {
      if (cancelled) return;
      const stale = !r || (last && new Date(last).getTime() > new Date(r.covers_until).getTime() + 1000);
      const key = `${leadId}:${last}`;
      if (stale && !r?.edited_at && autoTried.current !== key) {
        autoTried.current = key;
        generate(false);
      }
    });
    return () => { cancelled = true; };
  }, [leadId, version]);

  const stale = !!row && !!lastActivity && new Date(lastActivity).getTime() > new Date(row.covers_until).getTime() + 1000;

  if (err?.code === 'not_configured' && !row) {
    return <div className="ai-box off"><b>AI summary</b><span className="muted small"> · not switched on yet. Ask your admin to add the OpenAI key in Supabase.</span></div>;
  }

  async function saveEdit() {
    try { await rpc('edit_lead_summary', { p_lead: leadId, p_summary: editing }); toast('Summary saved'); setEditing(null); load(); }
    catch (e) { toast((e as Error).message, 'err'); }
  }

  const s = row?.summary;
  return (
    <div className="ai-box">
      <div className="ai-head">
        <span className="ai-badge">AI summary</span>
        {row && (
          <span className="muted small">
            {row.edited_at ? `Edited by ${teamName(row.edited_by)} · ${timeAgo(row.edited_at)}` : `Updated ${timeAgo(row.generated_at)}`}
          </span>
        )}
        <div className="ai-actions">
          {busy ? <span className="muted small">Summarising…</span> : <>
            {row && !editing && <button className="linkbtn small" onClick={() => setEditing({ ...row.summary })}>Edit</button>}
            {!editing && <button className="linkbtn small" onClick={() => generate(true)}>{row ? 'Refresh' : 'Summarise'}</button>}
          </>}
        </div>
      </div>

      {stale && row?.edited_at && !busy && (
        <div className="ai-stale">New activity since this summary was edited. <button className="linkbtn small" onClick={() => generate(true)}>Refresh with AI</button></div>
      )}
      {err && !busy && <div className="ai-err">{err.error}</div>}

      {row === undefined || (busy && !row) ? (
        <div className="ai-skel"><div className="skel" style={{ height: 16, width: '70%' }} /><div className="skel" style={{ height: 12, width: '95%' }} /><div className="skel" style={{ height: 12, width: '85%' }} /></div>
      ) : editing ? (
        <div className="ai-edit">
          <label>Headline<input value={editing.headline} onChange={(e) => setEditing({ ...editing, headline: e.target.value })} /></label>
          <label>Who they are<textarea rows={2} value={editing.who} onChange={(e) => setEditing({ ...editing, who: e.target.value })} /></label>
          <label>What they want<textarea rows={2} value={editing.wants} onChange={(e) => setEditing({ ...editing, wants: e.target.value })} /></label>
          <label>Where things stand<textarea rows={2} value={editing.status} onChange={(e) => setEditing({ ...editing, status: e.target.value })} /></label>
          <label>Concerns (one per line)<textarea rows={3} value={editing.concerns.join('\n')} onChange={(e) => setEditing({ ...editing, concerns: e.target.value.split('\n').filter((x) => x.trim()) })} /></label>
          <label>Next steps (one per line)<textarea rows={3} value={editing.next_steps.join('\n')} onChange={(e) => setEditing({ ...editing, next_steps: e.target.value.split('\n').filter((x) => x.trim()) })} /></label>
          <div className="row-gap" style={{ justifyContent: 'flex-end' }}>
            <button className="btn ghost sm" onClick={() => setEditing(null)}>Cancel</button>
            <button className="btn sm" onClick={saveEdit}>Save summary</button>
          </div>
        </div>
      ) : s ? (
        <>
          {s.headline && <p className="ai-headline">{s.headline}</p>}
          <div className="ai-grid">
            {s.who && <div><span>Who they are</span><p>{s.who}</p></div>}
            {s.wants && <div><span>What they want</span><p>{s.wants}</p></div>}
            {s.status && <div><span>Where things stand</span><p>{s.status}</p></div>}
          </div>
          {(s.concerns.length > 0 || s.next_steps.length > 0) && (
            <div className="ai-grid two">
              {s.concerns.length > 0 && <div><span>Concerns</span><ul>{s.concerns.map((c) => <li key={c}>{c}</li>)}</ul></div>}
              {s.next_steps.length > 0 && <div><span>Next steps</span><ul>{s.next_steps.map((c) => <li key={c}>{c}</li>)}</ul></div>}
            </div>
          )}
        </>
      ) : (
        <p className="muted small">No summary yet. Log some activity, or click Summarise.</p>
      )}
    </div>
  );
}
