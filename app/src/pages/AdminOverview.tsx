import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useApp } from '../auth';
import { rpc, supabase } from '../lib/supabase';
import { addDays, fmtDate, fmtDateTime, fmtPhone, initials, timeAgo, todayIST } from '../lib/format';
import { OUTCOME_LABEL, entryLabel, bucketLabel, type Lead, type LeadEntry } from '../lib/types';
import { StagePill, Empty, Field, FollowUp, Modal, ProductTag, Skeleton, useToast } from '../components/ui';
import { Funnel, numRow, sumCounts, type Counts, type Row } from './Reports';

export interface Stat {
  user_id: string; full_name: string; email: string; role: string; team: string; in_rotation: boolean; avatar_url: string | null;
  open_leads: number; active_contact: number; awaiting_meeting: number; holding: number; deferred: number;
  due_today: number; overdue: number; meetings_week: number; meetings_unrecorded: number; untouched_7d: number;
  new_leads: number; committed: number; out_list: number; entries: number; calls: number;
  last_activity_at: string | null; tasks_open: number; tasks_overdue: number; last_nudged_at: string | null;
}

function monthStart() { const t = todayIST(); return t.slice(0, 8) + '01'; }
function weekStart() { const t = todayIST(); const d = (new Date(t + 'T00:00:00Z').getUTCDay() + 6) % 7; return addDays(t, -d); }
export const PERIODS: { key: string; label: string; range: () => [string, string] }[] = [
  { key: 'week', label: 'This week', range: () => [weekStart(), todayIST()] },
  { key: 'month', label: 'This month', range: () => [monthStart(), todayIST()] },
  { key: '30', label: 'Last 30 days', range: () => [addDays(todayIST(), -29), todayIST()] },
];

async function loadStats(from: string, to: string): Promise<Stat[]> {
  const rows = await rpc<Stat[]>('admin_team_stats', { p_from: from, p_to: to });
  return rows.map((r) => {
    const n: Record<string, unknown> = { ...r };
    for (const k of Object.keys(n)) if (typeof n[k] === 'string' && /^\d+$/.test(n[k] as string) && !['user_id', 'full_name', 'email', 'role', 'team'].includes(k)) n[k] = Number(n[k]);
    return n as unknown as Stat;
  });
}

const daysSince = (ts: string | null) => (ts ? Math.floor((Date.now() - new Date(ts).getTime()) / 86400000) : null);

/** Suggested nudges for one person, most important first. */
export function suggestions(s: Stat): { text: string; link: string }[] {
  const out: { text: string; link: string }[] = [];
  const pl = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;
  if (s.overdue > 0) out.push({ text: `You have ${pl(s.overdue, 'overdue follow-up')}. Please clear them today.`, link: '/leads?due=overdue' });
  if (s.meetings_unrecorded > 0) out.push({ text: `${pl(s.meetings_unrecorded, 'meeting')} still need an outcome recorded.`, link: '/leads?bucket=awaiting_meeting' });
  const idle = daysSince(s.last_activity_at);
  if (s.open_leads > 0 && (idle === null || idle >= 3)) out.push({ text: idle === null ? 'No calls or notes logged yet. Start working your leads.' : `Nothing logged in ${idle} days. Please update your leads.`, link: '/leads' });
  if (s.tasks_overdue > 0) out.push({ text: `${pl(s.tasks_overdue, 'task')} overdue.`, link: '/tasks?due=overdue' });
  return out;
}

