import { useEffect, useState } from 'react';
import { useApp } from '../auth';
import { supabase } from '../lib/supabase';
import { fmtDateTime, initials } from '../lib/format';
import type { Profile } from '../lib/types';
import { useToast } from '../components/ui';

export default function Team() {
  const { team, me, reloadRef, isAdmin } = useApp();
  const toast = useToast();
  const [counts, setCounts] = useState<Record<string, number>>({});

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

  const inRotation = team.filter((t) => t.is_active && t.in_rotation);
  const next = [...inRotation].sort((a, b) => (a.last_assigned_at ?? '').localeCompare(b.last_assigned_at ?? ''))[0];

  return (
    <div className="main-inner">
      <div className="page-head">
        <div><h1>Team & rotation</h1>
          <p>Everyone who signs in with a @flamebackcapital.com Google account appears here as an RM. New leads go round-robin to the people in rotation.</p></div>
      </div>
      <div className="banner">
        {inRotation.length === 0
          ? <>Nobody is in rotation, so new leads stay with whoever adds them.</>
          : <>{inRotation.length} in rotation. Next lead goes to <b>{next?.full_name}</b>.</>}
      </div>
      <div className="panel">
        <div className="table-wrap">
          <table>
            <thead><tr><th>Person</th><th>Role</th><th>Open leads</th><th>In rotation</th><th>Last lead assigned</th><th>Access</th></tr></thead>
            <tbody>
              {team.map((t) => (
                <tr key={t.id} className={t.is_active ? '' : 'inactive'}>
                  <td><div className="person">
                    {t.avatar_url ? <img src={t.avatar_url} alt="" referrerPolicy="no-referrer" /> : <span className="av">{initials(t.full_name)}</span>}
                    <div><b>{t.full_name}</b>{t.id === me!.id && <span className="muted small"> (you)</span>}<div className="lead-sub">{t.email}</div></div>
                  </div></td>
                  <td>
                    <select className="filter" value={t.role} onChange={(e) => update(t, { role: e.target.value as Profile['role'] }, 'Role updated')}>
                      <option value="rm">RM</option><option value="admin">Admin</option>
                    </select>
                  </td>
                  <td>{counts[t.id] ?? '·'}</td>
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
                      onClick={() => update(t, { is_active: !t.is_active, in_rotation: t.is_active ? false : t.in_rotation }, t.is_active ? 'Access removed' : 'Access restored')}>
                      {t.is_active ? 'Remove access' : 'Restore access'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <p className="hint" style={{ marginTop: 12 }}>Removing access keeps the person's leads; reassign them from each lead page. Admins see every RM's leads and can assign a lead to anyone.</p>
    </div>
  );
}
