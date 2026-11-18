import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import Papa from 'papaparse';
import { useApp } from '../auth';
import { supabase } from '../lib/supabase';
import { addDays, fmtDate, fmtTime, todayIST } from '../lib/format';
import { OUTCOME_LABEL, entryLabel, bucketLabel, type Bucket, type Outcome } from '../lib/types';
import { Empty, ProductTag, Skeleton } from '../components/ui';
import { RmScopeSelect, scoped, useRmScope } from '../components/RmScope';

/* Daily log: everything done with clients on one day — calls, messages, meetings, notes and stage moves. */

type LeadMini = { id: string; name: string; product: string; bucket: Bucket; next_follow_up: string | null; next_follow_up_at: string | null; created_at: string };
interface Entry { id: string; lead_id: string; kind: string; outcome: Outcome | null; notes: string | null; occurred_at: string; bucket_at: Bucket; created_by: string | null; platform: string | null; leads: LeadMini | null }
interface Ev { id: number; lead_id: string; kind: string; from_value: string | null; to_value: string | null; actor: string | null; at: string; detail: { reason?: string } | null; leads: LeadMini | null }
type Row =
  | { type: 'entry'; at: string; who: string | null; lead: LeadMini | null; e: Entry }
  | { type: 'move'; at: string; who: string | null; lead: LeadMini | null; v: Ev };

const OUTREACH = ['phone_call', 'meet_call', 'message', 'email', 'in_person'];

