import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApp } from '../auth';
import { RmScopeSelect, scoped, useRmScope } from '../components/RmScope';
import { rpc, supabase } from '../lib/supabase';
import { fmtDate, fmtPhone } from '../lib/format';
import { bucketLabel, type Lead } from '../lib/types';
import { Empty, ProductTag, Skeleton, useToast } from '../components/ui';
import { BringBackDialog } from './LeadPage';

type Row = Lead & { lead_entries: { count: number; }[] };

export default function OutList() {
  const { me, sources, isAdmin, team, teamName } = useApp();
  const sc = useRmScope();
  const scopeKey = sc.ids === null ? 'all' : sc.ids.join(',');
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [giveTo, setGiveTo] = useState('');
  const toast = useToast();
  const nav = useNavigate();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [reason, setReason] = useState('');
  const [source, setSource] = useState('');
  const [back, setBack] = useState<Lead | null>(null);
  const [lastContact, setLastContact] = useState<Record<string, string>>({});

  async function load() {
    let q = scoped(supabase.from('leads').select('*, lead_entries(count)'), isAdmin ? sc.ids : [me!.id]).eq('bucket', 'out').order('out_at', { ascending: false }).limit(500);
    if (reason) q = q.eq('out_reason', reason);
    if (source) q = q.eq('source', source);
    const { data } = await q;
    const list = (data as Row[]) ?? [];
    setRows(list);
    if (list.length) {
      const { data: e } = await supabase.from('lead_entries').select('lead_id, occurred_at')
        .in('lead_id', list.map((l) => l.id)).order('occurred_at', { ascending: false });
      const m: Record<string, string> = {};
      for (const x of (e ?? []) as { lead_id: string; occurred_at: string }[]) if (!m[x.lead_id]) m[x.lead_id] = x.occurred_at;
      setLastContact(m);
    }
  }
  useEffect(() => { setSel(new Set()); load(); }, [reason, source, scopeKey]);   // eslint-disable-line react-hooks/exhaustive-deps

  async function secondChance() {
    try {
      const n = await rpc<number>('reassign_leads', { p_leads: [...sel], p_rm: giveTo });
      toast(`${n} lead${n === 1 ? '' : 's'} given to ${teamName(giveTo)} for a second try. They bring them back from their Out List.`);
      setSel(new Set()); setGiveTo(''); load();
    } catch (e) { toast((e as Error).message, 'err'); }
  }

  const act = async (fn: string, args: Record<string, unknown>, msg: string) => {
    try { await rpc(fn, { p_lead: back!.id, ...args }); toast(msg); setBack(null); load(); }
    catch (e) { toast((e as Error).message, 'err'); }
  };

  return (
    <div className="main-inner">
      <div className="page-head">
        <div><h1>Out List</h1><p>{isAdmin ? 'Leads RMs have given up on. Give them to another RM for a second try.' : 'Leads that reached five strikes or said they\'re not interested. Bring one back any time.'}</p></div>
        <RmScopeSelect s={sc} />
      </div>
      <div className="panel">
        <div className="panel-head">
          <div className="toolbar">
            <select className="filter" value={reason} onChange={(e) => setReason(e.target.value)}>
              <option value="">All reasons</option><option>5 strikes</option><option>Not interested</option>
            </select>
            <select className="filter" value={source} onChange={(e) => setSource(e.target.value)}>
              <option value="">All sources</option>{sources.map((s) => <option key={s.name}>{s.name}</option>)}
            </select>
          </div>
          <span className="muted small">{rows?.length ?? 0} lead{rows?.length === 1 ? '' : 's'}</span>
        </div>
        {isAdmin && sel.size > 0 && (
          <div className="bulk-bar">
            <b>{sel.size} selected</b>
            <button className="linkbtn small" onClick={() => setSel(new Set())}>Clear</button>
            <div className="row-gap" style={{ marginLeft: 'auto' }}>
              <select className="filter" value={giveTo} onChange={(e) => setGiveTo(e.target.value)}>
                <option value="">Give to…</option>
                {team.filter((t) => t.is_active && t.role !== 'admin').map((t) => <option key={t.id} value={t.id}>{t.full_name}</option>)}
              </select>
              <button className="btn sm" disabled={!giveTo} onClick={secondChance}>Give for a second try</button>
            </div>
          </div>
        )}
        <div className="table-wrap">
          <table>
            <thead><tr>{isAdmin && <th className="chk"><input type="checkbox" aria-label="Select all" checked={!!rows?.length && sel.size === rows.length}
                onChange={() => setSel(rows && sel.size !== rows.length ? new Set(rows.map((r) => r.id)) : new Set())} /></th>}<th>Name</th>{isAdmin && <th>RM</th>}<th>Source</th><th>Product</th><th>Interactions</th><th>Reason</th><th>Left from</th><th>Last contact</th><th>Moved</th><th /></tr></thead>
            <tbody>
              {rows === null && [0, 1, 2].map((i) => <tr key={i}><td colSpan={10}><Skeleton /></td></tr>)}
              {rows?.map((l) => (
                <tr key={l.id} className="lead-row" onClick={() => nav(`/leads/${l.id}`)}>
                  {isAdmin && <td className="chk" onClick={(e) => e.stopPropagation()}><input type="checkbox" aria-label={`Select ${l.name}`} checked={sel.has(l.id)}
                    onChange={() => { const n = new Set(sel); n.has(l.id) ? n.delete(l.id) : n.add(l.id); setSel(n); }} /></td>}
                  <td><div className="lead-name">{l.name}</div><div className="lead-sub">{fmtPhone(l.phone) || l.email}</div></td>
                  {isAdmin && <td className="small">{teamName(l.rm_id)}</td>}
                  <td><span className="src">{l.source}</span></td>
                  <td><ProductTag product={l.product} /></td>
                  <td>{l.lead_entries?.[0]?.count ?? 0}</td>
                  <td><span className={`reason ${l.out_reason === 'Not interested' ? 'ni' : ''}`}>{l.out_reason}</span></td>
                  <td className="muted small">{bucketLabel(l.out_from_bucket ?? 'active_contact')}</td>
                  <td>{fmtDate(lastContact[l.id])}</td>
                  <td>{fmtDate(l.out_at)}</td>
                  <td>{!isAdmin && <button className="btn ghost sm" onClick={(e) => { e.stopPropagation(); setBack(l); }}>Bring back</button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {rows?.length === 0 && <Empty>No leads on the Out List.</Empty>}
        </div>
      </div>
      {back && <BringBackDialog lead={back} onClose={() => setBack(null)} act={act} />}
    </div>
  );
}
