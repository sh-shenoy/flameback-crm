import { useEffect, useRef, useState, type ReactNode } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import { useApp } from '../auth';
import { supabase } from '../lib/supabase';
import { initials, fmtPhone, todayIST } from '../lib/format';
import type { Lead } from '../lib/types';
import { BucketPill } from './ui';
import AddLead from './AddLead';

const NAV: { to: string; label: string; ico: string; soon?: boolean; admin?: boolean; badge?: 'overdue' }[] = [
  { to: '/', label: 'Dashboard', ico: '🏠' },
  { to: '/leads', label: 'Leads', ico: '🎯', badge: 'overdue' },
  { to: '/out', label: 'Out List', ico: '📤' },
  { to: '/upload', label: 'Upload leads', ico: '⬆️' },
  { to: '/team', label: 'Team & rotation', ico: '👥', admin: true },
  { to: '/clients', label: 'Clients', ico: '💼', soon: true },
  { to: '/onboarding', label: 'Onboarding', ico: '🧾', soon: true },
  { to: '/reviews', label: 'Reviews', ico: '📋', soon: true },
  { to: '/tasks', label: 'Tasks', ico: '✅', soon: true },
  { to: '/calendar', label: 'Calendar', ico: '📅', soon: true },
  { to: '/notifications', label: 'Notifications', ico: '🔔', soon: true },
];

export default function Shell({ children }: { children: ReactNode }) {
  const { me, isAdmin, signOut } = useApp();
  const [adding, setAdding] = useState(false);
  const [menu, setMenu] = useState(false);
  const [overdue, setOverdue] = useState(0);
  const { pathname } = useLocation();

  useEffect(() => {
    let q = supabase.from('leads').select('id', { count: 'exact', head: true })
      .not('bucket', 'in', '(out,converting)')
      .lt('next_follow_up', todayIST());
    if (isAdmin) q = q.eq('rm_id', me!.id);
    q.then(({ count }) => setOverdue(count ?? 0));
  }, [pathname, isAdmin, me]);

  // open "add lead" from anywhere via a custom event
  useEffect(() => {
    const h = () => setAdding(true);
    window.addEventListener('crm:add-lead', h);
    return () => window.removeEventListener('crm:add-lead', h);
  }, []);

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">
          <NavLink to="/" className="logo"><span className="flame">F</span><span className="lbl">Flameback CRM</span></NavLink>
          <div className="sub lbl">RM · Pre-sales</div>
        </div>
        <nav className="nav">
          {NAV.filter((n) => !n.admin || isAdmin).map((n) =>
            n.soon ? (
              <div key={n.to} className="nav-item soon" title="Coming soon">
                <span className="ico">{n.ico}</span><span className="lbl">{n.label}</span><span className="soon-chip lbl">Soon</span>
              </div>
            ) : (
              <NavLink key={n.to} to={n.to} end={n.to === '/'} className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
                <span className="ico">{n.ico}</span><span className="lbl">{n.label}</span>
                {n.badge === 'overdue' && overdue > 0 && <span className="count red-count lbl">{overdue}</span>}
              </NavLink>
            ),
          )}
        </nav>
        <div className="side-foot lbl">India Quantitative Wealth Management</div>
      </aside>

      <div className="content">
        <header className="topbar">
          <GlobalSearch />
          <div className="top-right">
            <button className="btn" onClick={() => setAdding(true)}>＋ Add lead</button>
            <div className="me" onClick={() => setMenu((m) => !m)}>
              {me?.avatar_url ? <img src={me.avatar_url} alt="" referrerPolicy="no-referrer" /> : <span className="av">{initials(me?.full_name)}</span>}
              <span className="me-name">{me?.full_name}</span>
              {menu && (
                <div className="menu" onMouseLeave={() => setMenu(false)}>
                  <div className="menu-h">{me?.email}<br /><span className="muted small">{isAdmin ? 'Admin' : 'Relationship Manager'}</span></div>
                  <button onClick={signOut}>Log out</button>
                </div>
              )}
            </div>
          </div>
        </header>
        <main className="main">{children}</main>
      </div>
      {adding && <AddLead onClose={() => setAdding(false)} />}
    </div>
  );
}

function GlobalSearch() {
  const [q, setQ] = useState('');
  const [res, setRes] = useState<Lead[]>([]);
  const [open, setOpen] = useState(false);
  const nav = useNavigate();
  const t = useRef<number>();

  useEffect(() => {
    window.clearTimeout(t.current);
    const term = q.trim();
    if (term.length < 2) { setRes([]); return; }
    t.current = window.setTimeout(async () => {
      const like = `%${term.replace(/[%,()]/g, '')}%`;
      const digits = term.replace(/\D/g, '');
      const ors = [`name.ilike.${like}`, `email.ilike.${like}`];
      if (digits.length >= 3) ors.push(`phone.ilike.%${digits}%`);
      const { data } = await supabase.from('leads').select('*').or(ors.join(',')).limit(8);
      setRes((data as Lead[]) ?? []);
    }, 200);
  }, [q]);

  const go = (id: string) => { setOpen(false); setQ(''); nav(`/leads/${id}`); };

  return (
    <div className="gsearch">
      <input
        placeholder="Search leads by name, phone or email"
        value={q}
        onChange={(e) => { setQ(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={(e) => { if (e.key === 'Enter' && res[0]) go(res[0].id); }}
      />
      {open && q.trim().length >= 2 && (
        <div className="gsearch-drop">
          <div className="gs-h">Leads</div>
          {res.length === 0 && <div className="gs-empty">No matches</div>}
          {res.map((l) => (
            <button key={l.id} onMouseDown={() => go(l.id)}>
              <span><b>{l.name}</b> <span className="muted small">{fmtPhone(l.phone) || l.email}</span></span>
              <BucketPill bucket={l.bucket} />
            </button>
          ))}
          <div className="gs-h">Clients <span className="soon-chip">Soon</span></div>
        </div>
      )}
    </div>
  );
}
