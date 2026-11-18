import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useApp } from '../auth';
import { rpc } from '../lib/supabase';
import { addDays, fmtDate, todayIST } from '../lib/format';
import { PLATFORM_LABEL, bucketLabel, type Bucket } from '../lib/types';
import { Empty, Skeleton } from '../components/ui';
import { RmScopeSelect, useRmScope } from '../components/RmScope';
import { fmtPct } from './Reports';

/* Analytics (admins): everything the team did with clients — calls, video calls, meetings, messages, emails — over a period. */

interface Day { d: string; activities: number; clients: number; calls: number; connected: number; meetings: number; prev: number }
interface RmRow {
  rm: string; name: string; activities: number; clients: number; calls: number; connected: number; meetings: number;
  messages: number; emails: number; moved_forward: number; new_leads: number; new_reached: number;
  median_first_hours: number | null; active_days: number;
}
interface Data {
  totals: Record<string, number | null>;
  daily: Day[];
  channels: { key: string; n: number; connected: number; leads: number }[];
  outcomes: Record<string, number>;
  meetings: { by_platform: Record<string, number>; booked: number; canceled: number; logged: Record<string, number> };
  by_rm: RmRow[];
  by_source: { source: string; activities: number; clients: number; connected: number }[];
  hours: { h: number; n: number }[];
  weekdays: { dow: number; n: number }[];
  moves: Record<string, number>;
  email: { sent: number; received: number; logged: number; logged_replied: number };
  messages: { by_platform: Record<string, number>; replied: number };
}

const PERIODS: { key: string; label: string; days: number }[] = [
  { key: '7', label: 'Last 7 days', days: 7 },
  { key: '28', label: 'Last 28 days', days: 28 },
  { key: '90', label: 'Last 90 days', days: 90 },
];
const METRICS: { key: keyof Day; label: string; total: string; prev: string }[] = [
  { key: 'activities', label: 'Activities', total: 'activities', prev: 'activities_prev' },
  { key: 'clients', label: 'Clients reached', total: 'clients', prev: 'clients_prev' },
  { key: 'calls', label: 'Calls', total: 'calls', prev: 'calls_prev' },
  { key: 'connected', label: 'Calls connected', total: 'connected', prev: 'connected_prev' },
  { key: 'meetings', label: 'Meetings held', total: 'meetings', prev: 'meetings_prev' },
];
const OUTCOME_NAMES: Record<string, string> = { connected: 'Connected', no_answer: 'No answer', call_back: 'Asked to call back', not_interested: 'Not interested' };
const DOW = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const n = (v: unknown) => (typeof v === 'number' ? v : Number(v) || 0);
const fmt = (v: number) => v.toLocaleString('en-IN');

