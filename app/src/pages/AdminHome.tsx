import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useApp } from '../auth';
import { rpc, supabase } from '../lib/supabase';
import { addDays, initials, timeAgo, todayIST } from '../lib/format';
import { Skeleton } from '../components/ui';
import { fmtINR } from '../components/OnboardingCard';
import { Funnel, fmtPct, numRow, sumCounts, type Counts, type Row } from './Reports';

/* Admin home: the team an admin manages, at a glance. Admins don't own leads. */

interface Rm {
  user_id: string; full_name: string; avatar_url: string | null; manager_id: string | null; in_rotation: boolean; on_leave: boolean;
  open_leads: number; due_today: number; overdue: number; meetings_week: number; meetings_unrecorded: number;
  new_leads: number; first_response_hours: number | null; prospects: number; clients: number; funded: number;
  untouched_24h: number; untouched_7d: number; on_4_strikes: number; stuck_prospects: number;
  thin_notes_7d: number; activity_7d: number; activity_prev_weekly: number; last_activity_at: string | null; tasks_overdue: number;
}
type ReportRow = Counts & { grp: string };

function monthStart(offset = 0) {
  const t = todayIST();
  return new Date(Date.UTC(+t.slice(0, 4), +t.slice(5, 7) - 1 + offset, 1)).toISOString().slice(0, 10);
}
const PERIODS: { key: string; label: string; range: () => [string, string] }[] = [
  { key: 'month', label: 'This month', range: () => [monthStart(0), todayIST()] },
  { key: 'last', label: 'Last month', range: () => [monthStart(-1), addDays(monthStart(0), -1)] },
  { key: '90', label: 'Last 90 days', range: () => [addDays(todayIST(), -89), todayIST()] },
];
const num = (v: unknown) => Number(v ?? 0);
const hours = (h: number | null) => (h == null ? '—' : h < 1 ? `${Math.round(h * 60)} min` : h < 48 ? `${h.toFixed(h < 10 ? 1 : 0)} h` : `${Math.round(h / 24)} d`);
const dropped = (r: Rm) => r.activity_prev_weekly >= 5 && r.activity_7d < r.activity_prev_weekly * 0.5;

