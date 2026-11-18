import { useEffect, useState } from 'react';
import { useApp } from '../auth';
import { rpc, supabase } from '../lib/supabase';
import { fmtDateTime, initials, timeAgo } from '../lib/format';
import { PRODUCTS, TEAMS, type Profile, type Team as TeamName } from '../lib/types';
import { Field, Modal, useToast } from '../components/ui';
import { LanguagePicker } from '../components/AddLead';

export default function Team({ embedded }: { embedded?: boolean } = {}) {
  const { team: everyone, me, reloadRef, isAdmin } = useApp();
  // approved people only (requests live on the Admin page)
  const team = everyone.filter((t) => t.is_active || (t.approved_at && !t.rejected_at));
  const toast = useToast();
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [removing, setRemoving] = useState<Profile | null>(null);
  const [handing, setHanding] = useState<Profile | null>(null);
  const [routing, setRouting] = useState<Profile | null>(null);
  const admins = everyone.filter((t) => t.role === 'admin' && t.is_active);

  useEffect(() => {
    Promise.all(team.map(async (t) => {
      const { count } = await supabase.from('leads').select('id', { count: 'exact', head: true }).eq('rm_id', t.id)
        .in('bucket', t.role === 'admin' ? ['active_contact', 'awaiting_meeting', 'holding', 'deferred', 'converting', 'client', 'out'] : ['active_contact', 'awaiting_meeting', 'holding', 'deferred']);
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

  const inRotation = team.filter((t) => t.is_active && t.in_rotation && t.team === 'Sales' && t.role !== 'admin' && !t.on_leave);
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
          <table className="team-table">
            <thead><tr><th>Person</th><th>Team</th><th>Role</th><th>Manager</th><th>Open leads</th><th>Routing</th><th>In rotation</th><th>On leave</th><th>Access</th></tr></thead>
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
                  <td>{t.role === 'admin' ? <span className="muted small">—</span> : (
                    <select className="filter" value={t.manager_id ?? ''} onChange={(e) => update(t, { manager_id: e.target.value || null }, e.target.value ? `${t.full_name} now reports to ${admins.find((a) => a.id === e.target.value)?.full_name}` : 'Manager cleared')}>
                      <option value="">No manager</option>
                      {admins.map((a) => <option key={a.id} value={a.id}>{a.full_name}</option>)}
                    </select>)}</td>
                  <td>{t.role === 'admin'
                    ? (counts[t.id] ? <button className="btn ghost sm" onClick={() => setHanding(t)} title="Admins don't own leads">Hand over {counts[t.id]}</button> : <span className="muted small">—</span>)
                    : (counts[t.id] ?? '·')}</td>
                  <td>{t.role === 'admin' ? <span className="muted small">Admins don't get leads</span> : (
                    <button className="linkbtn small routing-sum" onClick={() => setRouting(t)}>{routingSummary(t)}</button>)}</td>
                  <td>
                    <label className="toggle" title={t.role === 'admin' ? 'Admins are never in the round-robin' : undefined}>
                      <input type="checkbox" checked={t.in_rotation && t.role !== 'admin'} disabled={!t.is_active || t.role === 'admin'}
                        onChange={(e) => update(t, { in_rotation: e.target.checked }, e.target.checked ? `${t.full_name} added to rotation` : `${t.full_name} removed from rotation`)} />
                      <span />
                    </label>
                    {t.in_rotation && t.role !== 'admin' && t.last_assigned_at && <div className="muted small nowrap" title={`Last lead ${fmtDateTime(t.last_assigned_at)}`}>last {timeAgo(t.last_assigned_at)}</div>}
                  </td>
                  <td>{t.role === 'admin' ? <span className="muted small">—</span> : (
                    <label className="toggle" title="On leave: no new leads while switched on">
                      <input type="checkbox" checked={!!t.on_leave} disabled={!t.is_active}
                        onChange={(e) => update(t, { on_leave: e.target.checked }, e.target.checked ? `${t.full_name} is on leave: no new leads` : `${t.full_name} is back`)} />
                      <span />
                    </label>)}</td>
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
      <p className="hint" style={{ marginTop: 12 }}>New leads go to the next RM in rotation who fits: not on leave, under their limit, handles the product, takes NRI (if NRI), speaks the language. If nobody fits a rule, it is relaxed. Removing access hands the person's leads over: round-robin to the RMs in rotation, or all to one person. Admins see every RM's leads and can assign a lead to anyone.</p>
      {routing && <RoutingModal person={routing} onClose={() => setRouting(null)} onSave={async (patch) => { await update(routing, patch, `Routing saved for ${routing.full_name}`); setRouting(null); }} />}
      {handing && <RemoveAccessModal keepAccess person={handing} people={team.filter((t) => t.is_active && t.role !== 'admin' && t.id !== handing.id)}
        onClose={() => setHanding(null)} onDone={() => { setHanding(null); reloadRef(); }} />}
      {removing && <RemoveAccessModal person={removing} people={team.filter((t) => t.is_active && t.role !== 'admin' && t.id !== removing.id)}
        onClose={() => setRemoving(null)} onDone={() => { setRemoving(null); reloadRef(); }} />}
    </div>
  );
}

function RemoveAccessModal({ person, people, onClose, onDone, keepAccess }: { person: Profile; people: Profile[]; onClose: () => void; onDone: () => void; keepAccess?: boolean }) {
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
      const r = keepAccess
        ? await rpc<{ moved: number }>('hand_over_leads', { p_user: person.id, p_mode: mode, p_to: mode === 'person' ? to : null })
        : await rpc<{ moved: number }>('remove_access', { p_user: person.id, p_mode: total ? mode : 'rotation', p_to: mode === 'person' ? to : null });
      toast(keepAccess ? `${r.moved} lead${r.moved === 1 ? '' : 's'} handed over` : r.moved ? `Access removed · ${r.moved} lead${r.moved === 1 ? '' : 's'} handed over` : 'Access removed');
      onDone();
    } catch (e) { toast((e as Error).message, 'err'); } finally { setBusy(false); }
  }

  return (
    <Modal title={keepAccess ? `Hand over leads · ${person.full_name}` : `Remove access · ${person.full_name}`} onClose={onClose}
      footer={<><button className="btn ghost" onClick={onClose}>Cancel</button>
        <button className={`btn ${keepAccess ? '' : 'danger'}`} disabled={busy || total === null || !ok || (keepAccess && !total)} onClick={go}>
          {busy ? 'Working…' : keepAccess ? 'Hand over leads' : total ? 'Hand over leads and remove access' : 'Remove access'}</button></>}>
      <p style={{ marginBottom: 12 }}>{keepAccess ? `Admins don't own leads. ${first} keeps their access; only the leads move to RMs.` : `${first} won't be able to sign in and leaves the round-robin. You can restore access later.`}</p>
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

function routingSummary(t: Profile): string {
  const parts = [
    t.route_products?.length ? t.route_products.join(', ') : 'All products',
    t.route_languages?.length ? t.route_languages.join(', ') : null,
    t.takes_nri === false ? 'No NRI' : null,
    t.max_open_leads ? `max ${t.max_open_leads}` : null,
  ].filter(Boolean);
  return parts.join(' · ');
}

function RoutingModal({ person, onClose, onSave }: { person: Profile; onClose: () => void; onSave: (patch: Partial<Profile>) => Promise<void> }) {
  const [langs, setLangs] = useState((person.route_languages ?? []).join(', '));
  const [products, setProducts] = useState<string[]>(person.route_products ?? []);
  const [nri, setNri] = useState(person.takes_nri !== false);
  const [max, setMax] = useState(person.max_open_leads ? String(person.max_open_leads) : '');
  const [busy, setBusy] = useState(false);
  const maxN = max.trim() ? Number(max) : null;
  const bad = maxN !== null && (!Number.isInteger(maxN) || maxN < 1);
  return (
    <Modal title={`Routing · ${person.full_name}`} onClose={onClose}
      footer={<><button className="btn ghost" onClick={onClose}>Cancel</button>
        <button className="btn" disabled={busy || bad} onClick={async () => {
          setBusy(true);
          await onSave({ route_languages: langs.split(',').map((x) => x.trim()).filter(Boolean), route_products: products, takes_nri: nri, max_open_leads: maxN });
          setBusy(false);
        }}>Save</button></>}>
      <p className="muted" style={{ marginBottom: 12 }}>New leads go to the next RM in rotation who fits. Leave things empty to take everything.</p>
      <Field label="Products" hint="None ticked = all products. Someone who lists a product gets it before someone who takes everything.">
        <div className="chips">{PRODUCTS.map((p) => (
          <button key={p} className={`chip ${products.includes(p) ? 'on' : ''}`} onClick={() => setProducts(products.includes(p) ? products.filter((x) => x !== p) : [...products, p])}>{p}</button>
        ))}</div>
      </Field>
      <Field label="Languages they speak" hint="Leads whose language is known go to someone who speaks it.">
        <LanguagePicker value={langs} onChange={setLangs} />
      </Field>
      <div className="grid2">
        <Field label="NRI leads">
          <label className="check"><input type="checkbox" checked={nri} onChange={(e) => setNri(e.target.checked)} /> Takes NRI leads</label>
        </Field>
        <Field label="Maximum open leads" hint={bad ? 'A whole number, 1 or more' : 'Empty = no limit. Full RMs are skipped while others have room.'}>
          <input inputMode="numeric" value={max} onChange={(e) => setMax(e.target.value)} placeholder="No limit" />
        </Field>
      </div>
    </Modal>
  );
}