export default function Analytics() {
  const { isAdmin } = useApp();
  const nav = useNavigate();
  const sc = useRmScope();
  const scopeKey = sc.ids === null ? 'all' : sc.ids.join(',');
  const [period, setPeriod] = useState('28');
  const [custom, setCustom] = useState<[string, string]>([addDays(todayIST(), -27), todayIST()]);
  const [metric, setMetric] = useState<keyof Day>('activities');
  const [data, setData] = useState<Data | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const [from, to] = period === 'custom' ? custom : [addDays(todayIST(), -(PERIODS.find((p) => p.key === period)!.days - 1)), todayIST()];

  useEffect(() => {
    if (!isAdmin) return;
    setData(null); setErr(null);
    rpc<Data>('activity_analytics', { p_from: from, p_to: to, p_rms: sc.ids })
      .then(setData).catch((e) => setErr((e as Error).message));
  }, [from, to, scopeKey, isAdmin]);   // eslint-disable-line react-hooks/exhaustive-deps

  if (!isAdmin) return <div className="main-inner"><p>Admins only.</p></div>;
  const t = data?.totals ?? {};

  return (
    <div className="main-inner">
      <div className="page-head">
        <div><h1>Analytics</h1><p>Everything the team did with clients: calls, Google Meet and Zoom, in-person meetings, WhatsApp, SMS, LinkedIn and email.</p></div>
        <div className="row-gap">
          <RmScopeSelect s={sc} />
          <select className="filter" value={period} onChange={(e) => setPeriod(e.target.value)} aria-label="Period">
            {PERIODS.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
            <option value="custom">Custom…</option>
          </select>
          {period === 'custom' && <>
            <input type="date" className="filter" value={custom[0]} max={custom[1]} onChange={(e) => e.target.value && setCustom([e.target.value, custom[1]])} />
            <input type="date" className="filter" value={custom[1]} min={custom[0]} max={todayIST()} onChange={(e) => e.target.value && setCustom([custom[0], e.target.value])} />
          </>}
        </div>
      </div>
      <p className="muted small" style={{ marginTop: -14, marginBottom: 16 }}>{fmtDate(from)} – {fmtDate(to)}, compared with the {daysBetween(from, to)} days before.</p>

      {err && <div className="form-err" style={{ marginBottom: 16 }}>{err}</div>}

      {/* headline numbers: each tile switches the chart */}
      <div className="panel an-trend">
        <div className="an-kpis" role="tablist" aria-label="Metric">
          {METRICS.map((m) => {
            const cur = n(t[m.total]); const prev = n(t[m.prev]);
            return (
              <button key={m.key} role="tab" aria-selected={metric === m.key} className={`an-kpi ${metric === m.key ? 'on' : ''}`} onClick={() => setMetric(m.key)}>
                <span className="k">{m.label}</span>
                <span className="v">{data ? fmt(cur) : '·'}</span>
                {data && <Delta cur={cur} prev={prev} />}
              </button>
            );
          })}
        </div>
        <div className="pad">{data ? <LineChart days={data.daily} metric={metric} /> : <Skeleton h={220} />}</div>
      </div>

      <div className="cards an-cards">
        <Tile k="Connect rate" v={data ? fmtPct(n(t.connected), n(t.calls)) : null} sub={data ? `${fmt(n(t.connected))} of ${fmt(n(t.calls))} calls picked up` : ''} />
        <Tile k="New leads reached" v={data ? fmtPct(n(t.new_reached), n(t.new_leads)) : null} sub={data ? `${fmt(n(t.new_reached))} of ${fmt(n(t.new_leads))} that came in` : ''} />
        <Tile k="Time to first contact" v={data ? (t.median_first_hours === null ? '—' : hours(n(t.median_first_hours))) : null} sub="median, from lead added to first call or message" />
        <Tile k="Messages & emails" v={data ? fmt(n(t.messages) + n(t.emails)) : null} sub={data ? `${fmt(n(t.messages))} messages · ${fmt(n(t.emails))} emails` : ''} />
      </div>

      <div className="an-grid">
        <Panel title="How we reached clients" sub="Every logged call, video call, meeting and message, plus Gmail">
          {data && (data.channels.length ? <Bars rows={data.channels.map((c) => ({
            label: PLATFORM_LABEL[c.key] ?? c.key, value: c.n,
            note: c.key === 'gmail' ? `${fmt(c.connected)} replies received` : `${fmt(c.leads)} client${c.leads === 1 ? '' : 's'} · ${fmtPct(c.connected, c.n)} ${c.key === 'phone' || c.key === 'google-meet' || c.key === 'zoom' ? 'connected' : c.key === 'in-person' ? 'held' : 'replied'}`,
          }))} /> : <Empty>Nothing logged in this period.</Empty>)}
        </Panel>

        <Panel title="Call outcomes" sub="Phone and video calls">
          {data && (n(t.calls) ? <Bars rows={['connected', 'no_answer', 'call_back', 'not_interested'].map((k) => ({
            label: OUTCOME_NAMES[k], value: n(data.outcomes[k]), note: fmtPct(n(data.outcomes[k]), n(t.calls)),
          }))} /> : <Empty>No calls in this period.</Empty>)}
        </Panel>

        <Panel title="Meetings by platform" sub="Booked through the scheduler (by meeting date) and held (logged)">
          {data && <MeetingsTable d={data} />}
        </Panel>

        <Panel title="Messages by app" sub={data ? `${fmt(data.messages.replied)} of ${fmt(n(t.messages))} got a reply` : ''}>
          {data && (n(t.messages) ? <Bars rows={['whatsapp', 'sms', 'linkedin', 'other'].map((k) => ({
            label: k === 'other' ? 'Other / not recorded' : PLATFORM_LABEL[k], value: n(data.messages.by_platform[k]),
          })).filter((r) => r.value || r.label !== 'Other / not recorded')} /> : <Empty>No messages in this period.</Empty>)}
        </Panel>

        <Panel title="Email" sub="Gmail sync and emails logged by hand">
          {data && (
            <div className="an-mini">
              <div><b>{fmt(data.email.sent)}</b><span>sent from Gmail</span></div>
              <div><b>{fmt(data.email.received)}</b><span>received from clients</span></div>
              <div><b>{data.email.sent ? fmtPct(data.email.received, data.email.sent) : '—'}</b><span>replies per email sent</span></div>
              <div><b>{fmt(data.email.logged)}</b><span>logged by hand · {fmt(data.email.logged_replied)} replied</span></div>
            </div>
          )}
        </Panel>

        <Panel title="Stage moves" sub="Leads moved into each stage in this period">
          {data && (Object.keys(data.moves).length ? <Bars rows={(['awaiting_meeting', 'holding', 'deferred', 'converting', 'client', 'active_contact', 'out'] as Bucket[])
            .filter((b) => data.moves[b]).map((b) => ({ label: b === 'active_contact' ? 'Back to Follow-up' : bucketLabel(b), value: n(data.moves[b]) }))} /> : <Empty>No stage changes in this period.</Empty>)}
        </Panel>

        <Panel title="Busiest hours" sub="Calls, messages and meetings by hour of day (IST)">
          {data && <Columns rows={data.hours.filter((h) => h.h >= 7 && h.h <= 22).map((h) => ({ label: h.h === 12 ? '12p' : h.h > 12 ? `${h.h - 12}p` : `${h.h}a`, value: h.n, title: `${h.h}:00–${h.h + 1}:00` }))}
            hidden={data.hours.filter((h) => h.h < 7 || h.h > 22).reduce((s, h) => s + h.n, 0)} />}
        </Panel>

        <Panel title="By day of week" sub="Calls, messages and meetings">
          {data && <Columns rows={data.weekdays.map((w) => ({ label: DOW[w.dow - 1], value: w.n, title: DOW[w.dow - 1] }))} />}
        </Panel>
      </div>

      <div className="panel">
        <div className="panel-head"><h2>By RM</h2><span className="muted small">Click an RM for their funnel and leads</span></div>
        {!data ? <div className="pad"><Skeleton h={120} /></div> : data.by_rm.length === 0 ? <Empty>No RMs in this view.</Empty> : <RmTable rows={data.by_rm} days={daysBetween(from, to)} onOpen={(id) => nav(`/admin/people/${id}`)} />}
      </div>

      <div className="panel">
        <div className="panel-head"><h2>By lead source</h2><span className="muted small">Activity on leads from each source</span></div>
        {!data ? <div className="pad"><Skeleton h={80} /></div> : data.by_source.length === 0 ? <Empty>Nothing logged in this period.</Empty> : (
          <div className="table-wrap">
            <table className="an-rm">
              <thead><tr><th>Source</th><th className="num">Activities</th><th className="num">Clients reached</th><th className="num">Spoke / replied</th><th className="num">Rate</th></tr></thead>
              <tbody>{data.by_source.map((s) => (
                <tr key={s.source}><td><b>{s.source}</b></td><td className="num">{fmt(s.activities)}</td><td className="num">{fmt(s.clients)}</td><td className="num">{fmt(s.connected)}</td><td className="num">{fmtPct(s.connected, s.activities)}</td></tr>
              ))}</tbody>
            </table>
          </div>
        )}
      </div>
      <p className="hint">For how leads move through stages (reached out → spoke → wants to meet → met → prospect → client), see <Link to="/reports">Reports</Link> or an RM's page.
        Video calls logged before the platform choice existed count as Google Meet; older messages show as "not recorded".</p>
    </div>
  );
}

function daysBetween(a: string, b: string) { return Math.round((Date.parse(b) - Date.parse(a)) / 86400e3) + 1; }
function hours(h: number) { return h < 1 ? `${Math.round(h * 60)} min` : h < 48 ? `${h.toFixed(h < 10 ? 1 : 0)} h` : `${(h / 24).toFixed(1)} days`; }

function Delta({ cur, prev }: { cur: number; prev: number }) {
  if (!prev && !cur) return <span className="an-delta flat">no change</span>;
  if (!prev) return <span className="an-delta up">new</span>;
  const p = Math.round(((cur - prev) / prev) * 100);
  return <span className={`an-delta ${p > 0 ? 'up' : p < 0 ? 'down' : 'flat'}`} title={`${prev.toLocaleString('en-IN')} in the previous period`}>{p > 0 ? '↑' : p < 0 ? '↓' : ''} {Math.abs(p)}%</span>;
}

function Tile({ k, v, sub }: { k: string; v: string | null; sub?: string }) {
  return <div className="card"><div className="k">{k}</div><div className="v">{v === null ? '·' : v}</div>{sub && <div className="meta">{sub}</div>}</div>;
}

function Panel({ title, sub, children }: { title: string; sub?: string; children: React.ReactNode }) {
  return (
    <div className="panel an-panel">
      <div className="panel-head"><div><h2>{title}</h2>{sub && <div className="muted small">{sub}</div>}</div></div>
      <div className="pad">{children || <Skeleton h={120} />}</div>
    </div>
  );
}

/** Horizontal bars, one hue; the value is printed, so the bar only needs to show size. */
function Bars({ rows }: { rows: { label: string; value: number; note?: string }[] }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <div className="an-bars">
      {rows.map((r) => (
        <div key={r.label} className="an-bar-row">
          <span className="an-bar-label">{r.label}</span>
          <span className="an-bar-track"><i style={{ width: `${(r.value / max) * 100}%` }} /></span>
          <span className="an-bar-val"><b>{r.value.toLocaleString('en-IN')}</b>{r.note && <small>{r.note}</small>}</span>
        </div>
      ))}
    </div>
  );
}