export function TeamOverview() {
  const nav = useNavigate();
  const [period, setPeriod] = useState('week');
  const [rows, setRows] = useState<Stat[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [nudging, setNudging] = useState<Stat | null>(null);
  const [teamF, setTeamF] = useState('Sales');
  const [from, to] = PERIODS.find((p) => p.key === period)!.range();

  const load = () => { setRows(null); loadStats(from, to).then(setRows).catch((e) => { setErr(e.message); setRows([]); }); };
  useEffect(load, [period]);

  const shown = (rows ?? []).filter((r) => !teamF || r.team === teamF);
  const sum = (k: keyof Stat) => shown.reduce((t, r) => t + (r[k] as number), 0);
  const needs = shown.filter((r) => suggestions(r).length > 0).length;

  return (
    <>
      <div className="toolbar" style={{ marginBottom: 14 }}>
        <div className="seg">{PERIODS.map((p) => <button key={p.key} className={period === p.key ? 'on' : ''} onClick={() => setPeriod(p.key)}>{p.label}</button>)}</div>
        <select className="filter" value={teamF} onChange={(e) => setTeamF(e.target.value)}>
          <option value="">Everyone</option><option>Sales</option><option>Operations</option><option>Compliance</option><option>Investment</option>
        </select>
        <span className="muted small">{fmtDate(from)} – {fmtDate(to)}</span>
      </div>
      {err && <div className="banner warn">Couldn't load the team: {err}{err.includes('admin_team_stats') ? '. Run migration 0005 in Supabase.' : ''}</div>}

      <div className="cards">
        <div className="card"><div className="k">Open leads</div><div className="v">{rows ? sum('open_leads') : '·'}</div><div className="meta">{shown.length} people</div></div>
        <div className="card"><div className="k">Overdue follow-ups{sum('overdue') > 0 && <span className="red-dot" />}</div><div className={`v ${sum('overdue') ? 'red' : ''}`}>{rows ? sum('overdue') : '·'}</div><div className="meta">{rows ? `${sum('due_today')} due today` : ''}</div></div>
        <div className="card"><div className="k">Activity logged</div><div className="v">{rows ? sum('entries') : '·'}</div><div className="meta">{rows ? `${sum('calls')} calls` : ''}</div></div>
        <div className="card"><div className="k">New prospects</div><div className="v">{rows ? sum('committed') : '·'}</div><div className="meta">{rows ? `${sum('new_leads')} new leads` : ''}</div></div>
      </div>

      <div className="panel">
        <div className="panel-head"><h2>Team</h2>{rows && <span className="muted small">{needs ? `${needs} ${needs === 1 ? 'person needs' : 'people need'} a nudge` : 'Everyone is on track'}</span>}</div>
        <div className="table-wrap">
          <table className="report">
            <thead><tr>
              <th>Person</th><th>Open</th><th>Follow-ups</th><th>Meetings 7d</th><th>Needs attention</th>
              <th>Activity</th><th>New → committed</th><th>Tasks overdue</th><th />
            </tr></thead>
            <tbody>
              {rows === null && [0, 1, 2].map((i) => <tr key={i}><td colSpan={9}><Skeleton /></td></tr>)}
              {shown.map((r) => {
                const sug = suggestions(r);
                const idle = daysSince(r.last_activity_at);
                return (
                  <tr key={r.user_id} className="lead-row" onClick={() => nav(`/admin/people/${r.user_id}`)}>
                    <td><div className="person">
                      {r.avatar_url ? <img src={r.avatar_url} alt="" referrerPolicy="no-referrer" /> : <span className="av">{initials(r.full_name)}</span>}
                      <div><b className="nowrap">{r.full_name}</b><div className="lead-sub nowrap">{r.role === 'admin' ? 'Admin' : 'RM'} · {r.team}{r.in_rotation ? ' · in rotation' : ''}</div></div>
                    </div></td>
                    <td>{r.open_leads}</td>
                    <td><div>{r.due_today} today</div>{r.overdue > 0 ? <div className="red small">{r.overdue} overdue</div> : <div className="muted small">none overdue</div>}</td>
                    <td>{r.meetings_week || <span className="muted">0</span>}</td>
                    <td>
                      {r.meetings_unrecorded === 0 ? <span className="muted">—</span> : <div className="amber small">{r.meetings_unrecorded} without outcome</div>}
                    </td>
                    <td><div>{r.entries} logged <span className="muted small">· {r.calls} calls</span></div>
                      <div className={`small ${idle !== null && idle >= 3 && r.open_leads ? 'amber' : 'muted'}`}>{r.last_activity_at ? `last ${timeAgo(r.last_activity_at)}` : 'nothing logged yet'}</div></td>
                    <td>{r.new_leads} → <b>{r.committed}</b>{r.new_leads > 0 && <span className="muted small"> {Math.round((r.committed / r.new_leads) * 100)}%</span>}</td>
                    <td className={r.tasks_overdue ? 'red' : 'muted'}>{r.tasks_overdue}</td>
                    <td onClick={(e) => e.stopPropagation()}>
                      <button className={`btn sm ${sug.length ? '' : 'ghost'}`} onClick={() => setNudging(r)} title={r.last_nudged_at ? `Last nudged ${timeAgo(r.last_nudged_at)}` : undefined}>
                        Nudge{sug.length ? ` · ${sug.length}` : ''}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {rows && shown.length === 0 && <Empty>No one in this team yet.</Empty>}
        </div>
      </div>
      <p className="hint" style={{ marginTop: 10 }}>
        <b>No outcome</b>: meetings whose time has passed but are still in Awaiting meeting. <b>Untouched 7d+</b>: open leads older than a week with nothing logged in 7 days.
        <b> Activity</b>: calls, messages, emails and notes logged in the period. Click a person for their pipeline.
      </p>
      {nudging && <NudgeModal s={nudging} onClose={() => setNudging(null)} onSent={() => { setNudging(null); load(); }} />}
    </>
  );
}

export function NudgeModal({ s, onClose, onSent }: { s: Stat; onClose: () => void; onSent: () => void }) {
  const toast = useToast();
  const sug = suggestions(s);
  const [text, setText] = useState(sug[0]?.text ?? '');
  const [link, setLink] = useState(sug[0]?.link ?? '/');
  const [busy, setBusy] = useState(false);
  return (
    <Modal title={`Nudge ${s.full_name.split(' ')[0]}`} onClose={onClose}
      footer={<>
        {s.last_nudged_at && <span className="muted small" style={{ marginRight: 'auto' }}>Last nudged {timeAgo(s.last_nudged_at)}</span>}
        <button className="btn ghost" onClick={onClose}>Cancel</button>
        <button className="btn" disabled={busy || !text.trim()} onClick={async () => {
          setBusy(true);
          try { await rpc('send_nudge', { p_user: s.user_id, p_message: text, p_link: link }); toast(`Nudge sent to ${s.full_name}`); onSent(); }
          catch (e) { toast((e as Error).message, 'err'); } finally { setBusy(false); }
        }}>Send nudge</button>
      </>}>
      {sug.length > 0 ? (
        <Field label="Suggested">
          <div className="sugs">
            {sug.map((x) => (
              <button key={x.text} className={`sug ${text === x.text ? 'on' : ''}`} onClick={() => { setText(x.text); setLink(x.link); }}>{x.text}</button>
            ))}
          </div>
        </Field>
      ) : <p className="muted" style={{ marginBottom: 12 }}>{s.full_name} is on track. You can still send a note.</p>}
      <Field label="Message" hint={`${s.full_name} gets this as a notification; clicking it opens ${link === '/' ? 'their dashboard' : 'the relevant list'}.`}>
        <textarea rows={3} value={text} onChange={(e) => { setText(e.target.value); }} placeholder="e.g. Great week! Please log outcomes for yesterday's meetings." />
      </Field>
    </Modal>
  );
}

/* ───────── one RM's funnel ───────── */
const FUNNEL_PERIODS: { key: string; label: string; range: () => [string, string] }[] = [
  { key: 'all', label: 'All time', range: () => ['2020-01-01', todayIST()] },
  { key: 'month', label: 'This month', range: () => [monthStart(), todayIST()] },
  { key: '30', label: 'Last 30 days', range: () => [addDays(todayIST(), -29), todayIST()] },
  { key: '90', label: 'Last 90 days', range: () => [addDays(todayIST(), -89), todayIST()] },
];

/** Leads given to this RM (by when they came in) and how far each got, with the whole team as a marker. */
export function RmFunnel({ rmId, name }: { rmId: string; name: string }) {
  const [period, setPeriod] = useState('all');
  const [mine, setMine] = useState<Counts | null>(null);
  const [all, setAll] = useState<Counts | null>(null);
  useEffect(() => {
    setMine(null);
    const [from, to] = FUNNEL_PERIODS.find((p) => p.key === period)!.range();
    supabase.rpc('report_conversion', { p_from: from, p_to: to, p_group: 'rm', p_rm: null }).then(({ data }) => {
      const rows = ((data as Row[]) ?? []).map(numRow);
      setAll(sumCounts(rows));
      setMine(sumCounts(rows.filter((r) => r.grp === name)));
    });
  }, [rmId, name, period]);
  return (
    <div className="panel" style={{ marginBottom: 16 }}>
      <div className="panel-head">
        <h2>Funnel <span className="muted">· leads given to {name.split(' ')[0]}</span></h2>
        <select className="filter" value={period} onChange={(e) => setPeriod(e.target.value)} aria-label="Leads that came in">
          {FUNNEL_PERIODS.map((p) => <option key={p.key} value={p.key}>{p.key === 'all' ? 'All time' : `Came in ${p.label.toLowerCase()}`}</option>)}
        </select>
      </div>
      {mine === null ? <div className="pad"><Skeleton h={180} /></div>
        : mine.leads === 0 ? <Empty>No leads came in for {name.split(' ')[0]} in this period.</Empty>
        : <>
            <div className="now-strip" aria-label="Where these leads are now">
              <span><b>{mine.new_now}</b> New, not contacted yet</span>
              <span><b>{mine.not_picked_now}</b> Not picked up</span>
              <span><b>{mine.follow_up_now}</b> Follow-up</span>
              <span><b>{mine.still_open - mine.new_now - mine.not_picked_now - mine.follow_up_now}</b> Meeting, holding or deferred</span>
              <span><b>{mine.committed - mine.clients}</b> Prospect</span>
              <span><b>{mine.clients}</b> Client</span>
              <span><b>{mine.out_list}</b> Out List</span>
            </div>
            <Funnel c={mine} compare={all && all.leads > mine.leads ? all : null} compareLabel="whole team" showNow={false} />
          </>}
    </div>
  );
}

/* ───────── one person ───────── */
export function PersonPage() {
  const { id } = useParams();
  const { team, isAdmin, teamName } = useApp();
  const toast = useToast();
  const nav = useNavigate();
  const person = team.find((t) => t.id === id);
  const [stat, setStat] = useState<Stat | null>(null);
  const [leads, setLeads] = useState<(Lead & { lead_entries: { count: number }[] })[] | null>(null);
  const [activity, setActivity] = useState<(LeadEntry & { leads: { name: string } | null })[]>([]);
  const [nudges, setNudges] = useState<{ id: string; message: string; created_at: string; from_user: string }[]>([]);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [to, setTo] = useState('');
  const [nudging, setNudging] = useState(false);
  const [showClosed, setShowClosed] = useState(false);

  async function load() {
    const [from, until] = PERIODS[0]!.range();
    loadStats(from, until).then((r) => setStat(r.find((x) => x.user_id === id) ?? null)).catch(() => undefined);
    let q = supabase.from('leads').select('*, lead_entries(count)').eq('rm_id', id!).order('next_follow_up', { ascending: true, nullsFirst: false }).limit(500);
    if (!showClosed) q = q.in('bucket', ['active_contact', 'awaiting_meeting', 'holding', 'deferred']);
    const [l, a, n] = await Promise.all([
      q,
      supabase.from('lead_entries').select('*, leads(name)').eq('created_by', id!).order('occurred_at', { ascending: false }).limit(25),
      supabase.from('nudges').select('*').eq('to_user', id!).order('created_at', { ascending: false }).limit(10),
    ]);
    setLeads((l.data as never) ?? []);
    setActivity((a.data as never) ?? []);
    setNudges((n.data as never) ?? []);
    setSel(new Set());
  }
  useEffect(() => { load(); }, [id, showClosed]);

  if (!isAdmin) return <div className="main-inner"><p>Admins only.</p></div>;
  if (!person) return <div className="main-inner"><Empty>Person not found. <Link to="/admin">Back to Admin</Link></Empty></div>;
  const allSel = !!leads?.length && sel.size === leads.length;

  async function reassign() {
    try {
      const n = await rpc<number>('reassign_leads', { p_leads: [...sel], p_rm: to });
      toast(`${n} lead${n === 1 ? '' : 's'} moved to ${teamName(to)}`);
      setTo(''); load();
    } catch (e) { toast((e as Error).message, 'err'); }
  }

  return (
    <div className="main-inner">
      <div className="crumbs"><Link to="/admin">Admin</Link> / {person.full_name}</div>
      <div className="page-head">
        <div className="person big">
          {person.avatar_url ? <img src={person.avatar_url} alt="" referrerPolicy="no-referrer" /> : <span className="av">{initials(person.full_name)}</span>}
          <div><h1>{person.full_name}</h1><p>{person.email} · {person.role === 'admin' ? 'Admin' : 'RM'} · {person.team}{person.in_rotation ? ' · in round-robin' : ''}</p></div>
        </div>
        {stat && <button className="btn" onClick={() => setNudging(true)}>Nudge{suggestions(stat).length ? ` · ${suggestions(stat).length}` : ''}</button>}
      </div>

      {stat && (
        <div className="cards">
          <div className="card"><div className="k">Open leads</div><div className="v">{stat.open_leads}</div><div className="meta">{stat.active_contact} new or follow-up · {stat.awaiting_meeting} meeting · {stat.holding} holding · {stat.deferred} deferred</div></div>
          <div className="card"><div className="k">Overdue follow-ups</div><div className={`v ${stat.overdue ? 'red' : ''}`}>{stat.overdue}</div><div className="meta">{stat.due_today} due today</div></div>
          <div className="card"><div className="k">This week</div><div className="v">{stat.entries}</div><div className="meta">{stat.calls} calls · last {stat.last_activity_at ? timeAgo(stat.last_activity_at) : 'never'}</div></div>
          <div className="card"><div className="k">Needs attention</div><div className="v">{stat.meetings_unrecorded + stat.tasks_overdue}</div><div className="meta">{stat.meetings_unrecorded} no outcome · {stat.tasks_overdue} task{stat.tasks_overdue === 1 ? '' : 's'} overdue</div></div>
        </div>
      )}

      <RmFunnel rmId={person.id} name={person.full_name ?? 'This RM'} />

      <div className="panel">
        <div className="panel-head">
          <h2>{showClosed ? 'All leads' : 'Open leads'} {leads && <span className="muted">· {leads.length}</span>}</h2>
          <div className="row-gap">
            <label className="check"><input type="checkbox" checked={showClosed} onChange={(e) => setShowClosed(e.target.checked)} /> Include prospects, clients and Out List</label>
            {sel.size > 0 && <>
              <span className="small"><b>{sel.size}</b> selected →</span>
              <select className="filter" value={to} onChange={(e) => setTo(e.target.value)}>
                <option value="">Reassign to…</option>
                {team.filter((t) => t.is_active && t.role !== 'admin' && t.id !== id).map((t) => <option key={t.id} value={t.id}>{t.full_name}</option>)}
              </select>
              <button className="btn sm" disabled={!to} onClick={reassign}>Reassign</button>
              <button className="btn danger sm" onClick={async () => {
                if (!confirm(`Permanently delete ${sel.size} lead${sel.size === 1 ? '' : 's'} and everything about them (activity, notes, meetings, tasks)? This can't be undone.`)) return;
                try { const n = await rpc<number>('delete_leads', { p_leads: [...sel] }); toast(`${n} lead${n === 1 ? '' : 's'} deleted`); load(); }
                catch (e) { toast((e as Error).message, 'err'); }
              }}>Delete</button>
            </>}
          </div>
        </div>
        <div className="table-wrap">
          <table>
            <thead><tr>
              <th><input type="checkbox" checked={allSel} onChange={() => setSel(allSel ? new Set() : new Set(leads?.map((l) => l.id)))} aria-label="Select all" /></th>
              <th>Lead</th><th>Source</th><th>Product</th><th>Stage</th><th>Interactions</th><th>Next follow-up</th>
            </tr></thead>
            <tbody>
              {leads === null && [0, 1, 2].map((i) => <tr key={i}><td colSpan={7}><Skeleton /></td></tr>)}
              {leads?.map((l) => (
                <tr key={l.id} className="lead-row" onClick={() => nav(`/leads/${l.id}`)}>
                  <td onClick={(e) => e.stopPropagation()}>
                    <input type="checkbox" checked={sel.has(l.id)} onChange={() => { const n = new Set(sel); n.has(l.id) ? n.delete(l.id) : n.add(l.id); setSel(n); }} aria-label={`Select ${l.name}`} />
                  </td>
                  <td><div className="lead-name">{l.name}</div><div className="lead-sub">{fmtPhone(l.phone) || l.email}</div></td>
                  <td><span className="src">{l.source}</span></td>
                  <td><ProductTag product={l.product} /></td>
                  <td><StagePill lead={l} /></td>
                  <td>{l.lead_entries?.[0]?.count ?? 0}</td>
                  <td><FollowUp date={l.next_follow_up} /></td>
                </tr>
              ))}
            </tbody>
          </table>
          {leads?.length === 0 && <Empty>No leads.</Empty>}
        </div>
      </div>

      <div className="lead-cols" style={{ marginTop: 22 }}>
        <div className="panel">
          <div className="panel-head"><h2>Recent activity</h2></div>
          <div className="pad">
            {activity.length === 0 && <div className="muted small">Nothing logged yet.</div>}
            <ul className="tl compact">
              {activity.map((e) => (
                <li key={e.id}>
                  <div><b>{entryLabel(e.kind, e.platform)}</b>{e.outcome ? ` · ${OUTCOME_LABEL[e.outcome]}` : ''} with <Link to={`/leads/${e.lead_id}`}>{e.leads?.name ?? 'a lead'}</Link></div>
                  <div className="when">{fmtDateTime(e.occurred_at)} {e.bucket_at !== 'active_contact' && ` · in ${bucketLabel(e.bucket_at)}`}</div>
                </li>
              ))}
            </ul>
          </div>
        </div>
        <div className="panel">
          <div className="panel-head"><h2>Nudges sent</h2></div>
          <div className="pad">
            {nudges.length === 0 && <div className="muted small">No nudges yet.</div>}
            {nudges.map((n) => (
              <div key={n.id} className="comment">
                <div className="c-head"><b>{teamName(n.from_user)}</b><span className="muted small">{fmtDateTime(n.created_at)}</span></div>
                <div>{n.message}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
      {nudging && stat && <NudgeModal s={stat} onClose={() => setNudging(false)} onSent={() => { setNudging(false); load(); }} />}
    </div>
  );
}
