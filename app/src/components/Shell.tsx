import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import { useApp } from '../auth';
import { supabase } from '../lib/supabase';
import { initials, fmtPhone, todayIST, timeAgo } from '../lib/format';
import type { AppNotification, Lead } from '../lib/types';
import { BucketPill, useToast } from './ui';
import AddLead from './AddLead';
import { ArgusSidebar } from './Brand';
import { TAGLINE } from '../lib/brand';
import MeetingAlerts from './MeetingAlerts';
import { playChime, setSoundEnabled, soundEnabled, unlockSound } from '../lib/sound';

type Badge = 'overdue' | 'tasks' | 'notifications' | 'requests';
type NavItem = { to: string; label: string; badge?: Badge };
const SECTIONS: { title: string; items: NavItem[]; admin?: boolean; soon?: boolean }[] = [
  {
    title: 'Workspace',
    items: [
      { to: '/', label: 'Dashboard' },
      { to: '/leads', label: 'Leads', badge: 'overdue' },
      { to: '/tasks', label: 'Tasks', badge: 'tasks' },
      { to: '/calendar', label: 'Calendar' },
      { to: '/reports', label: 'Reports' },
      { to: '/out', label: 'Out List' },
      { to: '/upload', label: 'Upload leads' },
    ],
  },
  {
    title: 'Account',
    items: [
      { to: '/notifications', label: 'Notifications', badge: 'notifications' },
      { to: '/connections', label: 'Connections' },
      { to: '/help', label: 'Help' },
    ],
  },
  { title: 'Admin', admin: true, items: [{ to: '/admin', label: 'Admin', badge: 'requests' }] },
  {
    title: 'Coming soon',
    soon: true,
    items: [
      { to: '/clients', label: 'Clients' },
      { to: '/onboarding', label: 'Onboarding' },
      { to: '/reviews', label: 'Reviews' },
    ],
  },
];