function Columns({ rows, hidden = 0 }: { rows: { label: string; value: number; title: string }[]; hidden?: number }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  const peak = rows.reduce((b, r) => (r.value > b.value ? r : b), rows[0]);
  return (
    <>
      <div className="an-cols" role="img" aria-label={peak?.value ? `Busiest: ${peak.title}, ${peak.value}` : 'No activity'}>
        {rows.map((r) => (
          <div key={r.label} className="an-col" title={`${r.title}: ${r.value.toLocaleString('en-IN')}`}>
            <span className="an-col-bar"><i className={r === peak && r.value ? 'peak' : ''} style={{ height: `${(r.value / max) * 100}%` }} /></span>
            <span className="an-col-label">{r.label}</span>
          </div>
        ))}
      </div>
      <div className="muted small" style={{ marginTop: 6 }}>
        {peak?.value ? <>Busiest: <b>{peak.title}</b> ({peak.value.toLocaleString('en-IN')})</> : 'Nothing logged yet.'}
        {hidden > 0 && ` · ${hidden} outside 7am–11pm`}
      </div>
    </>
  );
}

function MeetingsTable({ d }: { d: Data }) {
  const keys = ['google-meet', 'zoom', 'in-person', 'other'];
  const rows = keys.map((k) => ({ k, booked: n(d.meetings.by_platform[k]), held: n(d.meetings.logged[k]) })).filter((r) => r.booked || r.held || r.k !== 'other');
  return (
    <>
      <table className="an-table">
        <thead><tr><th>Platform</th><th className="num">Booked</th><th className="num">Held</th></tr></thead>
        <tbody>{rows.map((r) => (
          <tr key={r.k}><td>{r.k === 'other' ? 'Other link' : PLATFORM_LABEL[r.k]}</td><td className="num">{fmt(r.booked)}</td><td className="num"><b>{fmt(r.held)}</b></td></tr>
        ))}</tbody>
      </table>
      <div className="muted small" style={{ marginTop: 8 }}>{fmt(d.meetings.booked)} booked · {fmt(d.meetings.canceled)} cancelled. Held = video calls that connected and in-person meetings logged.</div>
    </>
  );
}

