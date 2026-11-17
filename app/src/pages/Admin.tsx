import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useApp } from '../auth';
import { rpc } from '../lib/supabase';
import { fmtDateTime, initials, timeAgo } from '../lib/format';
import type { Profile } from '../lib/types';
import { Empty, useToast } from '../components/ui';
import Team from './Team';
import { TeamOverview } from './AdminOverview';
import MeetingTypes from './MeetingTypes';
import OnboardingTemplates from './OnboardingTemplates';

export default function Admin() {
  const { team, isAdmin } = useApp();
  const [sp, setSp] = useSearchParams();
  const tab = sp.get('tab') ?? 'overview';
  if (!isAdmin) return <div className="main-inner"><p>Admins only.</p></div>;
  const pending = team.filter((t) => !t.is_active && !t.approved_at && !t.rejected_at);
  const rejected = team.filter((t) => !t.is_active && t.rejected_at);
  return (
    <div className="main-inner">
      <div className="page-head"><div><h1>Admin</h1><p>See how the team is doing, nudge people, approve new sign-ins and manage rotation.</p></div></div>
      <div className="tabs">
        <button className={`tab ${tab === 'overview' ? 'on' : ''}`} onClick={() => setSp({})}>Team overview</button>
        <button className={`tab ${tab === 'requests' ? 'on' : ''}`} onClick={() => setSp({ tab: 'requests' })}>Access requests <span className="tab-n">{pending.length}</span></button>
        <button className={`tab ${tab === 'team' ? 'on' : ''}`} onClick={() => setSp({ tab: 'team' })}>Team &amp; rotation</button>
        <button className={`tab ${tab === 'meetings' ? 'on' : ''}`} onClick={() => setSp({ tab: 'meetings' })}>Meeting types</button>
        <button className={`tab ${tab === 'checklists' ? 'on' : ''}`} onClick={() => setSp({ tab: 'checklists' })}>Onboarding checklists</button>
      </div>
      {tab === 'overview' ? <TeamOverview /> : tab === 'team' ? <Team embedded /> : tab === 'meetings' ? <MeetingTypes /> : tab === 'checklists' ? <OnboardingTemplates /> : (
        <>
          <div className="panel">
            <div className="panel-head"><h2>Waiting for approval</h2><span className="muted small">Anyone with a @flamebackcapital.com Google account can ask; nobody gets in until approved.</span></div>
            {pending.length === 0 && <Empty>No pending requests.</Empty>}
            {pending.map((p) => <RequestRow key={p.id} p={p} />)}
          </div>
          {rejected.length > 0 && (
            <div className="panel" style={{ marginTop: 22 }}>
              <div className="panel-head"><h2>Rejected</h2></div>
              {rejected.map((p) => <RequestRow key={p.id} p={p} rejected />)}
            </div>
          )}
          <p className="hint" style={{ marginTop: 12 }}>Roles for now: <b>RM</b> works their own leads; <b>Admin</b> also approves people and manages the team. Investment, Operations and Compliance roles come later.</p>
        </>
      )}
    </div>
  );
}

function RequestRow({ p, rejected }: { p: Profile; rejected?: boolean }) {
  const { reloadRef } = useApp();
  const toast = useToast();
  const [role, setRole] = useState<'rm' | 'admin'>('rm');
  const [rotation, setRotation] = useState(true);
  const [busy, setBusy] = useState(false);
  async function act(fn: string, args: Record<string, unknown>, msg: string) {
    setBusy(true);
    try { await rpc(fn, { p_user: p.id, ...args }); toast(msg); await reloadRef(); }
    catch (e) { toast((e as Error).message, 'err'); } finally { setBusy(false); }
  }
  return (
    <div className="request-row">
      <div className="person">
        {p.avatar_url ? <img src={p.avatar_url} alt="" referrerPolicy="no-referrer" /> : <span className="av">{initials(p.full_name)}</span>}
        <div><b>{p.full_name}</b><div className="lead-sub">{p.email} · asked {timeAgo(p.created_at)}{rejected && p.rejected_at ? ` · rejected ${fmtDateTime(p.rejected_at)}` : ''}</div></div>
      </div>
      <div className="row-gap">
        <select className="filter" value={role} onChange={(e) => setRole(e.target.value as 'rm' | 'admin')} aria-label="Role">
          <option value="rm">RM</option>
          <option value="admin">Admin</option>
        </select>
        <label className="check"><input type="checkbox" checked={rotation} onChange={(e) => setRotation(e.target.checked)} /> Gets round-robin leads</label>
        <button className="btn sm" disabled={busy} onClick={() => act('approve_user', { p_role: role, p_in_rotation: rotation }, `${p.full_name} approved as ${role === 'admin' ? 'Admin' : 'RM'}`)}>Approve</button>
        {!rejected && <button className="btn ghost sm danger-text" disabled={busy} onClick={() => act('reject_user', {}, `${p.full_name} rejected`)}>Reject</button>}
      </div>
    </div>
  );
}
