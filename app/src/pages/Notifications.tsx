import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { fmtDateTime, timeAgo } from '../lib/format';
import { NOTIFICATION_KINDS, type AppNotification } from '../lib/types';
import { Empty, Skeleton } from '../components/ui';

export default function Notifications() {
  const nav = useNavigate();
  const [rows, setRows] = useState<AppNotification[] | null>(null);
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [kind, setKind] = useState('');

  async function load() {
    let q = supabase.from('notifications').select('*').order('created_at', { ascending: false }).limit(300);
    if (unreadOnly) q = q.is('read_at', null);
    if (kind) q = q.eq('kind', kind);
    const { data } = await q;
    setRows((data as AppNotification[]) ?? []);
  }
  useEffect(() => { load(); }, [unreadOnly, kind]);
  useEffect(() => {
    const h = () => load();
    window.addEventListener('crm:notifications-changed', h);
    return () => window.removeEventListener('crm:notifications-changed', h);
  }, [unreadOnly, kind]);

  async function markRead(ids: string[] | null) {
    await supabase.rpc('mark_notifications_read', { p_ids: ids });
    window.dispatchEvent(new Event('crm:notifications-changed'));
  }
  const unread = rows?.filter((n) => !n.read_at).length ?? 0;

  return (
    <div className="main-inner">
      <div className="page-head">
        <div><h1>Notifications</h1><p>New leads, meetings, task updates and replies, newest first.</p></div>
        {unread > 0 && <button className="btn ghost" onClick={() => markRead(null)}>Mark all read</button>}
      </div>
      <div className="toolbar" style={{ marginBottom: 14 }}>
        <div className="seg">
          <button className={!unreadOnly ? 'on' : ''} onClick={() => setUnreadOnly(false)}>All</button>
          <button className={unreadOnly ? 'on' : ''} onClick={() => setUnreadOnly(true)}>Unread</button>
        </div>
        <select className="filter" value={kind} onChange={(e) => setKind(e.target.value)}>
          <option value="">All types</option>
          {NOTIFICATION_KINDS.map((k) => <option key={k.key} value={k.key}>{k.label}</option>)}
        </select>
      </div>
      <div className="panel">
        {rows === null && <div className="pad"><Skeleton /><br /><Skeleton /></div>}
        {rows?.length === 0 && <Empty>{unreadOnly ? 'You’re all caught up.' : 'No notifications yet.'}</Empty>}
        {rows?.map((n) => (
          <div key={n.id} className={`notif-row ${n.read_at ? '' : 'unread'}`}
            onClick={async () => { if (!n.read_at) await markRead([n.id]); if (n.link) nav(n.link); }}>
            <span className="notif-dot" />
            <div className="notif-main">
              <div className="notif-title">{n.title}</div>
              {n.body && <div className="notif-body">{n.body}</div>}
            </div>
            <span className="notif-when" title={fmtDateTime(n.created_at)}>{timeAgo(n.created_at)}</span>
            {!n.read_at && <button className="linkbtn small" onClick={(e) => { e.stopPropagation(); markRead([n.id]); }}>Mark read</button>}
          </div>
        ))}
      </div>
    </div>
  );
}