function RmTable({ rows, days, onOpen }: { rows: RmRow[]; days: number; onOpen: (id: string) => void }) {
  const [sort, setSort] = useState<keyof RmRow>('activities');
  const sorted = useMemo(() => [...rows].sort((a, b) => sort === 'name' ? a.name.localeCompare(b.name)
    : sort === 'median_first_hours' ? (a.median_first_hours ?? 1e9) - (b.median_first_hours ?? 1e9)
    : n(b[sort]) - n(a[sort])), [rows, sort]);
  const avg = rows.reduce((s, r) => s + r.activities, 0) / Math.max(1, rows.length);
  const max = Math.max(1, ...rows.map((r) => r.activities));
  const Th = ({ k, children, title }: { k: keyof RmRow; children: React.ReactNode; title?: string }) => (
    <th className={`num sortable ${sort === k ? 'sorted' : ''}`} title={title} onClick={() => setSort(k)}>{children}</th>
  );
  return (
    <div className="table-wrap">
      <table className="an-rm">
        <thead><tr>
          <th className={`sortable ${sort === 'name' ? 'sorted' : ''}`} onClick={() => setSort('name')}>RM</th>
          <Th k="activities">Activities</Th><Th k="clients">Clients reached</Th><Th k="calls">Calls</Th><Th k="connected" title="Calls picked up">Connected</Th>
          <Th k="meetings">Meetings</Th><Th k="messages">Messages</Th><Th k="emails">Emails</Th><Th k="moved_forward" title="Moved to meeting, holding, prospect or client">Moved forward</Th>
          <Th k="new_reached" title="New leads given to them in this period that they have contacted">New leads reached</Th>
          <Th k="median_first_hours" title="Median time from a lead being added to the first call or message">First contact</Th>
          <Th k="active_days">Active days</Th>
        </tr></thead>
        <tbody>{sorted.map((r) => (
          <tr key={r.rm} className="clickable" onClick={() => onOpen(r.rm)}>
            <td className="nowrap"><b>{r.name}</b></td>
            <td className="num"><div className="an-rm-act">
              <span className="an-inline" title={`Team average ${avg.toFixed(0)}`}><i style={{ width: `${(r.activities / max) * 100}%` }} /><em style={{ left: `${(avg / max) * 100}%` }} /></span>
              <b>{fmt(r.activities)}</b><small>{(r.activities / days).toFixed(1)}/day</small>
            </div></td>
            <td className="num">{fmt(r.clients)}</td>
            <td className="num">{fmt(r.calls)}</td>
            <td className="num">{fmt(r.connected)} <small className="muted">{fmtPct(r.connected, r.calls)}</small></td>
            <td className="num">{fmt(r.meetings)}</td>
            <td className="num">{fmt(r.messages)}</td>
            <td className="num">{fmt(r.emails)}</td>
            <td className="num">{fmt(r.moved_forward)}</td>
            <td className="num">{fmt(r.new_reached)} <small className="muted">of {fmt(r.new_leads)}</small></td>
            <td className="num">{r.median_first_hours === null ? '—' : hours(n(r.median_first_hours))}</td>
            <td className="num">{r.active_days} <small className="muted">of {days}</small></td>
          </tr>
        ))}</tbody>
      </table>
      <div className="an-legend"><span><i className="sw-bar" /> activities</span><span><i className="sw-mark" /> team average</span></div>
    </div>
  );
}

