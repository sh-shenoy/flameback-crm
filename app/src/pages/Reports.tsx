import { useEffect, useMemo, useState } from 'react';
import Papa from 'papaparse';
import { useApp } from '../auth';
import { supabase } from '../lib/supabase';
import { addDays, fmtDate, todayIST } from '../lib/format';
import { Empty, Skeleton } from '../components/ui';

type Group = 'source' | 'campaign' | 'referrer' | 'product' | 'rm';
interface Row { grp: string; source_kind: string | null; leads: number; contacted: number; met: number; committed: number; out_list: number; still_open: number }

const GROUPS: { key: Group; label: string; admin?: boolean }[] = [
  { key: 'source', label: 'Source' },
  { key: 'campaign', label: 'Campaign' },
  { key: 'referrer', label: 'Referrer' },
  { key: 'product', label: 'Product' },
  { key: 'rm', label: 'RM', admin: true },
];

function monthStart(offset = 0) {
  const t = todayIST();
  return new Date(Date.UTC(+t.slice(0, 4), +t.slice(5, 7) - 1 + offset, 1)).toISOString().slice(0, 10);
}
const PERIODS: { key: string; label: string; range: () => [string, string] }[] = [
  { key: 'month', label: 'This month', range: () => [monthStart(0), todayIST()] },
  { key: 'last', label: 'Last month', range: () => [monthStart(-1), addDays(monthStart(0), -1)] },
  { key: '90', label: 'Last 90 days', range: () => [addDays(todayIST(), -89), todayIST()] },
  { key: 'year', label: 'This year', range: () => [todayIST().slice(0, 4) + '-01-01', todayIST()] },
  { key: 'all', label: 'All time', range: () => ['2020-01-01', todayIST()] },
];
const pct = (n: number, d: number) => (d ? Math.round((n / d) * 100) : 0);

