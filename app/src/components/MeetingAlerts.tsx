import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useApp } from '../auth';
import { supabase } from '../lib/supabase';
import { fmtTime } from '../lib/format';
import { playChime } from '../lib/sound';

/**
 * Pop-up 5 minutes before each of your meetings (Cal.com bookings and times set by hand), with
 * Join, Snooze 5m and close. Stays until you act on it, or until 10 minutes after the start.
 */
const LEAD_MIN = 5;          // show this many minutes before
const AFTER_MIN = 10;        // keep showing this long after the start
const KEY = 'argus.meetingAlerts';

interface Upcoming { key: string; title: string; who: string | null; start: string; join: string | null; leadId: string | null }
type Seen = Record<string, { dismissed?: boolean; snoozeUntil?: number }>;

function loadSeen(): Seen {
  try { return JSON.parse(localStorage.getItem(KEY) ?? '{}') as Seen; } catch { return {}; }
}
function saveSeen(s: Seen) {
  // forget meetings from more than a day ago
  const cutoff = Date.now() - 86400e3;
  const kept = Object.fromEntries(Object.entries(s).filter(([k]) => Number(k.split('|')[1]) > cutoff));
  try { localStorage.setItem(KEY, JSON.stringify(kept)); } catch { /* private window: fine */ }
}

export default function MeetingAlerts() {
  const { me } = useApp();
  const [list, setList] = useState<Upcoming[]>([]);
  const [seen, setSeen] = useState<Seen>(loadSeen);
  const [now, setNow] = useState(Date.now());
  const chimed = useRef(new Set<string>());

  const load = useCallback(async () => {
    if (!me) return;
    const from = new Date(Date.now() - AFTER_MIN * 60e3).toISOString();
    const to = new Date(Date.now() + 6 * 3600e3).toISOString();
    const [m, l, fu] = await Promise.all([
      supabase.from('meetings').select('booking_uid, event_name, name, start_time, join_url, lead_id, leads(name)')
        .eq('rm_id', me.id).eq('status', 'active').gte('start_time', from).lt('start_time', to),
      supabase.from('leads').select('id, name, meeting_at, meeting_url')
        .eq('rm_id', me.id).eq('bucket', 'awaiting_meeting').gte('meeting_at', from).lt('meeting_at', to),
      supabase.from('leads').select('id, name, next_follow_up_at')
        .eq('rm_id', me.id).in('bucket', ['active_contact', 'awaiting_meeting', 'holding', 'deferred']).gte('next_follow_up_at', from).lt('next_follow_up_at', to),
    ]);
    type MRow = { booking_uid: string; event_name: string | null; name: string | null; start_time: string; join_url: string | null; lead_id: string | null; leads: { name: string } | { name: string }[] | null };
    const out: Upcoming[] = ((m.data ?? []) as MRow[]).map((r) => {
      const lead = Array.isArray(r.leads) ? r.leads[0] : r.leads;
      const who = lead?.name ?? r.name;
      const base = (r.event_name ?? 'Meeting').split(/ between /i)[0];
      return { key: `${r.booking_uid}|${Date.parse(r.start_time)}`, title: who ? `${base} — ${who}` : base, who, start: r.start_time, join: r.join_url, leadId: r.lead_id };
    });
    // meeting times set by hand on a lead (skip ones already covered by a booking)
    for (const r of (l.data ?? []) as { id: string; name: string; meeting_at: string; meeting_url: string | null }[]) {
      const t = Date.parse(r.meeting_at);
      if (out.some((o) => o.leadId === r.id && Math.abs(Date.parse(o.start) - t) < 5 * 60e3)) continue;
      out.push({ key: `lead-${r.id}|${t}`, title: `Meeting — ${r.name}`, who: r.name, start: r.meeting_at, join: r.meeting_url, leadId: r.id });
    }
    // follow-ups scheduled at a time
    for (const r of (fu.data ?? []) as { id: string; name: string; next_follow_up_at: string }[]) {
      out.push({ key: `fu-${r.id}|${Date.parse(r.next_follow_up_at)}`, title: `Follow-up — ${r.name}`, who: r.name, start: r.next_follow_up_at, join: null, leadId: r.id });
    }
    setList(out);
  }, [me]);

  useEffect(() => { load(); const t = setInterval(load, 2 * 60e3); return () => clearInterval(t); }, [load]);
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 15e3); return () => clearInterval(t); }, []);

  const due = list
    .filter((u) => {
      const s = Date.parse(u.start);
      const st = seen[u.key];
      return now >= s - LEAD_MIN * 60e3 && now < s + AFTER_MIN * 60e3 && !st?.dismissed && !(st?.snoozeUntil && st.snoozeUntil > now);
    })
    .sort((a, b) => a.start.localeCompare(b.start));

  useEffect(() => {
    let fresh = false;
    for (const u of due) if (!chimed.current.has(u.key)) { chimed.current.add(u.key); fresh = true; }
    if (fresh) playChime();
  }, [due.map((u) => u.key).join()]);   // eslint-disable-line react-hooks/exhaustive-deps

  function update(key: string, v: Seen[string]) {
    const next = { ...seen, [key]: v };
    setSeen(next);
    saveSeen(next);
  }

  if (!due.length) return null;
  return (
    <div className="meet-alerts" role="region" aria-label="Upcoming meetings">
      {due.map((u) => {
        const mins = Math.round((Date.parse(u.start) - now) / 60e3);
        const when = mins > 0 ? `in ${mins} min` : mins === 0 ? 'starting now' : `started ${-mins} min ago`;
        return (
          <div key={u.key} className="meet-alert" role="alertdialog" aria-label={`Upcoming meeting ${u.title}`}>
            <button className="ma-x" aria-label="Dismiss" onClick={() => update(u.key, { dismissed: true })}>×</button>
            <div className="ma-head">{u.key.startsWith('fu-') ? 'Follow-up due' : 'Upcoming meeting'}</div>
            <div className="ma-body"><b className="ma-when">{when}</b> · {u.title}</div>
            <div className="ma-time">{fmtTime(u.start)}</div>
            <div className="ma-actions">
              {u.join
                ? <a className="btn sm" href={u.join} target="_blank" rel="noreferrer" onClick={() => update(u.key, { dismissed: true })}>Join</a>
                : u.leadId && <Link className="btn sm" to={`/leads/${u.leadId}`} onClick={() => update(u.key, { dismissed: true })}>Open lead</Link>}
              {u.join && u.leadId && <Link className="btn ghost sm" to={`/leads/${u.leadId}`}>Open lead</Link>}
              <button className="btn ghost sm" onClick={() => update(u.key, { snoozeUntil: Date.now() + 5 * 60e3 })}>Snooze 5m</button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