/** Daily line for the chosen metric; the previous period (activities only) as a grey dashed line. */
function LineChart({ days, metric }: { days: Day[]; metric: keyof Day }) {
  const [hover, setHover] = useState<number | null>(null);
  const W = 900, H = 220, L = 36, R = 12, T = 12, B = 26;
  const vals = days.map((d) => n(d[metric]));
  const prev = metric === 'activities' ? days.map((d) => n(d.prev)) : null;
  const max = niceMax(Math.max(1, ...vals, ...(prev ?? [])));
  const x = (i: number) => L + (days.length === 1 ? (W - L - R) / 2 : (i / (days.length - 1)) * (W - L - R));
  const y = (v: number) => T + (1 - v / max) * (H - T - B);
  const path = (a: number[]) => a.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join('');
  const ticks = [0, max / 2, max];
  const every = Math.max(1, Math.ceil(days.length / 8));
  const label = METRICS.find((m) => m.key === metric)!.label;
  return (
    <div className="an-line">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${label} per day`} onMouseLeave={() => setHover(null)}
        onMouseMove={(e) => {
          const r = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
          const px = ((e.clientX - r.left) / r.width) * W;
          const i = Math.round(((px - L) / (W - L - R)) * (days.length - 1));
          setHover(Math.max(0, Math.min(days.length - 1, i)));
        }}>
        {ticks.map((tk) => <g key={tk}><line x1={L} x2={W - R} y1={y(tk)} y2={y(tk)} className="grid" /><text x={L - 6} y={y(tk) + 4} textAnchor="end">{Math.round(tk)}</text></g>)}
        {days.map((d, i) => i % every === 0 && <text key={d.d} x={x(i)} y={H - 6} textAnchor="middle">{fmtDate(d.d).replace(/ \d{4}$/, '')}</text>)}
        {prev && <path d={path(prev)} className="prev" />}
        <path d={path(vals)} className="cur" />
        {days.length <= 31 && vals.map((v, i) => <circle key={i} cx={x(i)} cy={y(v)} r={2.5} className="dot" />)}
        {hover !== null && <>
          <line x1={x(hover)} x2={x(hover)} y1={T} y2={H - B} className="cross" />
          <circle cx={x(hover)} cy={y(vals[hover])} r={4.5} className="dot hov" />
        </>}
      </svg>
      {hover !== null && (
        <div className="an-tip" style={{ left: `${(x(hover) / W) * 100}%` }}>
          <b>{fmtDate(days[hover].d)}</b>
          <span>{label}: <b>{vals[hover].toLocaleString('en-IN')}</b></span>
          {prev && <span className="muted">Previous period: {prev[hover].toLocaleString('en-IN')}</span>}
        </div>
      )}
      <div className="an-legend"><span><i className="sw-cur" /> {label}</span>{prev && <span><i className="sw-prev" /> previous period</span>}</div>
    </div>
  );
}
function niceMax(v: number) { const p = 10 ** Math.floor(Math.log10(v)); const m = v / p; return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 5 ? 5 : 10) * p; }