export default function Shell({ children }: { children: ReactNode }) {
  const { me, isAdmin, signOut, team } = useApp();
  const toast = useToast();
  const nav = useNavigate();
  const [adding, setAdding] = useState(false);
  const [menu, setMenu] = useState(false);
  const [counts, setCounts] = useState<Record<Badge, number>>({ overdue: 0, tasks: 0, notifications: 0, requests: 0 });
  const { pathname } = useLocation();

  const refreshCounts = useCallback(async () => {
    const today = todayIST();
    const [a, b, c] = await Promise.all([
      supabase.from('leads').select('id', { count: 'exact', head: true }).eq('rm_id', me!.id)
        .not('bucket', 'in', '(out,converting)').lt('next_follow_up', today),
      supabase.from('tasks').select('id', { count: 'exact', head: true })
        .or(`assignee_id.eq.${me!.id},and(assignee_id.is.null,to_team.eq.${me!.team})`).neq('status', 'done').lt('due_date', today),
      supabase.from('notifications').select('id', { count: 'exact', head: true }).is('read_at', null),
    ]);
    setCounts({
      overdue: a.count ?? 0, tasks: b.count ?? 0, notifications: c.count ?? 0,
      requests: team.filter((t) => !t.is_active && !t.approved_at && !t.rejected_at).length,
    });
  }, [me, team]);

  useEffect(() => { refreshCounts(); }, [pathname, refreshCounts]);
  useEffect(() => { const t = setInterval(refreshCounts, 60_000); return () => clearInterval(t); }, [refreshCounts]);
  useEffect(() => {
    const h = () => refreshCounts();
    window.addEventListener('crm:notifications-changed', h);
    return () => window.removeEventListener('crm:notifications-changed', h);
  }, [refreshCounts]);

  useEffect(() => { unlockSound(); }, []);

  // live pop-ups for new notifications (they stay until dismissed, with a chime)
  useEffect(() => {
    const ch = supabase.channel(`notif-${me!.id}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'notifications', filter: `user_id=eq.${me!.id}` }, (p) => {
        const n = p.new as AppNotification;
        toast(n.title, 'note', { sub: n.body ?? undefined, onClick: n.link ? () => openNotification(n) : undefined });
        playChime();
        refreshCounts();
        window.dispatchEvent(new Event('crm:notifications-changed'));
      })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [me?.id]);

  // Gmail: pull new emails with leads every 5 minutes while the CRM is open
  useEffect(() => {
    if (!me?.gmail_connected_at) return;
    const run = () => supabase.functions.invoke('gmail', { body: { action: 'sync' } }).then(() => undefined, () => undefined);
    run();
    const t = setInterval(run, 5 * 60_000);
    return () => clearInterval(t);
  }, [me?.gmail_connected_at]);

  async function openNotification(n: AppNotification) {
    if (!n.read_at) {
      await supabase.rpc('mark_notifications_read', { p_ids: [n.id] });
      window.dispatchEvent(new Event('crm:notifications-changed'));
    }
    if (n.link) nav(n.link);
  }

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
            <ArgusSidebar />
          </NavLink>
          <div className="sub" title={TAGLINE}>{TAGLINE}</div>
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
                    {n.badge && counts[n.badge] > 0 && (
                      <span className={`count ${n.badge === 'notifications' ? 'count-soft' : ''}`}>{counts[n.badge]}</span>
                    )}
                  </NavLink>
                ),
              )}
            </div>
          ))}
        </nav>
      </aside>

      <div className="content">
        <header className="topbar">
          <GlobalSearch />
          <div className="top-right">
            <button className="btn" onClick={() => setAdding(true)}>Add lead</button>
            <Bell unread={counts.notifications} onOpen={openNotification} />
            <div className="me" onClick={() => setMenu((m) => !m)}>
              {me?.avatar_url ? <img src={me.avatar_url} alt="" referrerPolicy="no-referrer" /> : <span className="av">{initials(me?.full_name)}</span>}
              <span className="me-name">{me?.full_name}</span>
              {menu && (
                <div className="menu" onMouseLeave={() => setMenu(false)}>
                  <div className="menu-h">{me?.email}<br /><span className="muted small">{isAdmin ? 'Admin' : 'Relationship Manager'}</span></div>
                  <NavLink to="/connections" className="menu-link">Connections</NavLink>
                  <button onClick={signOut}>Log out</button>
                </div>
              )}
            </div>
          </div>
        </header>
        <main className="main">{children}</main>
        <MeetingAlerts />
      </div>
      {adding && <AddLead onClose={() => setAdding(false)} />}
    </div>
  );
}

function Bell({ unread, onOpen }: { unread: number; onOpen: (n: AppNotification) => void }) {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<AppNotification[] | null>(null);
  const [sound, setSound] = useState(soundEnabled());
  const ref = useRef<HTMLDivElement>(null);
  const nav = useNavigate();

  useEffect(() => {
    if (!open) return;
    setItems(null);
    supabase.from('notifications').select('*').order('created_at', { ascending: false }).limit(10)
      .then(({ data }) => setItems((data as AppNotification[]) ?? []));
    const close = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  return (
    <div className="bell" ref={ref}>
      <button className="bell-btn" onClick={() => setOpen(!open)} aria-label={`Notifications${unread ? `, ${unread} unread` : ''}`}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
          <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" /><path d="M13.7 21a2 2 0 0 1-3.4 0" />
        </svg>
        {unread > 0 && <span className="bell-n">{unread > 99 ? '99+' : unread}</span>}
      </button>
      {open && (
        <div className="bell-drop">
          <div className="bell-head">
            <b>Notifications</b>
            <button className="linkbtn small sound-toggle" onClick={() => { const v = !sound; setSound(v); setSoundEnabled(v); if (v) playChime(); }}>
              Sound {sound ? 'on' : 'off'}
            </button>
            {unread > 0 && <button className="linkbtn small" onClick={async () => {
              await supabase.rpc('mark_notifications_read', { p_ids: null });
              setItems((x) => x?.map((n) => ({ ...n, read_at: n.read_at ?? new Date().toISOString() })) ?? null);
              window.dispatchEvent(new Event('crm:notifications-changed'));
            }}>Mark all read</button>}
          </div>
          {items === null && <div className="gs-empty">Loading…</div>}
          {items?.length === 0 && <div className="gs-empty">Nothing yet. New leads, meetings and task updates will show here.</div>}
          {items?.map((n) => (
            <button key={n.id} className={`notif ${n.read_at ? '' : 'unread'}`} onClick={() => { setOpen(false); onOpen(n); }}>
              <span className="notif-title">{n.title}</span>
              {n.body && <span className="notif-body">{n.body}</span>}
              <span className="notif-when">{timeAgo(n.created_at)}</span>
            </button>
          ))}
          <button className="bell-all" onClick={() => { setOpen(false); nav('/notifications'); }}>See all notifications</button>
        </div>
      )}
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