export default function AdminHome() {
  const { me, team } = useApp();
  const nav = useNavigate();
  const managesAnyone = team.some((t) => t.manager_id === me!.id && t.is_active);
  const [scope, setScope] = useState<'team' | 'all'>(managesAnyone ? 'team' : 'all');
  const [period, setPeriod] = useState('month');
  const [rows, setRows] = useState<Rm[] | null>(null);
  const [report, setReport] = useState<ReportRow[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [focus, setFocus] = useState('');                      // RM for the funnel ('' = whole team)
  const [from, to] = PERIODS.find((p) => p.key === period)!.range();

  useEffect(() => { if (managesAnyone) setScope('team'); }, [managesAnyone]);
  useEffect(() => {
    setRows(null); setErr(null);
    rpc<Rm[]>('manager_dashboard', { p_from: from, p_to: to, p_scope: scope })
      .then((d) => setRows(d.map((r) => ({ ...r, ...Object.fromEntries(Object.entries(r).map(([k, v]) => [k, typeof v === 'string' && /^-?\d+(\.\d+)?$/.test(v) ? Number(v) : v])) }) as Rm)))
      .catch((e) => { setErr((e as Error).message); setRows([]); });
    supabase.rpc('report_conversion', { p_from: from, p_to: to, p_group: 'rm', p_rm: null })
      .then(({ data }) => setReport(((data as Row[]) ?? []).map(numRow)));
  }, [from, to, scope]);

  const names = useMemo(() => new Set((rows ?? []).map((r) => r.full_name)), [rows]);
  const teamRows = useMemo(() => (report ?? []).filter((r) => names.has(r.grp)), [report, names]);
  const teamTotal: Counts = useMemo(() => sumCounts(teamRows), [teamRows]);
  const focused = focus ? teamRows.find((r) => r.grp === focus) ?? null : null;

  const sum = (k: keyof Rm) => (rows ?? []).reduce((s, r) => s + num(r[k]), 0);
  const activeToday = (rows ?? []).filter((r) => r.last_activity_at && Date.parse(r.last_activity_at) > Date.now() - 86400e3).length;

  // what to chase, most urgent first
  const attention = (rows ?? []).flatMap((r) => [
    r.untouched_24h > 0 && { r, w: 5, text: `${r.untouched_24h} new lead${r.untouched_24h === 1 ? '' : 's'} not contacted in 24h+` },
    r.meetings_unrecorded > 0 && { r, w: 4, text: `${r.meetings_unrecorded} meeting${r.meetings_unrecorded === 1 ? '' : 's'} with no outcome logged` },
    r.overdue > 0 && { r, w: 3, text: `${r.overdue} follow-up${r.overdue === 1 ? '' : 's'} overdue` },
    r.stuck_prospects > 0 && { r, w: 3, text: `${r.stuck_prospects} prospect${r.stuck_prospects === 1 ? '' : 's'} stuck in onboarding (blocked or no progress in 7 days)` },
    r.on_4_strikes > 0 && { r, w: 2, text: `${r.on_4_strikes} lead${r.on_4_strikes === 1 ? '' : 's'} one strike from the Out List` },
    r.tasks_overdue > 0 && { r, w: 1, text: `${r.tasks_overdue} task${r.tasks_overdue === 1 ? '' : 's'} overdue` },
  ]).filter(Boolean) as { r: Rm; w: number; text: string }[];
  attention.sort((a, b) => b.w - a.w);
  const [dups, setDups] = useState(0);
  useEffect(() => { supabase.from('lead_conflicts').select('id', { count: 'exact', head: true }).eq('status', 'open').then(({ count }) => setDups(count ?? 0)); }, []);

  const quality = (rows ?? []).flatMap((r) => [
    r.thin_notes_7d > 0 && { r, text: `${r.thin_notes_7d} conversation${r.thin_notes_7d === 1 ? '' : 's'} logged with almost no notes this week` },
    r.untouched_7d > 0 && { r, text: `${r.untouched_7d} lead${r.untouched_7d === 1 ? '' : 's'} nobody has touched in 7 days` },
    dropped(r) && { r, text: `Activity down: ${r.activity_7d} this week vs about ${Math.round(r.activity_prev_weekly)} a week before` },
  ]).filter(Boolean) as { r: Rm; text: string }[];

  return (
    <div className="main-inner admin-home">
      <div className="page-head">
        <div><h1>Team</h1><p>{scope === 'team' ? `The ${rows?.length ?? '…'} RM${rows?.length === 1 ? '' : 's'} you manage` : 'Every RM'} · {PERIODS.find((p) => p.key === period)!.label.toLowerCase()}</p></div>
        <div className="row-gap">
          <div className="seg">
            <button className={scope === 'team' ? 'on' : ''} onClick={() => setScope('team')} disabled={!managesAnyone} title={managesAnyone ? undefined : 'Set yourself as manager in Admin → Team & rotation'}>My team</button>
            <button className={scope === 'all' ? 'on' : ''} onClick={() => setScope('all')}>All RMs</button>
          </div>
          <select className="filter" value={period} onChange={(e) => setPeriod(e.target.value)}>{PERIODS.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}</select>
        </div>
      </div>
      {!managesAnyone && <div className="banner">No RMs report to you yet, so this shows every RM. Set managers in <Link to="/admin?tab=team">Admin → Team &amp; rotation</Link>.</div>}
      {err && <div className="banner warn">Couldn't load the team: {err}</div>}
      {dups > 0 && <div className="banner warn"><b>{dups} duplicate lead{dups === 1 ? '' : 's'}</b> from uploads {dups === 1 ? 'is' : 'are'} waiting for you to decide who keeps {dups === 1 ? 'it' : 'them'}. <Link to="/admin?tab=duplicates">Resolve →</Link></div>}

      <div className="cards ah-cards">
        <Tile k="RMs" v={rows ? rows.length : null} sub={rows ? `${activeToday} active today` : ''} />
        <Tile k="Open leads" v={rows ? sum('open_leads') : null} sub={rows ? `${sum('due_today')} due today` : ''} />
        <Tile k="Overdue follow-ups" v={rows ? sum('overdue') : null} tone={sum('overdue') > 0 ? 'red' : ''} />
        <Tile k="Meetings next 7 days" v={rows ? sum('meetings_week') : null} />
        <Tile k="New prospects" v={rows ? sum('prospects') : null} sub={rows ? `${sum('new_leads')} new leads` : ''} />
        <Tile k="New clients" v={rows ? sum('clients') : null} sub={rows && sum('funded') > 0 ? `${fmtINR(sum('funded'))} funded` : ''} />
      </div>

      <div className="ah-cols">
        <div className="panel">
          <div className="panel-head"><h2>Needs attention</h2><span className="muted small">{attention.length || ''}</span></div>
          {rows === null ? <div className="pad"><Skeleton h={80} /></div> : attention.length === 0 ? <div className="pad muted">Nothing to chase. The team is on top of things.</div> : (
            <ul className="ah-list">{attention.slice(0, 12).map((a, i) => (
              <li key={i} onClick={() => nav(`/admin/people/${a.r.user_id}`)}><b>{a.r.full_name}</b><span>{a.text}</span></li>
            ))}</ul>
          )}
        </div>
        <div className="panel">
          <div className="panel-head"><h2>Quality checks</h2><span className="muted small">this week</span></div>
          {rows === null ? <div className="pad"><Skeleton h={80} /></div> : quality.length === 0 ? <div className="pad muted">No flags: notes are filled in, leads are being worked and activity is steady.</div> : (
            <ul className="ah-list">{quality.map((q, i) => (
              <li key={i} onClick={() => nav(`/admin/people/${q.r.user_id}`)}><b>{q.r.full_name}</b><span>{q.text}</span></li>
            ))}</ul>
          )}
        </div>
      </div>

      <div className="panel">
        <div className="panel-head"><h2>RMs</h2><span className="muted small">Click a person for their pipeline</span></div>
        <div className="table-wrap">
          <table>
            <thead><tr><th>RM</th><th>Open</th><th>Due today</th><th>Overdue</th><th>Meetings (7d)</th><th title="Median time from a lead arriving to the first logged activity, for leads that arrived in this period">First response</th><th>New leads</th><th>Prospects</th><th>Clients</th><th>Last active</th></tr></thead>
            <tbody>
              {rows === null && [0, 1, 2].map((i) => <tr key={i}><td colSpan={10}><Skeleton /></td></tr>)}
              {rows?.map((r) => (
                <tr key={r.user_id} className="lead-row" onClick={() => nav(`/admin/people/${r.user_id}`)}>
                  <td><div className="person">{r.avatar_url ? <img src={r.avatar_url} alt="" referrerPolicy="no-referrer" /> : <span className="av">{initials(r.full_name)}</span>}
                    <div><b>{r.full_name}</b>{r.on_leave ? <span className="tag-soft"> on leave</span> : !r.in_rotation ? <span className="muted small"> · not in rotation</span> : null}</div></div></td>
                  <td>{r.open_leads}</td>
                  <td>{r.due_today}</td>
                  <td className={r.overdue ? 'red' : ''}>{r.overdue}</td>
                  <td>{r.meetings_week}</td>
                  <td className={r.first_response_hours != null && r.first_response_hours > 24 ? 'amber' : ''}>{hours(r.first_response_hours)}</td>
                  <td>{r.new_leads}</td>
                  <td>{r.prospects}</td>
                  <td>{r.clients}{r.funded > 0 && <div className="muted small">{fmtINR(r.funded)}</div>}</td>
                  <td className="small">{r.last_activity_at ? timeAgo(r.last_activity_at) : <span className="muted">Never</span>}</td>
                </tr>
              ))}
              {rows?.length === 0 && <tr><td colSpan={10} className="muted">No RMs {scope === 'team' ? 'report to you' : 'yet'}.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      <div className="panel funnel-panel">
        <div className="panel-head">
          <h2>Funnel · {focus || 'whole team'}</h2>
          <select className="filter" value={focus} onChange={(e) => setFocus(e.target.value)}>
            <option value="">Whole team</option>
            {teamRows.map((r) => <option key={r.grp} value={r.grp}>{r.grp}</option>)}
          </select>
        </div>
        {report === null ? <div className="pad"><Skeleton h={160} /></div> : teamTotal.leads === 0 ? <div className="pad muted">No leads arrived in this period.</div>
          : <Funnel c={focused ?? teamTotal} compare={focused ? teamTotal : null} />}
      </div>

      {teamRows.length > 0 && (
        <div className="panel">
          <div className="panel-head"><h2>Conversion by RM</h2><span className="muted small">Share of each RM's leads (arrived in this period) that reached each stage</span></div>
          <div className="table-wrap">
            <table className="conv-matrix">
              <thead><tr><th>RM</th><th>Leads</th><th>Contacted</th><th>Wants to meet</th><th>Met</th><th>Prospect</th><th>Client</th></tr></thead>
              <tbody>
                {[...teamRows].sort((a, b) => b.leads - a.leads).map((r) => (
                  <tr key={r.grp} className={`lead-row ${focus === r.grp ? 'selected' : ''}`} onClick={() => setFocus(focus === r.grp ? '' : r.grp)}>
                    <td><b>{r.grp}</b></td><td>{r.leads}</td>
                    {(['contacted', 'interested', 'met', 'committed', 'clients'] as const).map((k) => (
                      <td key={k}><MiniBar n={r[k]} d={r.leads} team={teamTotal[k] / Math.max(1, teamTotal.leads)} /></td>
                    ))}
                  </tr>
                ))}
                <tr className="total-row"><td>Team</td><td>{teamTotal.leads}</td>
                  {(['contacted', 'interested', 'met', 'committed', 'clients'] as const).map((k) => <td key={k}>{fmtPct(teamTotal[k], teamTotal.leads)}</td>)}</tr>
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

function Tile({ k, v, sub, tone }: { k: string; v: number | null; sub?: string; tone?: string }) {
  return <div className="card"><div className="k">{k}</div><div className={`v ${tone ?? ''}`}>{v === null ? '·' : v.toLocaleString('en-IN')}</div>{sub && <div className="meta">{sub}</div>}</div>;
}

/** Share bar with a tick at the team rate. */
function MiniBar({ n, d, team }: { n: number; d: number; team: number }) {
  const share = d ? n / d : 0;
  return (
    <span className="mini" title={`${n} of ${d} (${fmtPct(n, d)}) · team ${Math.round(team * 100)}%`}>
      <span className="mini-track"><i style={{ width: `${share * 100}%` }} /><em style={{ left: `${team * 100}%` }} /></span>
      <span className="mini-n">{fmtPct(n, d)}</span>
    </span>
  );
}
