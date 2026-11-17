import { useEffect, useMemo, useState } from 'react';
import Papa from 'papaparse';
import { useApp } from '../auth';
import { supabase } from '../lib/supabase';
import { addDays, fmtDate, todayIST } from '../lib/format';
import { Empty, Skeleton } from '../components/ui';
import { fmtINR } from '../components/OnboardingCard';

type Group = 'source' | 'campaign' | 'referrer' | 'product' | 'rm';
interface Row { grp: string; source_kind: string | null; leads: number; contacted: number; interested: number; met: number; committed: number; clients: number; funded_amount: number; out_list: number; still_open: number }
type Counts = Omit<Row, 'grp' | 'source_kind'>;

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
/** Percentage for display: one decimal below 1% so 3 of 1,337 reads 0.2%, not 0%. */
const fmtPct = (n: number, d: number) => {
  if (!d || !n) return '0%';
  const v = (n / d) * 100;
  return v < 0.1 ? '<0.1%' : v < 1 ? `${v.toFixed(1)}%` : `${Math.round(v)}%`;
};

export default function Reports() {
  const { isAdmin, team, me } = useApp();
  const [group, setGroup] = useState<Group>('source');
  const [period, setPeriod] = useState('90');
  const [custom, setCustom] = useState<[string, string]>([addDays(todayIST(), -29), todayIST()]);
  const [rm, setRm] = useState(isAdmin ? '' : me!.id);
  const [rows, setRows] = useState<Row[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [sort, setSort] = useState<keyof Row>('committed');
  const [sel, setSel] = useState<string | null>(null);   // row whose funnel is shown; null = everything

  const [from, to] = period === 'custom' ? custom : PERIODS.find((p) => p.key === period)!.range();

  useEffect(() => {
    setRows(null); setErr(null); setSel(null);
    supabase.rpc('report_conversion', { p_from: from, p_to: to, p_group: group, p_rm: rm || null })
      .then(({ data, error }) => {
        if (error) { setErr(error.message); setRows([]); return; }
        setRows(((data as Row[]) ?? []).map((r) => ({ ...r, leads: +r.leads, contacted: +r.contacted, interested: +r.interested, met: +r.met, committed: +r.committed, clients: +r.clients, funded_amount: +r.funded_amount, out_list: +r.out_list, still_open: +r.still_open })));
      });
  }, [group, from, to, rm]);

  const sorted = useMemo(() => [...(rows ?? [])].sort((a, b) =>
    sort === 'grp' ? a.grp.localeCompare(b.grp) : (b[sort] as number) - (a[sort] as number) || b.leads - a.leads), [rows, sort]);
  const total: Counts = (rows ?? []).reduce((t, r) => ({
    leads: t.leads + r.leads, contacted: t.contacted + r.contacted, interested: t.interested + r.interested, met: t.met + r.met,
    committed: t.committed + r.committed, clients: t.clients + r.clients, funded_amount: t.funded_amount + r.funded_amount,
    out_list: t.out_list + r.out_list, still_open: t.still_open + r.still_open,
  }), { leads: 0, contacted: 0, interested: 0, met: 0, committed: 0, clients: 0, funded_amount: 0, out_list: 0, still_open: 0 });
  const selRow = sel ? rows?.find((r) => r.grp === sel) ?? null : null;
  const best = Math.max(1, ...(rows ?? []).filter((r) => r.leads >= 5).map((r) => pct(r.committed, r.leads)));
  const groupLabel = GROUPS.find((g) => g.key === group)!.label;

  function exportCsv() {
    const csv = Papa.unparse([
      [groupLabel, ...(group === 'source' ? ['Type'] : []), 'Leads', 'Contacted', 'Wants to meet', 'Met', 'Prospect', 'Client', 'Funded (₹)', 'Prospect %', 'Out List', 'Still open'],
      ...sorted.map((r) => [r.grp, ...(group === 'source' ? [r.source_kind ?? ''] : []), r.leads, r.contacted, r.interested, r.met, r.committed, r.clients, r.funded_amount, pct(r.committed, r.leads), r.out_list, r.still_open]),
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
        <div className="card"><div className="k">Contacted</div><div className="v">{rows ? `${fmtPct(total.contacted, total.leads)}` : '·'}</div><div className="meta">{total.contacted} lead{total.contacted === 1 ? '' : 's'}</div></div>
        <div className="card"><div className="k">Met</div><div className="v">{rows ? `${fmtPct(total.met, total.leads)}` : '·'}</div><div className="meta">{total.met} lead{total.met === 1 ? '' : 's'}</div></div>
        <div className="card"><div className="k">Became prospect</div><div className="v">{rows ? `${fmtPct(total.committed, total.leads)}` : '·'}</div><div className="meta">{total.committed} lead{total.committed === 1 ? '' : 's'}</div></div>
      </div>

      {err && <div className="banner warn">Couldn't load the report: {err}</div>}
      {rows && rows.length > 0 && (
        <div className="panel funnel-panel">
          <div className="panel-head">
            <h2>Funnel · {selRow ? selRow.grp : `all ${groupLabel === 'RM' ? 'RMs' : groupLabel.toLowerCase() + (groupLabel.endsWith('s') ? 'es' : 's')}`}</h2>
            {selRow ? <button className="linkbtn small" onClick={() => setSel(null)}>Show all</button>
              : <span className="muted small">Click a row below to see its funnel</span>}
          </div>
          <Funnel c={selRow ?? total} compare={selRow ? total : null} />
        </div>
      )}
      <div className="panel">
        <div className="panel-head"><h2>Conversion by {groupLabel.toLowerCase()}</h2><span className="muted small">Click a column to sort</span></div>
        <div className="table-wrap">
          <table className="report">
            <thead><tr>
              <Th k="grp">{groupLabel}</Th>
              <Th k="leads">Leads</Th><Th k="contacted">Contacted</Th><Th k="interested">Wants to meet</Th><Th k="met">Met</Th><Th k="committed">Prospect</Th><Th k="clients">Client</Th>
              <th>Became prospect</th><Th k="out_list">Out List</Th><Th k="still_open">Still open</Th>
            </tr></thead>
            <tbody>
              {rows === null && [0, 1, 2].map((i) => <tr key={i}><td colSpan={10}><Skeleton /></td></tr>)}
              {sorted.map((r) => {
                const c = pct(r.committed, r.leads);
                return (
                  <tr key={r.grp} className={`clickable ${sel === r.grp ? 'selected' : ''}`} onClick={() => setSel(sel === r.grp ? null : r.grp)}
                    title="Show this funnel">
                    <td><b>{r.grp}</b>{r.source_kind && <span className={`kind k-${r.source_kind}`}>{r.source_kind}</span>}</td>
                    <td>{r.leads}</td>
                    <td>{r.contacted} <span className="muted small">{fmtPct(r.contacted, r.leads)}</span></td>
                    <td>{r.interested} <span className="muted small">{fmtPct(r.interested, r.leads)}</span></td>
                    <td>{r.met} <span className="muted small">{fmtPct(r.met, r.leads)}</span></td>
                    <td><b>{r.committed}</b></td>
                    <td>{r.clients ? <b>{r.clients}</b> : 0}</td>
                    <td className="conv-cell">
                      <span className="conv-bar"><i style={{ width: `${Math.min(100, (c / best) * 100)}%` }} /></span>
                      <b>{fmtPct(r.committed, r.leads)}</b>{r.leads < 5 && <span className="muted small" title="Fewer than 5 leads"> · small</span>}
                    </td>
                    <td>{r.out_list}</td>
                    <td>{r.still_open}</td>
                  </tr>
                );
              })}
              {rows && rows.length > 0 && (
                <tr className="total-row">
                  <td>Total</td><td>{total.leads}</td><td>{total.contacted}</td><td>{total.interested}</td><td>{total.met}</td><td>{total.committed}</td><td>{total.clients}</td>
                  <td><b>{fmtPct(total.committed, total.leads)}</b></td><td>{total.out_list}</td><td>{total.still_open}</td>
                </tr>
              )}
            </tbody>
          </table>
          {rows?.length === 0 && !err && <Empty>No leads were created in this period.</Empty>}
        </div>
      </div>
      <p className="hint" style={{ marginTop: 10 }}>
        <b>Contacted</b>: anything logged, or moved past Active contact. <b>Wants to meet</b>: reached Awaiting meeting or further. <b>Met</b>: reached Holding, Deferred or Converting.
        <b> Prospect</b>: agreed to join. <b>Client</b>: funded. <b>Became prospect</b> = prospects ÷ leads; bars compare groups with 5+ leads.
      </p>
    </div>
  );
}

const STAGES: { key: keyof Counts; label: string }[] = [
  { key: 'leads', label: 'Leads' },
  { key: 'contacted', label: 'Contacted' },
  { key: 'interested', label: 'Wants to meet' },
  { key: 'met', label: 'Met' },
  { key: 'committed', label: 'Prospect' },
  { key: 'clients', label: 'Client' },
];

/**
 * Leads → Contacted → Wants to meet → Met → Prospect → Client. Each bar sits on a track that stands for all
 * leads, so every bar is a share of the same whole. Between stages: how many of the previous stage
 * moved on, in counts (percentages of a tiny base mislead). Stages are cumulative: a lead that
 * became a client also counts as contacted, wanted to meet, met and prospect.
 */
function Funnel({ c, compare }: { c: Counts; compare: Counts | null }) {
  const fmt = (n: number) => n.toLocaleString('en-IN');
  return (
    <div className="pad">
      <div className="funnel" role="table" aria-label="Lead funnel">
        {STAGES.map((st, i) => {
          const n = c[st.key];
          const share = c.leads ? (n / c.leads) * 100 : 0;
          const prevKey = i > 0 ? STAGES[i - 1].key : null;
          const prev = prevKey ? c[prevKey] : null;
          const overall = compare && i > 0 && compare.leads ? (compare[st.key] / compare.leads) * 100 : null;
          return (
            <div key={st.key} className="fn-block" role="row">
              {prev !== null && (
                <div className="fn-step" role="presentation">
                  <span>{prev ? <>↓ {fmt(n)} of {fmt(prev)} moved on <b>({fmtPct(n, prev)})</b></> : '↓ nobody reached the previous stage'}</span>
                </div>
              )}
              <div className="fn-row">
                <div className="fn-label" role="rowheader">{st.label}</div>
                <div className="fn-track" title={`${st.label}: ${fmt(n)} of ${fmt(c.leads)} leads (${fmtPct(n, c.leads)})`}>
                  {n > 0 && <div className="fn-bar" style={{ width: `${share}%` }} />}
                  {overall !== null && <i className="fn-mark" style={{ left: `${overall}%` }} title={`All leads in this report: ${fmtPct(compare![st.key], compare!.leads)}`} />}
                </div>
                <div className="fn-num" role="cell">
                  <b>{fmt(n)}</b><span>{fmtPct(n, c.leads)} of leads</span>
                </div>
              </div>
            </div>
          );
        })}
      </div>
      <div className="fn-foot">
        {c.funded_amount > 0 && <span><b>{fmtINR(c.funded_amount)}</b> funded</span>}
        <span><b>{c.out_list.toLocaleString('en-IN')}</b> on the Out List</span>
        <span><b>{c.still_open.toLocaleString('en-IN')}</b> still open</span>
        {compare && <span className="fn-key"><i className="fn-mark-key" /> all leads in this report</span>}
        {c.leads > 0 && c.leads < 5 && <span className="muted">Fewer than 5 leads, so percentages are rough</span>}
      </div>
    </div>
  );
}