export default function DailyLog() {
  const { isAdmin, teamName } = useApp();
  const sc = useRmScope();
  const scopeKey = sc.ids === null ? 'all' : sc.ids.join(',');
  const [day, setDay] = useState(todayIST());
  const [rows, setRows] = useState<Row[] | null>(null);
  const [touchedBefore, setTouchedBefore] = useState<Set<string>>(new Set());   // leads contacted before this day

  useEffect(() => {
    setRows(null);
    const from = new Date(`${day}T00:00:00+05:30`).toISOString();
    const to = new Date(`${addDays(day, 1)}T00:00:00+05:30`).toISOString();
    const lead = 'leads(id, name, product, bucket, next_follow_up, next_follow_up_at, created_at)';
    Promise.all([
      scoped(supabase.from('lead_entries').select(`*, ${lead}`), sc.ids, 'created_by').gte('occurred_at', from).lt('occurred_at', to).order('occurred_at').limit(2000),
      scoped(supabase.from('lead_events').select(`*, ${lead}`), sc.ids, 'actor').eq('kind', 'bucket').gte('at', from).lt('at', to).order('at').limit(2000),
    ]).then(async ([en, ev]: any[]) => {
      const out: Row[] = [
        ...((en.data ?? []) as Entry[]).map((e) => ({ type: 'entry' as const, at: e.occurred_at, who: e.created_by, lead: e.leads, e })),
        ...((ev.data ?? []) as Ev[]).map((v) => ({ type: 'move' as const, at: v.at, who: v.actor, lead: v.leads, v })),
      ];
      out.sort((a, b) => a.at.localeCompare(b.at));
      // which of these leads had been contacted before this day (so the rest are first contacts)
      const ids = [...new Set(out.filter((r) => r.type === 'entry').map((r) => r.lead?.id).filter(Boolean))] as string[];
      const prior = ids.length
        ? (await supabase.from('lead_entries').select('lead_id').in('lead_id', ids).in('kind', OUTREACH).lt('occurred_at', from).limit(5000)).data ?? []
        : [];
      setTouchedBefore(new Set((prior as { lead_id: string }[]).map((x) => x.lead_id)));
      setRows(out);
    });
  }, [day, scopeKey]);   // eslint-disable-line react-hooks/exhaustive-deps

  const s = useMemo(() => {
    const entries = (rows ?? []).filter((r): r is Extract<Row, { type: 'entry' }> => r.type === 'entry').map((r) => r.e);
    const calls = entries.filter((e) => e.kind === 'phone_call' || e.kind === 'meet_call');
    const moves = (rows ?? []).filter((r): r is Extract<Row, { type: 'move' }> => r.type === 'move');
    const firstTouch = new Set(entries.filter((e) => OUTREACH.includes(e.kind) && !touchedBefore.has(e.lead_id)).map((e) => e.lead_id));
    return {
      clients: new Set(entries.filter((e) => OUTREACH.includes(e.kind)).map((e) => e.lead_id)).size,
      calls: calls.length,
      connected: calls.filter((e) => e.outcome === 'connected').length,
      noAnswer: calls.filter((e) => e.outcome === 'no_answer').length,
      messages: entries.filter((e) => e.kind === 'message' || e.kind === 'email').length,
      meetings: entries.filter((e) => e.kind === 'in_person' || (e.kind === 'meet_call' && e.outcome === 'connected')).length,
      forward: moves.filter((m) => ['awaiting_meeting', 'holding', 'converting', 'client'].includes(m.v.to_value ?? '')).length,
      firstTouch: firstTouch.size,
    };
  }, [rows, touchedBefore]);

  const describe = (r: Row) => r.type === 'entry'
    ? `${entryLabel(r.e.kind, r.e.platform)}${r.e.outcome ? ` · ${OUTCOME_LABEL[r.e.outcome] ?? r.e.outcome}` : ''}`
    : `Moved to ${bucketLabel(r.v.to_value as Bucket)}${r.v.detail?.reason ? ` · ${r.v.detail.reason}` : ''}`;

  function exportCsv() {
    const csv = Papa.unparse([
      ['Time (IST)', ...(isAdmin ? ['RM'] : []), 'Client', 'Product', 'What happened', 'Notes', 'Stage now', 'Next follow-up'],
      ...(rows ?? []).map((r) => [fmtTime(r.at), ...(isAdmin ? [teamName(r.who)] : []), r.lead?.name ?? '', r.lead?.product ?? '', describe(r),
        r.type === 'entry' ? (r.e.notes ?? '') : '', r.lead ? bucketLabel(r.lead.bucket) : '',
        r.lead?.next_follow_up ? `${r.lead.next_follow_up}${r.lead.next_follow_up_at ? ' ' + fmtTime(r.lead.next_follow_up_at) : ''}` : '']),
    ]);
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }));
    a.download = `daily-log-${day}.csv`;
    a.click();
  }

  const today = todayIST();
  return (
    <div className="main-inner">
      <div className="page-head">
        <div><h1>Daily log</h1><p>{isAdmin ? 'Everything the team did with clients on one day.' : 'Everything you did with clients on one day: calls, messages, meetings, notes and stage moves.'}</p></div>
        <div className="row-gap">
          <RmScopeSelect s={sc} />
          <button className="btn ghost" disabled={!rows?.length} onClick={exportCsv}>Download CSV</button>
        </div>
      </div>

      <div className="toolbar" style={{ marginBottom: 14 }}>
        <button className="btn ghost sm" onClick={() => setDay(addDays(day, -1))} aria-label="Previous day">‹</button>
        <input type="date" className="filter" value={day} max={today} onChange={(e) => e.target.value && setDay(e.target.value)} />
        <button className="btn ghost sm" disabled={day >= today} onClick={() => setDay(addDays(day, 1))} aria-label="Next day">›</button>
        {day !== today && <button className="linkbtn small" onClick={() => setDay(today)}>Today</button>}
        <b className="dl-day">{day === today ? 'Today' : day === addDays(today, -1) ? 'Yesterday' : fmtDate(day)}</b>
      </div>

      <div className="cards dl-cards">
        <Tile k="Clients reached" v={rows ? s.clients : null} sub={rows ? `${s.firstTouch} contacted for the first time` : ''} />
        <Tile k="Calls" v={rows ? s.calls : null} sub={rows ? `${s.connected} connected · ${s.noAnswer} no answer` : ''} />
        <Tile k="Messages & emails" v={rows ? s.messages : null} />
        <Tile k="Meetings held" v={rows ? s.meetings : null} />
        <Tile k="Moved forward" v={rows ? s.forward : null} sub="to meeting, holding, prospect or client" />
      </div>

      <div className="panel">
        <div className="panel-head"><h2>What happened</h2><span className="muted small">{rows ? `${rows.length} item${rows.length === 1 ? '' : 's'}` : ''}</span></div>
        {rows === null ? <div className="pad"><Skeleton h={120} /></div> : rows.length === 0 ? <Empty>Nothing logged {day === today ? 'yet today' : 'on this day'}.</Empty> : (
          <div className="table-wrap">
            <table className="dl-table">
              <thead><tr><th>Time</th>{isAdmin && <th>RM</th>}<th>Client</th><th>What happened</th><th>Notes</th><th>Stage now</th><th>Next follow-up</th></tr></thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.type + (r.type === 'entry' ? r.e.id : r.v.id)}>
                    <td className="small nowrap">{fmtTime(r.at)}</td>
                    {isAdmin && <td className="small">{teamName(r.who)}</td>}
                    <td>{r.lead ? <Link to={`/leads/${r.lead.id}`}><b>{r.lead.name}</b></Link> : <span className="muted">Deleted lead</span>}
                      {r.lead && <div className="lead-sub"><ProductTag product={r.lead.product} /></div>}</td>
                    <td className={r.type === 'move' ? 'dl-move' : ''}>{describe(r)}</td>
                    <td className="dl-notes">{r.type === 'entry' && r.e.notes ? r.e.notes : <span className="muted">—</span>}</td>
                    <td className="small">{r.lead ? bucketLabel(r.lead.bucket) : ''}</td>
                    <td className="small nowrap">{r.lead?.next_follow_up ? `${fmtDate(r.lead.next_follow_up)}${r.lead.next_follow_up_at ? `, ${fmtTime(r.lead.next_follow_up_at)}` : ''}` : <span className="muted">—</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function Tile({ k, v, sub }: { k: string; v: number | null; sub?: string }) {
  return <div className="card"><div className="k">{k}</div><div className="v">{v === null ? '·' : v}</div>{sub && <div className="meta">{sub}</div>}</div>;
}
