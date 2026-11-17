import { useEffect, useState } from 'react';
import { useApp } from '../auth';
import { rpc, supabase } from '../lib/supabase';
import { fmtDateTime, initials } from '../lib/format';
import { TEAMS, type Profile, type Team as TeamName } from '../lib/types';
import { Field, Modal, useToast } from '../components/ui';

export default function Team({ embedded }: { embedded?: boolean } = {}) {
  const { team: everyone, me, reloadRef, isAdmin } = useApp();
  // approved people only (requests live on the Admin page)
  const team = everyone.filter((t) => t.is_active || (t.approved_at && !t.rejected_at));
  const toast = useToast();
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [removing, setRemoving] = useState<Profile | null>(null);

  useEffect(() => {
    Promise.all(team.map(async (t) => {
      const { count } = await supabase.from('leads').select('id', { count: 'exact', head: true })
        .eq('rm_id', t.id).in('bucket', ['active_contact', 'awaiting_meeting', 'holding', 'deferred']);
      return [t.id, count ?? 0] as const;
    })).then((p) => setCounts(Object.fromEntries(p)));
  }, [team]);

  if (!isAdmin) return <div className="main-inner"><p>Admins only.</p></div>;

  async function update(p: Profile, patch: Partial<Profile>, msg: string) {
    if (p.id === me!.id && (patch.role === 'rm' || patch.is_active === false)) {
      if (!confirm('This removes your own admin access. Continue?')) return;
    }
    const { error } = await supabase.from('profiles').update(patch).eq('id', p.id);
    if (error) toast(error.message, 'err'); else { toast(msg); reloadRef(); }
  }

  const inRotation = team.filter((t) => t.is_active && t.in_rotation && t.team === 'Sales');
  const next = [...inRotation].sort((a, b) => (a.last_assigned_at ?? '').localeCompare(b.last_assigned_at ?? ''))[0];

  return (
    <div className={embedded ? '' : 'main-inner'}>
      {!embedded && <div className="page-head"><div><h1>Team &amp; rotation</h1></div></div>}
      <p className="muted small" style={{ marginBottom: 12 }}>Set each person's team so tasks reach the right people. New leads go round-robin to Sales people in rotation.</p>
      <div className="banner">
        {inRotation.length === 0
          ? <>Nobody is in rotation, so new leads stay with whoever adds them.</>
          : <>{inRotation.length} in rotation. Next lead goes to <b>{next?.full_name}</b>.</>}
      </div>
      <div className="panel">
        <div className="table-wrap">
          <table>
            <thead><tr><th>Person</th><th>Team</th><th>Role</th><th>Open leads</th><th>Cal.com</th><th>In rotation</th><th>Last lead assigned</th><th>Access</th></tr></thead>
            <tbody>
              {team.map((t) => (
                <tr key={t.id} className={t.is_active ? '' : 'inactive'}>
                  <td><div className="person">
                    {t.avatar_url ? <img src={t.avatar_url} alt="" referrerPolicy="no-referrer" /> : <span className="av">{initials(t.full_name)}</span>}
                    <div><b>{t.full_name}</b>{t.id === me!.id && <span className="muted small"> (you)</span>}<div className="lead-sub">{t.email}</div></div>
                  </div></td>
                  <td>
                    <select className="filter" value={t.team} onChange={(e) => update(t, { team: e.target.value as TeamName }, `${t.full_name} moved to ${e.target.value}`)}>
                      {TEAMS.map((x) => <option key={x}>{x}</option>)}
                    </select>
                  </td>
                  <td>
                    <select className="filter" value={t.role} onChange={(e) => update(t, { role: e.target.value as Profile['role'] }, 'Role updated')}>
                      <option value="rm">RM</option><option value="admin">Admin</option>
                    </select>
                  </td>
                  <td>{counts[t.id] ?? '·'}</td>
                  <td>{t.cal_connected_at ? (t.cal_url ? <a href={t.cal_url} target="_blank" rel="noreferrer" className="small">Connected</a> : <span className="small">Connected</span>) : <span className="muted small">Not connected</span>}</td>
                  <td>
                    <label className="toggle">
                      <input type="checkbox" checked={t.in_rotation} disabled={!t.is_active}
                        onChange={(e) => update(t, { in_rotation: e.target.checked }, e.target.checked ? `${t.full_name} added to rotation` : `${t.full_name} removed from rotation`)} />
                      <span />
                    </label>
                  </td>
                  <td className="small">{t.last_assigned_at ? fmtDateTime(t.last_assigned_at) : <span className="muted">Never</span>}</td>
                  <td>
                    <button className={`btn sm ${t.is_active ? 'ghost' : ''}`}
                      disabled={t.id === me!.id && t.is_active} title={t.id === me!.id && t.is_active ? 'You can’t remove your own access' : undefined}
                      onClick={() => t.is_active ? setRemoving(t) : update(t, { is_active: true }, 'Access restored')}>
                      {t.is_active ? 'Remove access' : 'Restore access'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <p className="hint" style={{ marginTop: 12 }}>Removing access hands the person's leads over: round-robin to the RMs in rotation, or all to one person. Admins see every RM's leads and can assign a lead to anyone.</p>
      {removing && <RemoveAccessModal person={removing} people={team.filter((t) => t.is_active && t.id !== removing.id)}
        onClose={() => setRemoving(null)} onDone={() => { setRemoving(null); reloadRef(); }} />}
    </div>
  );
}

function RemoveAccessModal({ person, people, onClose, onDone }: { person: Profile; people: Profile[]; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [total, setTotal] = useState<number | null>(null);
  const [mode, setMode] = useState<'rotation' | 'person'>('rotation');
  const [to, setTo] = useState('');
  const [busy, setBusy] = useState(false);
  const rotation = people.filter((p) => p.in_rotation && p.team === 'Sales');

  useEffect(() => {
    supabase.from('leads').select('id', { count: 'exact', head: true }).eq('rm_id', person.id)
      .then(({ count }) => setTotal(count ?? 0));
  }, [person.id]);
  useEffect(() => { if (total !== null && total > 0 && rotation.length === 0) setMode('person'); }, [total, rotation.length]);

  const first = person.full_name?.split(' ')[0] ?? 'them';
  const ok = total === 0 || (mode === 'rotation' ? rotation.length > 0 : !!to);

  async function go() {
    setBusy(true);
    try {
      const r = await rpc<{ moved: number }>('remove_access', { p_user: person.id, p_mode: total ? mode : 'rotation', p_to: mode === 'person' ? to : null });
      toast(r.moved ? `Access removed · ${r.moved} lead${r.moved === 1 ? '' : 's'} handed over` : 'Access removed');
      onDone();
    } catch (e) { toast((e as Error).message, 'err'); } finally { setBusy(false); }
  }

  return (
    <Modal title={`Remove access · ${person.full_name}`} onClose={onClose}
      footer={<><button className="btn ghost" onClick={onClose}>Cancel</button>
        <button className="btn danger" disabled={busy || total === null || !ok} onClick={go}>{busy ? 'Removing…' : total ? 'Hand over leads and remove access' : 'Remove access'}</button></>}>
      <p style={{ marginBottom: 12 }}>{first} won't be able to sign in and leaves the round-robin. You can restore access later.</p>
      {total === null ? <p className="muted">Counting their leads…</p> : total === 0 ? <p className="muted">{first} has no leads, so there is nothing to hand over.</p> : (
        <>
          <p style={{ marginBottom: 10 }}>{first} has <b>{total}</b> lead{total === 1 ? '' : 's'} (all stages). Who should get them?</p>
          <div className="result-list">
            <button className={mode === 'rotation' ? 'on' : ''} disabled={rotation.length === 0} onClick={() => setMode('rotation')}>
              <b>Share across the RMs in rotation</b>
              <span>{rotation.length ? `Round-robin, like new leads: ${rotation.map((p) => p.full_name?.split(' ')[0]).join(', ')}` : 'Nobody else is in rotation'}</span>
            </button>
            <button className={mode === 'person' ? 'on' : ''} onClick={() => setMode('person')}>
              <b>Give them all to one person</b><span>Pick who takes over</span>
            </button>
          </div>
          {mode === 'person' && (
            <Field label="Hand over to" required>
              <select value={to} onChange={(e) => setTo(e.target.value)}>
                <option value="">Choose a person…</option>
                {people.map((p) => <option key={p.id} value={p.id}>{p.full_name} · {p.team}</option>)}
              </select>
            </Field>
          )}
          <p className="hint" style={{ marginTop: 10 }}>Each lead keeps its stage, notes and history; its timeline shows the hand-over. Everyone who receives leads gets one notification.</p>
        </>
      )}
    </Modal>
  );
}
