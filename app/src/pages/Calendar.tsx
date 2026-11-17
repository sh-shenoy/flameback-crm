import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApp } from '../auth';
import { supabase } from '../lib/supabase';
import { fmtPhone, todayIST } from '../lib/format';
import type { Lead, Task } from '../lib/types';
import { Modal } from '../components/ui';

/* All calendar maths is done in IST: a "day" is an IST calendar date (YYYY-MM-DD). */
const IST = 330 * 60_000;
const istDate = (ts: string | number | Date) => new Date(new Date(ts).getTime() + IST).toISOString().slice(0, 10);
const istMinutes = (ts: string | Date) => { const d = new Date(new Date(ts).getTime() + IST); return d.getUTCHours() * 60 + d.getUTCMinutes(); };
const dayStartUTC = (day: string) => new Date(day + 'T00:00:00+05:30');
const shift = (day: string, n: number) => { const d = new Date(day + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const weekday = (day: string) => (new Date(day + 'T00:00:00Z').getUTCDay() + 6) % 7; // Mon = 0
const monthOf = (day: string) => day.slice(0, 7);
const fmt = (day: string, o: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat('en-GB', { ...o, timeZone: 'UTC' }).format(new Date(day + 'T00:00:00Z'));
const fmtClock = (ts: string) => new Intl.DateTimeFormat('en-IN', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'Asia/Kolkata' }).format(new Date(ts)).toLowerCase();

type View = 'month' | 'week' | 'day';
interface Ev { id: string; title: string; sub?: string; start: string; end: string; kind: 'meeting' | 'task'; link: string; join?: string | null; day: string }

const START_H = 7, END_H = 22, HOUR_PX = 48;

export default function CalendarPage() {
  const { me } = useApp();
  const nav = useNavigate();
  const [view, setView] = useState<View>(() => { try { return (localStorage.getItem('crm.cal.view') as View) || 'week'; } catch { return 'week'; } });
  const [anchor, setAnchor] = useState(todayIST());
  const [showTasks, setShowTasks] = useState(true);
  const [events, setEvents] = useState<Ev[] | null>(null);
  const [picking, setPicking] = useState(false);
  useEffect(() => { try { localStorage.setItem('crm.cal.view', view); } catch { /* ignore */ } }, [view]);

  // visible days
  const days = useMemo(() => {
    if (view === 'day') return [anchor];
    if (view === 'week') { const mon = shift(anchor, -weekday(anchor)); return Array.from({ length: 7 }, (_, i) => shift(mon, i)); }
    const first = anchor.slice(0, 8) + '01';
    const start = shift(first, -weekday(first));
    return Array.from({ length: 42 }, (_, i) => shift(start, i));
  }, [view, anchor]);

  useEffect(() => {
    setEvents(null);
    const from = dayStartUTC(days[0]!).toISOString();
    const to = dayStartUTC(shift(days[days.length - 1]!, 1)).toISOString();
    Promise.all([
      supabase.from('meetings').select('*').eq('rm_id', me!.id).eq('status', 'active').gte('start_time', from).lt('start_time', to),
      supabase.from('leads').select('id, name, phone, product, meeting_at, meeting_url').eq('rm_id', me!.id).eq('bucket', 'awaiting_meeting')
        .gte('meeting_at', from).lt('meeting_at', to),
      showTasks
        ? supabase.from('tasks').select('*').or(`assignee_id.eq.${me!.id},and(assignee_id.is.null,to_team.eq.${me!.team}),created_by.eq.${me!.id}`)
            .neq('status', 'done').gte('due_date', days[0]!).lte('due_date', days[days.length - 1]!)
        : Promise.resolve({ data: [] }),
    ]).then(async ([ce, ld, tk]: any[]) => {
      const out: Ev[] = [];
      const leadIds = [...new Set(((ce.data ?? []) as { lead_id: string | null }[]).map((e) => e.lead_id).filter(Boolean))] as string[];
      const names: Record<string, string> = {};
      if (leadIds.length) {
        const { data } = await supabase.from('leads').select('id, name').in('id', leadIds);
        for (const l of (data ?? []) as { id: string; name: string }[]) names[l.id] = l.name;
      }
      const seen = new Set<string>();
      for (const e of ce.data ?? []) {
        const end = e.end_time ?? new Date(new Date(e.start_time).getTime() + 30 * 60_000).toISOString();
        out.push({ id: 'c' + e.booking_uid, title: (e.lead_id && names[e.lead_id]) || e.name || 'Booking', sub: e.event_name ?? (e.provider === 'calcom' ? 'Cal.com' : 'Calendly'),
          start: e.start_time, end, kind: 'meeting', link: e.lead_id ? `/leads/${e.lead_id}` : '/calendar', join: e.join_url, day: istDate(e.start_time) });
        if (e.lead_id) seen.add(e.lead_id + new Date(e.start_time).getTime());
      }
      for (const l of (ld.data ?? []) as Pick<Lead, 'id' | 'name' | 'phone' | 'product' | 'meeting_at' | 'meeting_url'>[]) {
        if (seen.has(l.id + new Date(l.meeting_at!).getTime())) continue;
        out.push({ id: 'l' + l.id, title: l.name, sub: `${l.product}${l.phone ? ' · ' + fmtPhone(l.phone) : ''}`, start: l.meeting_at!,
          end: new Date(new Date(l.meeting_at!).getTime() + 30 * 60_000).toISOString(), kind: 'meeting', link: `/leads/${l.id}`, join: l.meeting_url, day: istDate(l.meeting_at!) });
      }
      for (const t of (tk.data ?? []) as Task[]) {
        out.push({ id: 't' + t.id, title: t.title, sub: `Task · ${t.to_team}`, start: t.due_date!, end: t.due_date!, kind: 'task', link: `/tasks?task=${t.id}`, day: t.due_date! });
      }
      out.sort((a, b) => a.start.localeCompare(b.start));
      setEvents(out);
    });
  }, [days, showTasks, me]);

  const byDay = useMemo(() => {
    const m: Record<string, Ev[]> = {};
    for (const e of events ?? []) (m[e.day] ??= []).push(e);
    return m;
  }, [events]);

  const step = view === 'day' ? 1 : view === 'week' ? 7 : 0;
  const move = (dir: 1 | -1) => {
    if (step) setAnchor(shift(anchor, dir * step));
    else { const d = new Date(anchor.slice(0, 8) + '01T00:00:00Z'); d.setUTCMonth(d.getUTCMonth() + dir); setAnchor(d.toISOString().slice(0, 10)); }
  };
  const title = view === 'month' ? fmt(anchor, { month: 'long', year: 'numeric' })
    : view === 'week' ? `${fmt(days[0]!, { day: 'numeric', month: 'short' })} – ${fmt(days[6]!, { day: 'numeric', month: 'short', year: 'numeric' })}`
    : fmt(anchor, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  const today = todayIST();
  const meetings = (events ?? []).filter((e) => e.kind === 'meeting').length;

  return (
    <div className="main-inner wide">
      <div className="page-head">
        <div><h1>Calendar</h1><p>Your meetings with leads (Cal.com and booked by hand){showTasks ? ' and tasks due' : ''}. Times in IST.</p></div>
        <button className="btn" onClick={() => setPicking(true)}>Schedule meeting</button>
      </div>
      <div className="cal-bar">
        <div className="row-gap">
          <button className="btn ghost sm" onClick={() => setAnchor(today)}>Today</button>
          <button className="btn ghost sm" onClick={() => move(-1)} aria-label="Previous">‹</button>
          <button className="btn ghost sm" onClick={() => move(1)} aria-label="Next">›</button>
          <h2 className="cal-title">{title}</h2>
          {events && <span className="muted small">{meetings} meeting{meetings === 1 ? '' : 's'}</span>}
        </div>
        <div className="row-gap">
          <label className="check"><input type="checkbox" checked={showTasks} onChange={(e) => setShowTasks(e.target.checked)} /> Tasks due</label>
          <div className="seg">
            {(['day', 'week', 'month'] as View[]).map((v) => <button key={v} className={view === v ? 'on' : ''} onClick={() => setView(v)}>{v[0]!.toUpperCase() + v.slice(1)}</button>)}
          </div>
        </div>
      </div>

      {view === 'month' ? (
        <div className="cal-month panel">
          {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => <div key={d} className="cm-head">{d}</div>)}
          {days.map((d) => {
            const list = byDay[d] ?? [];
            return (
              <div key={d} className={`cm-cell ${monthOf(d) !== monthOf(anchor) ? 'other' : ''} ${d === today ? 'today' : ''}`}
                onClick={() => { setAnchor(d); setView('day'); }}>
                <span className="cm-num">{Number(d.slice(8))}</span>
                {list.slice(0, 3).map((e) => (
                  <button key={e.id} className={`cm-ev k-${e.kind}`} onClick={(x) => { x.stopPropagation(); nav(e.link); }} title={e.title}>
                    {e.kind === 'meeting' ? <b>{fmtClock(e.start)}</b> : <b>Due</b>} {e.title}
                  </button>
                ))}
                {list.length > 3 && <span className="cm-more">+{list.length - 3} more</span>}
              </div>
            );
          })}
        </div>
      ) : (
        <TimeGrid days={days} byDay={byDay} today={today} onOpen={(e) => nav(e.link)} />
      )}
      {events === null && <div className="muted small" style={{ marginTop: 8 }}>Loading…</div>}
      {picking && <PickLead onClose={() => setPicking(false)} onPick={(id) => nav(`/leads/${id}?schedule=1`)} />}
    </div>
  );
}

function TimeGrid({ days, byDay, today, onOpen }: { days: string[]; byDay: Record<string, Ev[]>; today: string; onOpen: (e: Ev) => void }) {
  const hours = Array.from({ length: END_H - START_H }, (_, i) => START_H + i);
  const nowMin = istMinutes(new Date());
  return (
    <div className="panel cal-grid" style={{ ['--cols' as string]: days.length }}>
      <div className="cg-head">
        <div />
        {days.map((d) => (
          <div key={d} className={`cg-day ${d === today ? 'today' : ''}`}>
            <span>{fmt(d, { weekday: 'short' })}</span><b>{Number(d.slice(8))}</b>
            <div className="cg-allday">
              {(byDay[d] ?? []).filter((e) => e.kind === 'task').map((e) => (
                <button key={e.id} className="cm-ev k-task" onClick={() => onOpen(e)} title={e.title}>{e.title}</button>
              ))}
            </div>
          </div>
        ))}
      </div>
      <div className="cg-body">
        <div className="cg-hours">{hours.map((h) => <div key={h} style={{ height: HOUR_PX }}>{h === 12 ? '12 pm' : h > 12 ? `${h - 12} pm` : `${h} am`}</div>)}</div>
        {days.map((d) => {
          const evs = (byDay[d] ?? []).filter((e) => e.kind === 'meeting');
          // place overlapping meetings side by side
          const lanes: Ev[][] = [];
          for (const e of evs) {
            const lane = lanes.find((l) => l[l.length - 1]!.end <= e.start);
            if (lane) lane.push(e); else lanes.push([e]);
          }
          const laneOf = new Map<string, number>();
          lanes.forEach((l, i) => l.forEach((e) => laneOf.set(e.id, i)));
          return (
            <div key={d} className="cg-col" style={{ height: hours.length * HOUR_PX }}>
              {hours.map((h) => <div key={h} className="cg-line" style={{ top: (h - START_H) * HOUR_PX }} />)}
              {d === today && nowMin >= START_H * 60 && nowMin <= END_H * 60 && <div className="cg-now" style={{ top: ((nowMin - START_H * 60) / 60) * HOUR_PX }} />}
              {evs.map((e) => {
                const s = Math.max(START_H * 60, istMinutes(e.start));
                const en = Math.min(END_H * 60, Math.max(s + 20, istMinutes(e.end) || s + 30));
                const lane = laneOf.get(e.id) ?? 0, n = lanes.length;
                return (
                  <div key={e.id} className="cg-ev" onClick={() => onOpen(e)}
                    style={{ top: ((s - START_H * 60) / 60) * HOUR_PX, height: ((en - s) / 60) * HOUR_PX - 2, left: `calc(${(lane / n) * 100}% + 2px)`, width: `calc(${100 / n}% - 4px)` }}>
                    <b>{e.title}</b>
                    <span>{fmtClock(e.start)}{e.sub ? ` · ${e.sub}` : ''}</span>
                    {e.join && <a href={e.join} target="_blank" rel="noreferrer" onClick={(x) => x.stopPropagation()}>Join</a>}
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function PickLead({ onClose, onPick }: { onClose: () => void; onPick: (id: string) => void }) {
  const { me } = useApp();
  const [q, setQ] = useState('');
  const [res, setRes] = useState<Lead[]>([]);
  useEffect(() => {
    const t = setTimeout(async () => {
      let query = supabase.from('leads').select('*').eq('rm_id', me!.id).not('bucket', 'in', '(out,converting,client)').order('next_follow_up', { ascending: true, nullsFirst: false }).limit(8);
      const term = q.trim().replace(/[%,()]/g, '');
      if (term.length >= 2) query = query.or(`name.ilike.%${term}%,email.ilike.%${term}%,phone.ilike.%${term.replace(/\D/g, '') || term}%`);
      const { data } = await query;
      setRes((data as Lead[]) ?? []);
    }, 200);
    return () => clearTimeout(t);
  }, [q]);
  return (
    <Modal title="Schedule a meeting with…" onClose={onClose}>
      <input autoFocus className="full-input" placeholder="Search your leads by name, phone or email" value={q} onChange={(e) => setQ(e.target.value)} />
      <div className="pick-list">
        {res.map((l) => (
          <button key={l.id} onClick={() => onPick(l.id)}>
            <b>{l.name}</b><span className="muted small">{fmtPhone(l.phone) || l.email}</span>
          </button>
        ))}
        {res.length === 0 && <div className="muted small" style={{ padding: 10 }}>No matching open leads.</div>}
      </div>
    </Modal>
  );
}