export default function Reports() {
  const { isAdmin, team, me } = useApp();
  const [group, setGroup] = useState<Group>('source');
  const [period, setPeriod] = useState('90');
  const [custom, setCustom] = useState<[string, string]>([addDays(todayIST(), -29), todayIST()]);
  const [rm, setRm] = useState(isAdmin ? '' : me!.id);
  const [rows, setRows] = useState<Row[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [sort, setSort] = useState<keyof Row>('committed');

  const [from, to] = period === 'custom' ? custom : PERIODS.find((p) => p.key === period)!.range();

  useEffect(() => {
    setRows(null); setErr(null);
    supabase.rpc('report_conversion', { p_from: from, p_to: to, p_group: group, p_rm: rm || null })
      .then(({ data, error }) => {
        if (error) { setErr(error.message); setRows([]); return; }
        setRows(((data as Row[]) ?? []).map((r) => ({ ...r, leads: +r.leads, contacted: +r.contacted, met: +r.met, committed: +r.committed, out_list: +r.out_list, still_open: +r.still_open })));
      });
  }, [group, from, to, rm]);

  const sorted = useMemo(() => [...(rows ?? [])].sort((a, b) =>
    sort === 'grp' ? a.grp.localeCompare(b.grp) : (b[sort] as number) - (a[sort] as number) || b.leads - a.leads), [rows, sort]);
  const total = (rows ?? []).reduce((t, r) => ({
    leads: t.leads + r.leads, contacted: t.contacted + r.contacted, met: t.met + r.met,
    committed: t.committed + r.committed, out_list: t.out_list + r.out_list, still_open: t.still_open + r.still_open,
  }), { leads: 0, contacted: 0, met: 0, committed: 0, out_list: 0, still_open: 0 });
  const best = Math.max(1, ...(rows ?? []).filter((r) => r.leads >= 5).map((r) => pct(r.committed, r.leads)));
  const groupLabel = GROUPS.find((g) => g.key === group)!.label;

  function exportCsv() {
    const csv = Papa.unparse([
      [groupLabel, ...(group === 'source' ? ['Type'] : []), 'Leads', 'Contacted', 'Met', 'Committed', 'Conversion %', 'Out List', 'Still open'],
      ...sorted.map((r) => [r.grp, ...(group === 'source' ? [r.source_kind ?? ''] : []), r.leads, r.contacted, r.met, r.committed, pct(r.committed, r.leads), r.out_list, r.still_open]),
    ]);
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }));
    a.download = `conversion-by-${group}-${from}-to-${to}.csv`;
    a.click();
  }

  const Th = ({ k, children }: { k: keyof Row; children: string }) => (
    <th className={`sortable ${sort === k ? 'sorted' : ''}`} onClick={() => setSort(k)}>{children}</th>
  );

  return (
    <div className="main-inner">
      <div className="page-head">
        <div><h1>Reports</h1><p>Which sources, campaigns and referrers turn leads into clients. {isAdmin ? 'You see everyone’s leads.' : 'Based on your leads.'}</p></div>
        <button className="btn ghost" disabled={!rows?.length} onClick={exportCsv}>Download CSV</button>
      </div>

      <div className="toolbar" style={{ marginBottom: 14 }}>
        <div className="seg">
          {GROUPS.filter((g) => !g.admin || isAdmin).map((g) => (
            <button key={g.key} className={group === g.key ? 'on' : ''} onClick={() => setGroup(g.key)}>{g.label}</button>
          ))}
        </div>
        <select className="filter" value={period} onChange={(e) => setPeriod(e.target.value)}>
          {PERIODS.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
          <option value="custom">Custom dates</option>
        </select>
        {period === 'custom' && <>
          <input type="date" className="filter" value={custom[0]} max={custom[1]} onChange={(e) => setCustom([e.target.value, custom[1]])} />
          <span className="muted">to</span>
          <input type="date" className="filter" value={custom[1]} min={custom[0]} onChange={(e) => setCustom([custom[0], e.target.value])} />
        </>}
        {isAdmin && (
          <select className="filter" value={rm} onChange={(e) => setRm(e.target.value)}>
            <option value="">All RMs</option>
            {team.filter((t) => t.is_active).map((t) => <option key={t.id} value={t.id}>{t.full_name}</option>)}
          </select>
        )}
        <span className="muted small">Leads created {fmtDate(from)} – {fmtDate(to)}</span>
      </div>

      <div className="cards">
        <div className="card"><div className="k">Leads</div><div className="v">{rows ? total.leads : '·'}</div></div>
        <div className="card"><div className="k">Contacted</div><div className="v">{rows ? `${pct(total.contacted, total.leads)}%` : '·'}</div><div className="meta">{total.contacted} leads</div></div>
        <div className="card"><div className="k">Met</div><div className="v">{rows ? `${pct(total.met, total.leads)}%` : '·'}</div><div className="meta">{total.met} leads</div></div>
        <div className="card"><div className="k">Committed</div><div className="v">{rows ? `${pct(total.committed, total.leads)}%` : '·'}</div><div className="meta">{total.committed} leads</div></div>
      </div>

      {err && <div className="banner warn">Couldn't load the report: {err}</div>}
      <div className="panel">
        <div className="panel-head"><h2>Conversion by {groupLabel.toLowerCase()}</h2><span className="muted small">Click a column to sort</span></div>
        <div className="table-wrap">
          <table className="report">
            <thead><tr>
              <Th k="grp">{groupLabel}</Th>
              <Th k="leads">Leads</Th><Th k="contacted">Contacted</Th><Th k="met">Met</Th><Th k="committed">Committed</Th>
              <th>Conversion</th><Th k="out_list">Out List</Th><Th k="still_open">Still open</Th>
            </tr></thead>
            <tbody>
              {rows === null && [0, 1, 2].map((i) => <tr key={i}><td colSpan={8}><Skeleton /></td></tr>)}
              {sorted.map((r) => {
                const c = pct(r.committed, r.leads);
                return (
                  <tr key={r.grp}>
                    <td><b>{r.grp}</b>{r.source_kind && <span className={`kind k-${r.source_kind}`}>{r.source_kind}</span>}</td>
                    <td>{r.leads}</td>
                    <td>{r.contacted} <span className="muted small">{pct(r.contacted, r.leads)}%</span></td>
                    <td>{r.met} <span className="muted small">{pct(r.met, r.leads)}%</span></td>
                    <td><b>{r.committed}</b></td>
                    <td className="conv-cell">
                      <span className="conv-bar"><i style={{ width: `${Math.min(100, (c / best) * 100)}%` }} /></span>
                      <b>{c}%</b>{r.leads < 5 && <span className="muted small" title="Fewer than 5 leads"> · small</span>}
                    </td>
                    <td>{r.out_list}</td>
                    <td>{r.still_open}</td>
                  </tr>
                );
              })}
              {rows && rows.length > 0 && (
                <tr className="total-row">
                  <td>Total</td><td>{total.leads}</td><td>{total.contacted}</td><td>{total.met}</td><td>{total.committed}</td>
                  <td><b>{pct(total.committed, total.leads)}%</b></td><td>{total.out_list}</td><td>{total.still_open}</td>
                </tr>
              )}
            </tbody>
          </table>
          {rows?.length === 0 && !err && <Empty>No leads were created in this period.</Empty>}
        </div>
      </div>
      <p className="hint" style={{ marginTop: 10 }}>
        <b>Contacted</b>: anything logged, or moved past Active contact. <b>Met</b>: reached Holding, Deferred or Converting.
        <b> Committed</b>: reached Converting. <b>Conversion</b> = committed ÷ leads; bars compare groups with 5+ leads.
      </p>
    </div>
  );
}
