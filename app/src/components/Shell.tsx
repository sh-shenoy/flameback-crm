import { useEffect, useRef, useState, type ReactNode } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import { useApp } from '../auth';
import { supabase } from '../lib/supabase';
import { initials, fmtPhone, todayIST } from '../lib/format';
import type { Lead } from '../lib/types';
import { BucketPill } from './ui';
import AddLead from './AddLead';

type NavItem = { to: string; label: string; badge?: 'overdue' | 'tasks' };
const SECTIONS: { title: string; items: NavItem[]; admin?: boolean; soon?: boolean }[] = [
  {
    title: 'Workspace',
    items: [
      { to: '/', label: 'Dashboard' },
      { to: '/leads', label: 'Leads', badge: 'overdue' },
      { to: '/tasks', label: 'Tasks', badge: 'tasks' },
      { to: '/out', label: 'Out List' },
      { to: '/upload', label: 'Upload leads' },
    ],
  },
  { title: 'Admin', admin: true, items: [{ to: '/team', label: 'Team & rotation' }] },
  {
    title: 'Coming soon',
    soon: true,
    items: [
      { to: '/clients', label: 'Clients' },
      { to: '/onboarding', label: 'Onboarding' },
      { to: '/reviews', label: 'Reviews' },
      { to: '/calendar', label: 'Calendar' },
      { to: '/notifications', label: 'Notifications' },
    ],
  },
];

export default function Shell({ children }: { children: ReactNode }) {
  const { me, isAdmin, signOut } = useApp();
  const [adding, setAdding] = useState(false);
  const [menu, setMenu] = useState(false);
  const [overdue, setOverdue] = useState(0);
  const [overdueTasks, setOverdueTasks] = useState(0);
  const { pathname } = useLocation();

  useEffect(() => {
    supabase.from('leads').select('id', { count: 'exact', head: true })
      .eq('rm_id', me!.id)
      .not('bucket', 'in', '(out,converting)')
      .lt('next_follow_up', todayIST())
      .then(({ count }) => setOverdue(count ?? 0));
    supabase.from('tasks').select('id', { count: 'exact', head: true })
      .or(`assignee_id.eq.${me!.id},and(assignee_id.is.null,to_team.eq.${me!.team})`)
      .neq('status', 'done')
      .lt('due_date', todayIST())
      .then(({ count }) => setOverdueTasks(count ?? 0));
  }, [pathname, me]);

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
          <NavLink to="/" className="logo">
            <img className="logo-mark" src={`${import.meta.env.BASE_URL}logo-mark.png`} alt="" />
            <span className="wordmark"><b>FLAMEBACK</b><span>CAPITAL</span></span>
          </NavLink>
          <div className="sub">CRM</div>
        </div>
        <nav className="nav">
          {SECTIONS.filter((s) => !s.admin || isAdmin).map((s) => (
            <div key={s.title} className="nav-section">
              <div className="nav-title">{s.title}</div>
              {s.items.map((n) =>
                s.soon ? (
                  <div key={n.to} className="nav-item soon" title="Coming soon">{n.label}</div>
                ) : (
                  <NavLink key={n.to} to={n.to} end={n.to === '/'} className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
                    {n.label}
                    {n.badge === 'overdue' && overdue > 0 && <span className="count" title={`${overdue} overdue follow-ups`}>{overdue}</span>}
                    {n.badge === 'tasks' && overdueTasks > 0 && <span className="count" title={`${overdueTasks} overdue tasks`}>{overdueTasks}</span>}
                  </NavLink>
                ),
              )}
            </div>
          ))}
        </nav>
        <div className="side-foot">India Quantitative Wealth Management</div>
      </aside>

      <div className="content">
        <header className="topbar">
          <GlobalSearch />
          <div className="top-right">
            <button className="btn" onClick={() => setAdding(true)}>Add lead</button>
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
  const { me } = useApp();
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
      const { data } = await supabase.from('leads').select('*').eq('rm_id', me!.id).or(ors.join(',')).limit(8);
      setRes((data as Lead[]) ?? []);
    }, 200);
  }, [q]);

  const go = (id: string) => { setOpen(false); setQ(''); nav(`/leads/${id}`); };

  return (
    <div className="gsearch">
      <input
        placeholder="Search your leads by name, phone or email"
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
          <div className="gs-h">Clients <span className="soon-chip">Coming soon</span></div>
        </div>
      )}
    </div>
  );
}
