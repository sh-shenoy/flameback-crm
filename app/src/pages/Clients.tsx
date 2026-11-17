import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApp } from '../auth';
import { supabase } from '../lib/supabase';
import { fmtDate } from '../lib/format';
import { RESIDENCY_LABEL, type Lead } from '../lib/types';
import { Empty, ProductTag, Skeleton } from '../components/ui';
import { fmtINR } from '../components/OnboardingCard';

/** Funded clients. Holdings, returns and reviews come later. */
export default function Clients() {
  const { me, isAdmin, teamName } = useApp();
  const nav = useNavigate();
  const [rows, setRows] = useState<Lead[] | null>(null);
  const [mine, setMine] = useState(!isAdmin);

  useEffect(() => {
    let q = supabase.from('leads').select('*').eq('bucket', 'client').order('funded_at', { ascending: false });
    if (mine) q = q.eq('rm_id', me!.id);
    q.then(({ data }) => setRows((data as Lead[]) ?? []));
  }, [mine, me]);

  const total = (rows ?? []).reduce((s, r) => s + (r.funded_amount ?? 0), 0);
  return (
    <div className="main-inner">
      <div className="page-head">
        <div><h1>Clients</h1><p>Funded clients. Holdings, returns and reviews are coming later.</p></div>
        {isAdmin && <div className="seg"><button className={mine ? '' : 'on'} onClick={() => setMine(false)}>Everyone</button><button className={mine ? 'on' : ''} onClick={() => setMine(true)}>Mine</button></div>}
      </div>
      {rows && rows.length > 0 && (
        <div className="cards" style={{ marginBottom: 14 }}>
          <div className="card"><div className="k">Clients</div><div className="v">{rows.length}</div></div>
          <div className="card"><div className="k">Funded (recorded)</div><div className="v">{fmtINR(total)}</div></div>
        </div>
      )}
      <div className="panel">
        <div className="table-wrap">
          <table>
            <thead><tr><th>Client</th><th>Product</th><th>Funded on</th><th>Amount</th><th>Source</th>{isAdmin && !mine && <th>RM</th>}</tr></thead>
            <tbody>
              {rows === null && [0, 1].map((i) => <tr key={i}><td colSpan={6}><Skeleton /></td></tr>)}
              {rows?.map((r) => (
                <tr key={r.id} className="lead-row" onClick={() => nav(`/leads/${r.id}`)}>
                  <td><div className="lead-name">{r.name}</div><div className="lead-sub">{r.city ?? ''}</div></td>
                  <td><ProductTag product={r.product} /> <span className="muted small">{r.residency ? RESIDENCY_LABEL[r.residency] : ''}</span></td>
                  <td>{fmtDate(r.funded_at ?? null)}</td>
                  <td>{r.funded_amount != null ? fmtINR(r.funded_amount) : <span className="muted">—</span>}</td>
                  <td className="small">{r.source}{r.referred_by ? ` · ${r.referred_by}` : ''}</td>
                  {isAdmin && !mine && <td className="small">{teamName(r.rm_id)}</td>}
                </tr>
              ))}
            </tbody>
          </table>
          {rows?.length === 0 && <Empty>No clients yet. A prospect becomes a client when you Mark as funded on their onboarding checklist.</Empty>}
        </div>
      </div>
    </div>
  );
}
