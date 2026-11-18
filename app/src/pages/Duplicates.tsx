import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useApp } from '../auth';
import { rpc, supabase } from '../lib/supabase';
import { fmtPhone, timeAgo } from '../lib/format';
import type { Lead } from '../lib/types';
import { Empty, Skeleton, StagePill, useToast } from '../components/ui';

interface Conflict {
  id: string; lead_id: string; batch_id: string | null; owner_id: string | null; claimant_id: string | null; created_at: string;
  row_data: { name?: string; phone?: string; email?: string; source?: string; campaign?: string; product?: string; file?: string } | null;
  leads: (Lead & { lead_entries: { count: number }[] }) | null;
}

/** Admin: leads someone uploaded that another RM already has. Decide who keeps each one. */
export default function Duplicates() {
  const { teamName, me, team } = useApp();
  const toast = useToast();
  const [rows, setRows] = useState<Conflict[] | null>(null);
  const [mine, setMine] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const managed = new Set(team.filter((t) => t.manager_id === me?.id).map((t) => t.id));

  const load = useCallback(async () => {
    const { data } = await supabase.from('lead_conflicts').select('*, leads(*, lead_entries(count))').eq('status', 'open').order('created_at');
    setRows((data as Conflict[]) ?? []);
  }, []);
  useEffect(() => { load(); }, [load]);

  async function decide(c: Conflict, to: string) {
    setBusy(c.id);
    try {
      await rpc('resolve_conflict', { p_conflict: c.id, p_give_to: to });
      toast(to === c.leads?.rm_id ? `Kept with ${teamName(to)}` : `Given to ${teamName(to)}`);
      await load();
    } catch (e) { toast((e as Error).message, 'err'); } finally { setBusy(null); }
  }

  const shown = (rows ?? []).filter((c) => !mine || managed.size === 0 || managed.has(c.claimant_id ?? '') || managed.has(c.owner_id ?? ''));
  return (
    <div>
      <div className="row-gap" style={{ justifyContent: 'space-between', marginBottom: 12 }}>
        <p className="muted small" style={{ margin: 0 }}>Someone uploaded a person who is already another RM's lead. Decide who keeps each one; both RMs are told.</p>
        {managed.size > 0 && <div className="seg"><button className={mine ? 'on' : ''} onClick={() => setMine(true)}>My team</button><button className={mine ? '' : 'on'} onClick={() => setMine(false)}>All</button></div>}
      </div>
      <div className="panel">
        {rows === null ? <div className="pad"><Skeleton h={80} /></div> : shown.length === 0 ? <Empty>No duplicates waiting. Nice.</Empty> : (
          <div className="table-wrap">
            <table>
              <thead><tr><th>Lead</th><th>Held by</th><th>Uploaded by</th><th>From the upload</th><th>Decide</th></tr></thead>
              <tbody>
                {shown.map((c) => {
                  const l = c.leads;
                  const n = l?.lead_entries?.[0]?.count ?? 0;
                  const holder = l?.rm_id ?? c.owner_id;
                  return (
                    <tr key={c.id}>
                      <td>{l ? <Link to={`/leads/${l.id}`}><b>{l.name}</b></Link> : <b>{c.row_data?.name}</b>}
                        <div className="lead-sub">{fmtPhone(l?.phone ?? null) || l?.email}</div></td>
                      <td><b>{teamName(holder)}</b>
                        <div className="lead-sub">{l && <StagePill lead={l} />} · {n} interaction{n === 1 ? '' : 's'}{l?.last_contact_at ? ` · last contact ${timeAgo(l.last_contact_at)}` : ''}</div></td>
                      <td><b>{teamName(c.claimant_id)}</b><div className="lead-sub">{timeAgo(c.created_at)}</div></td>
                      <td className="small">{c.row_data?.file}<div className="lead-sub">{[c.row_data?.source, c.row_data?.campaign, c.row_data?.name !== l?.name ? `as "${c.row_data?.name}"` : null].filter(Boolean).join(' · ')}</div></td>
                      <td>
                        <div className="row-gap">
                          <button className="btn ghost sm" disabled={busy === c.id || !holder} onClick={() => decide(c, holder!)}>Keep with {teamName(holder).split(' ')[0]}</button>
                          {c.claimant_id && c.claimant_id !== holder && <button className="btn sm" disabled={busy === c.id} onClick={() => decide(c, c.claimant_id!)}>Give to {teamName(c.claimant_id).split(' ')[0]}</button>}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
