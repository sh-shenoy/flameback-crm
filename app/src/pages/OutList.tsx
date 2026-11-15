import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApp } from '../auth';
import { rpc, supabase } from '../lib/supabase';
import { fmtDate, fmtPhone } from '../lib/format';
import { bucketLabel, type Lead } from '../lib/types';
import { Empty, ProductTag, Skeleton, useToast } from '../components/ui';
import { BringBackDialog } from './LeadPage';

type Row = Lead & { lead_entries: { count: number; }[] };

export default function OutList() {
  const { me, sources } = useApp();
  const toast = useToast();
  const nav = useNavigate();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [reason, setReason] = useState('');
  const [source, setSource] = useState('');
  const [back, setBack] = useState<Lead | null>(null);
  const [lastContact, setLastContact] = useState<Record<string, string>>({});

  async function load() {
    let q = supabase.from('leads').select('*, lead_entries(count)').eq('rm_id', me!.id).eq('bucket', 'out').order('out_at', { ascending: false }).limit(500);
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
  useEffect(() => { load(); }, [reason, source]);

  const act = async (fn: string, args: Record<string, unknown>, msg: string) => {
    try { await rpc(fn, { p_lead: back!.id, ...args }); toast(msg); setBack(null); load(); }
    catch (e) { toast((e as Error).message, 'err'); }
  };

  return (
    <div className="main-inner">
      <div className="page-head">
        <div><h1>Out List</h1><p>Leads that reached five strikes or said they're not interested. Bring one back any time.</p></div>
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
        <div className="table-wrap">
          <table>
            <thead><tr><th>Name</th><th>Source</th><th>Product</th><th>Interactions</th><th>Reason</th><th>Left from</th><th>Last contact</th><th>Moved</th><th /></tr></thead>
            <tbody>
              {rows === null && [0, 1, 2].map((i) => <tr key={i}><td colSpan={10}><Skeleton /></td></tr>)}
              {rows?.map((l) => (
                <tr key={l.id} className="lead-row" onClick={() => nav(`/leads/${l.id}`)}>
                  <td><div className="lead-name">{l.name}</div><div className="lead-sub">{fmtPhone(l.phone) || l.email}</div></td>
                  <td><span className="src">{l.source}</span></td>
                  <td><ProductTag product={l.product} /></td>
                  <td>{l.lead_entries?.[0]?.count ?? 0}</td>
                  <td><span className={`reason ${l.out_reason === 'Not interested' ? 'ni' : ''}`}>{l.out_reason}</span></td>
                  <td className="muted small">{bucketLabel(l.out_from_bucket ?? 'active_contact')}</td>
                  <td>{fmtDate(lastContact[l.id])}</td>
                  <td>{fmtDate(l.out_at)}</td>
                  <td><button className="btn ghost sm" onClick={(e) => { e.stopPropagation(); setBack(l); }}>Bring back</button></td>
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
