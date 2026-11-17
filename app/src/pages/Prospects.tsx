import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApp } from '../auth';
import { supabase } from '../lib/supabase';
import { fmtDate, todayIST } from '../lib/format';
import { RESIDENCY_LABEL, type ItemStatus, type Lead } from '../lib/types';
import { Empty, ProductTag, Skeleton } from '../components/ui';

type Row = Lead & { onboarding_items: { status: ItemStatus; owner: 'rm' | 'ops'; due_date: string | null }[]; lead_holders: { name: string }[] };

const days = (iso: string | null) => (iso ? Math.max(0, Math.floor((Date.now() - Date.parse(iso)) / 86400e3)) : 0);

/** Everyone who agreed to join and is being onboarded, with how far along they are. */
export default function Prospects() {
  const { me, isAdmin, teamName } = useApp();
  const nav = useNavigate();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [mine, setMine] = useState(!isAdmin);

  useEffect(() => {
    let q = supabase.from('leads').select('*, onboarding_items(status, owner, due_date), lead_holders(name)')
      .eq('bucket', 'converting').order('converted_at', { ascending: true });
    if (mine) q = q.eq('rm_id', me!.id);
    q.then(({ data }) => setRows((data as Row[]) ?? []));
  }, [mine, me]);

  const today = todayIST();
  return (
    <div className="main-inner">
      <div className="page-head">
        <div><h1>Prospects</h1><p>Agreed to join and being onboarded. They become clients when they fund.</p></div>
        {isAdmin && <div className="seg"><button className={mine ? '' : 'on'} onClick={() => setMine(false)}>Everyone</button><button className={mine ? 'on' : ''} onClick={() => setMine(true)}>Mine</button></div>}
      </div>
      <div className="panel">
        <div className="table-wrap">
          <table>
            <thead><tr><th>Prospect</th><th>Product</th><th>Progress</th><th>Waiting on</th><th>Next due</th><th>Onboarding for</th>{isAdmin && !mine && <th>RM</th>}</tr></thead>
            <tbody>
              {rows === null && [0, 1, 2].map((i) => <tr key={i}><td colSpan={7}><Skeleton /></td></tr>)}
              {rows?.map((r) => {
                const it = r.onboarding_items ?? [];
                const done = it.filter((i) => i.status === 'done').length;
                const open = it.filter((i) => i.status !== 'done');
                const client = open.filter((i) => i.status === 'waiting').length;
                const ops = open.filter((i) => i.owner === 'ops').length;
                const blocked = open.filter((i) => i.status === 'blocked').length;
                const nextDue = open.map((i) => i.due_date).filter(Boolean).sort()[0] as string | undefined;
                const d = days(r.converted_at);
                return (
                  <tr key={r.id} className="lead-row" onClick={() => nav(`/leads/${r.id}`)}>
                    <td><div className="lead-name">{r.name}</div>
                      <div className="lead-sub">{r.lead_holders?.length ? `with ${r.lead_holders.map((h) => h.name).join(', ')}` : r.source}</div></td>
                    <td><ProductTag product={r.product} /> <span className="muted small">{r.residency ? RESIDENCY_LABEL[r.residency] : ''}</span></td>
                    <td>{it.length ? <span className="ob-inline"><span className="ob-progress"><i style={{ width: `${(done / it.length) * 100}%` }} /></span> <span className="small">{done}/{it.length}</span></span>
                      : <span className="muted small">No checklist</span>}</td>
                    <td className="small">{blocked > 0 && <span className="red">{blocked} blocked </span>}
                      {[client && `${client} client`, ops && `${ops} Ops`].filter(Boolean).join(' · ') || (open.length ? `${open.length} with RM` : <span className="muted">—</span>)}</td>
                    <td className="small">{nextDue ? <span className={nextDue < today ? 'red' : ''}>{fmtDate(nextDue)}</span> : <span className="muted">—</span>}</td>
                    <td className="small"><span className={d > 30 ? 'amber' : ''}>{d} day{d === 1 ? '' : 's'}</span></td>
                    {isAdmin && !mine && <td className="small">{teamName(r.rm_id)}</td>}
                  </tr>
                );
              })}
            </tbody>
          </table>
          {rows?.length === 0 && <Empty>No prospects right now. When a lead agrees to join, log it as Agreed to join and they appear here.</Empty>}
        </div>
      </div>
    </div>
  );
}
