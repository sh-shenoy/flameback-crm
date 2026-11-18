import { useEffect, useState, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useApp } from '../auth';
import { supabase } from '../lib/supabase';
import { addDays, fmtTime, relativeDay, timeAgo, todayIST } from '../lib/format';
import { BUCKETS, whereContact, type Bucket, type Lead, type Task } from '../lib/types';
import { Empty, ProductTag, Skeleton } from '../components/ui';
import { PriorityTag, TaskDrawer } from '../components/TaskParts';

const WORKING: Bucket[] = ['active_contact', 'awaiting_meeting', 'holding', 'deferred'];

interface Stats {
  active: number; newToday: number; dueToday: number; overdue: number; fresh?: number;
  meetingsWeek: number; meetingsToday: number; committedMonth: number; committedLastMonth: number;
  tasksOverdue: number; tasksToday: number;
}
type Action =
  | { kind: 'follow' | 'meeting' | 'new'; lead: Lead; when: string; sort: string }
  | { kind: 'task'; task: Task; when: string; sort: string };
type Kind = Action['kind'];

function monthStart(offset = 0): string {
  const t = todayIST();
  const d = new Date(Date.UTC(+t.slice(0, 4), +t.slice(5, 7) - 1 + offset, 1));
  return d.toISOString().slice(0, 10);
}

export default function Dashboard() {
  const { me } = useApp();
  const nav = useNavigate();
  const [stats, setStats] = useState<Stats | null>(null);
  const [actions, setActions] = useState<Action[] | null>(null);
  const [actFilter, setActFilter] = useState<'all' | Kind>('all');
  const [actDay, setActDay] = useState<'today' | 'tomorrow'>('today');
  const [openTask, setOpenTask] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const [pipeline, setPipeline] = useState<Record<string, number> | null>(null);
  const [funnel, setFunnel] = useState<{ n: number; follow: number; conv: number; out: number } | null>(null);
  const [period, setPeriod] = useState<0 | -1>(0);
  const [err, setErr] = useState<string | null>(null);

  const scoped = (q: any) => q.eq('rm_id', me!.id);
  const count = async (build: (q: any) => any) => {
    const { count: c, error } = await build(scoped(supabase.from('leads').select('id', { count: 'exact', head: true })));
    if (error) throw error;
    return c ?? 0;
  };

  useEffect(() => {
    const today = todayIST();
    const tomorrowStart = new Date(addDays(today, 1) + 'T00:00:00+05:30').toISOString();
    const todayStart = new Date(today + 'T00:00:00+05:30').toISOString();
    const weekEnd = new Date(addDays(today, 7) + 'T00:00:00+05:30').toISOString();
    setStats(null); setActions(null); setPipeline(null); setErr(null);

    const myTasks = () => supabase.from('tasks').select('*', { count: 'exact' })
      .or(`assignee_id.eq.${me!.id},and(assignee_id.is.null,to_team.eq.${me!.team}),created_by.eq.${me!.id}`)
      .neq('status', 'done');
    const taskCount = async (b: (q: any) => any) => { const { count: c, error } = await b(myTasks()).limit(1); if (error) throw error; return c ?? 0; };
    Promise.all([
      count((q) => q.in('bucket', WORKING)),
      count((q) => q.in('bucket', WORKING).gte('created_at', todayStart)),
      count((q) => q.in('bucket', WORKING).eq('next_follow_up', today)),
      count((q) => q.in('bucket', WORKING).lt('next_follow_up', today)),
      count((q) => q.eq('bucket', 'awaiting_meeting').gte('meeting_at', todayStart).lt('meeting_at', weekEnd)),
      count((q) => q.eq('bucket', 'awaiting_meeting').gte('meeting_at', todayStart).lt('meeting_at', tomorrowStart)),
      count((q) => q.gte('converted_at', monthStart(0)).in('bucket', ['converting', 'client'])),
      count((q) => q.gte('converted_at', monthStart(-1)).lt('converted_at', monthStart(0)).in('bucket', ['converting', 'client'])),
      taskCount((q) => q.lt('due_date', today)),
      taskCount((q) => q.eq('due_date', today)),
    ]).then(([active, newToday, dueToday, overdue, meetingsWeek, meetingsToday, committedMonth, committedLastMonth, tasksOverdue, tasksToday]) =>
      setStats({ active, newToday, dueToday, overdue, meetingsWeek, meetingsToday, committedMonth, committedLastMonth, tasksOverdue, tasksToday }),
    ).catch((e) => setErr(e.message));

    // actions for today (follow-ups due or overdue, meetings, tasks, new leads) or for tomorrow
    const tmr = addDays(today, 1);
    const dayAfterStart = new Date(addDays(today, 2) + 'T00:00:00+05:30').toISOString();
    const isToday = actDay === 'today';
    setActions(null);
    Promise.all([
      scoped(isToday
        ? supabase.from('leads').select('*').in('bucket', WORKING).lte('next_follow_up', today)
        : supabase.from('leads').select('*').in('bucket', WORKING).eq('next_follow_up', tmr))
        .order('next_follow_up', { ascending: true }).order('next_follow_up_at', { ascending: true, nullsFirst: false }).limit(100),
      scoped(supabase.from('leads').select('*').eq('bucket', 'awaiting_meeting')
        .gte('meeting_at', isToday ? todayStart : tomorrowStart).lt('meeting_at', isToday ? tomorrowStart : dayAfterStart)),
      // tasks I own (assigned to me, or to my team with nobody assigned) due today or overdue
      isToday
        ? supabase.from('tasks').select('*').or(`assignee_id.eq.${me!.id},and(assignee_id.is.null,to_team.eq.${me!.team})`).neq('status', 'done').lte('due_date', today).limit(100)
        : supabase.from('tasks').select('*').or(`assignee_id.eq.${me!.id},and(assignee_id.is.null,to_team.eq.${me!.team})`).neq('status', 'done').eq('due_date', tmr).limit(100),
      // new leads nobody has reached out to yet (oldest first) — today's list only
      whereContact(scoped(supabase.from('leads').select('*', { count: 'exact' })), 'new')
        .order('created_at', { ascending: true }).limit(isToday ? 100 : 1),
    ]).then(([f, m, tk, nw]: any[]) => {
      setStats((s) => (s ? { ...s, fresh: nw.count ?? (nw.data ?? []).length } : s));
      const out: Action[] = [];
      for (const t of (tk.data ?? []) as Task[]) out.push({ kind: 'task', task: t, when: t.due_date!, sort: (t.due_date! < today ? '0' : '3') + t.due_date });
      for (const l of (m.data ?? []) as Lead[]) out.push({ kind: 'meeting', lead: l, when: l.meeting_at!, sort: `1${l.meeting_at}` });
      for (const l of (f.data ?? []) as Lead[]) {
        // a lead with a meeting today shows once, as the meeting
        if (out.some((a) => a.kind === 'meeting' && a.lead.id === l.id)) continue;
        out.push({ kind: 'follow', lead: l, when: l.next_follow_up!, sort: (l.next_follow_up! < today ? '0' : '2') + l.next_follow_up + (l.next_follow_up_at ?? 'z') });
      }
      for (const l of (isToday ? nw.data ?? [] : []) as Lead[]) {
        if (out.some((a) => a.kind === 'meeting' && a.lead.id === l.id)) continue;
        out.push({ kind: 'new', lead: l, when: l.created_at, sort: '1z' + l.created_at });
      }
      out.sort((a, b) => a.sort.localeCompare(b.sort));
      setActions(out);
    });

    Promise.all(BUCKETS.map(async (b) => [b.key, await count((q) => q.eq('bucket', b.key))] as const))
      .then((pairs) => setPipeline(Object.fromEntries(pairs)))
      .catch(() => undefined);
  }, [me, reload, actDay]);   // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    setFunnel(null);
    const from = monthStart(period), to = monthStart(period + 1);
    const inMonth = (q: any) => q.gte('created_at', from).lt('created_at', to);
    Promise.all([
      count((q) => inMonth(q)),
      count((q) => inMonth(q).in('bucket', WORKING)),
      count((q) => inMonth(q).in('bucket', ['converting', 'client'])),
      count((q) => inMonth(q).eq('bucket', 'out')),
    ]).then(([n, follow, conv, out]) => setFunnel({ n, follow, conv, out })).catch(() => undefined);
  }, [me, period]);

  const hour = Number(new Intl.DateTimeFormat('en-GB', { hour: 'numeric', hour12: false, timeZone: 'Asia/Kolkata' }).format(new Date()));
  const greet = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  const first = me?.full_name?.split(' ')[0] ?? '';
  const todayLong = new Intl.DateTimeFormat('en-GB', { weekday: 'long', day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' }).format(new Date());
  const shown = (actions ?? []).filter((a) => actFilter === 'all' || a.kind === actFilter);
  const leadsLink = (params: string) => `/leads${params}`;

  return (
    <div className="main-inner">
      <div className="page-head">
        <div><h1>{greet}, {first}</h1><p>{todayLong}</p></div>
      </div>
      {err && <div className="banner warn">Couldn't load the numbers: {err}</div>}

      <div className="cards">
        <Card label="Active leads" v={stats?.active} sub={stats && (stats.fresh ? `${stats.fresh} new to contact` : stats.newToday ? `+${stats.newToday} new today` : 'No new leads today')} onClick={() => nav(leadsLink(stats?.fresh ? '?due=new' : ''))} />
        <Card label="Follow-ups due" v={stats?.dueToday} sub={stats && (stats.overdue ? <span className="red">{stats.overdue} overdue</span> : 'Nothing overdue')}
          dot={!!stats?.overdue} onClick={() => document.getElementById('todays-actions')?.scrollIntoView({ behavior: 'smooth' })} />
        <Card label="Meetings this week" v={stats?.meetingsWeek} sub={stats && `${stats.meetingsToday} today`} onClick={() => nav(leadsLink('?bucket=awaiting_meeting'))} />
        <Card label="New prospects this month" v={stats?.committedMonth} sub={stats && `${stats.committedLastMonth} last month`} onClick={() => nav(leadsLink('?bucket=converting'))} />
        <Card label="Overdue tasks" v={stats?.tasksOverdue} sub={stats && `${stats.tasksToday} due today`} dot={!!stats?.tasksOverdue} onClick={() => nav('/tasks?due=overdue')} />
        <Card label="AUM" soon />
        <Card label="Reviews this week" soon />
        <Card label="Touch-base due" soon />
      </div>

      <div className="dash-cols">
        <div className="panel" id="todays-actions">
          <div className="panel-head">
            <h2 className="row-gap">
              <span className="seg sm">
                <button className={actDay === 'today' ? 'on' : ''} onClick={() => setActDay('today')}>Today</button>
                <button className={actDay === 'tomorrow' ? 'on' : ''} onClick={() => setActDay('tomorrow')}>Tomorrow</button>
              </span>
              <span>Actions {actions && <span className="muted">· {actions.length}</span>}</span>
            </h2>
            <div className="chips">
              {(['all', 'new', 'follow', 'meeting', 'task'] as const).map((k) => (
                <button key={k} className={`chip ${actFilter === k ? 'on' : ''}`} onClick={() => setActFilter(k)}>
                  {k === 'all' ? 'All' : k === 'new' ? 'New leads' : k === 'follow' ? 'Follow-ups' : k === 'meeting' ? 'Meetings' : 'Tasks'}
                </button>
              ))}
              <span className="chip disabled" title="Coming soon">Reviews</span>
            </div>
          </div>
          {actions === null && <div className="pad"><Skeleton /><br /><Skeleton /><br /><Skeleton /></div>}
          {actions && actions.length === 0 && (
            stats?.active === 0
              ? <Empty>You're all caught up. New leads and follow-ups will show here.<br /><br />
                  <button className="btn" onClick={() => window.dispatchEvent(new Event('crm:add-lead'))}>Add lead</button></Empty>
              : <Empty>Nothing due {actDay}. <Link to="/leads">See all leads →</Link></Empty>
          )}
          {shown.length > 0 && (
            <div className="actions-list">
              {shown.slice(0, 15).map((a) => {
                if (a.kind === 'task') {
                  const r = relativeDay(a.when);
                  return (
                    <div key={'t' + a.task.id} className="action-row" onClick={() => setOpenTask(a.task.id)}>
                      <span className="a-type">Task</span>
                      <div className="a-what">
                        <b>{a.task.title}</b>
                        <span className="muted small"> · <PriorityTag p={a.task.priority} /> · from {a.task.from_team}{a.task.lead_name ? ` · ${a.task.lead_name}` : ''}</span>
                      </div>
                      <span className={`a-when ${r.tone === 'overdue' ? 'red' : ''}`}>{r.text}</span>
                      <button className="btn ghost sm" onClick={(e) => { e.stopPropagation(); setOpenTask(a.task.id); }}>Open</button>
                    </div>
                  );
                }
                if (a.kind === 'new') {
                  const old = Date.now() - Date.parse(a.when) > 86400e3;
                  return (
                    <div key={'n' + a.lead.id} className="action-row" onClick={() => nav(`/leads/${a.lead.id}`)}>
                      <span className="a-type t-new">New lead</span>
                      <div className="a-what">
                        <b>Contact {a.lead.name}</b>
                        <span className="muted small"> · <ProductTag product={a.lead.product} /> · {a.lead.source}{a.lead.campaign ? ` · ${a.lead.campaign}` : ''}</span>
                      </div>
                      <span className={`a-when ${old ? 'amber' : ''}`}>Added {timeAgo(a.when)}</span>
                      <button className="btn ghost sm" onClick={(e) => { e.stopPropagation(); nav(`/leads/${a.lead.id}`); }}>Log activity</button>
                    </div>
                  );
                }
                const r = a.kind === 'follow' ? relativeDay(a.when) : null;
                return (
                  <div key={a.kind + a.lead.id} className="action-row" onClick={() => nav(`/leads/${a.lead.id}`)}>
                    <span className={`a-type t-${a.kind}`}>{a.kind === 'meeting' ? 'Meeting' : 'Follow-up'}</span>
                    <div className="a-what">
                      <b>{a.kind === 'meeting' ? `Meet ${a.lead.name}` : `Contact ${a.lead.name}`}</b>
                      <span className="muted small"> · <ProductTag product={a.lead.product} /> · {BUCKETS.find((b) => b.key === a.lead.bucket)?.label}</span>
                    </div>
                    <span className={`a-when ${r?.tone === 'overdue' ? 'red' : ''}`}>
                      {a.kind === 'meeting' ? `${actDay === 'today' ? 'Today' : 'Tomorrow'}, ${fmtTime(a.when)}` : `${r!.text}${a.lead.next_follow_up_at ? `, ${fmtTime(a.lead.next_follow_up_at)}` : ''}`}
                    </span>
                    <button className="btn ghost sm" onClick={(e) => { e.stopPropagation(); nav(`/leads/${a.lead.id}`); }}>
                      {a.kind === 'meeting' ? 'Open' : 'Log entry'}
                    </button>
                  </div>
                );
              })}
              {shown.length > 15 && <div className="pad small"><Link to="/leads?due=overdue">Show all {shown.length} →</Link></div>}
            </div>
          )}
        </div>

        <div className="dash-right">
          <div className="panel">
            <div className="panel-head"><h2>Lead funnel</h2>
              <div className="seg sm">
                <button className={period === 0 ? 'on' : ''} onClick={() => setPeriod(0)}>This month</button>
                <button className={period === -1 ? 'on' : ''} onClick={() => setPeriod(-1)}>Last month</button>
              </div>
            </div>
            <div className="pad">
              {!funnel ? <Skeleton h={120} /> : funnel.n === 0 ? <div className="muted">No leads {period === 0 ? 'this month' : 'last month'} yet.</div> : (
                <div className="funnel">
                  {([['New', funnel.n, ''], ['In follow-up', funnel.follow, ''], ['Prospect / client', funnel.conv, '?bucket=converting'], ['Out', funnel.out, '']] as const).map(([l, n, link], i) => (
                    <div key={l} className="f-row" onClick={() => nav(l === 'Out' ? '/out' : leadsLink(link))}>
                      <span className="f-l">{l}</span>
                      <span className="f-bar"><i style={{ width: `${Math.max(2, (n / funnel.n) * 100)}%` }} className={`fb${i}`} /></span>
                      <span className="f-n">{n}{i > 0 && <span className="muted small"> · {Math.round((n / funnel.n) * 100)}%</span>}</span>
                    </div>
                  ))}
                  <div className="hint">Leads created {period === 0 ? 'this month' : 'last month'}, by where they are now.</div>
                </div>
              )}
            </div>
          </div>

          <div className="panel">
            <div className="panel-head"><h2>Pipeline now</h2></div>
            <div className="pad">
              {!pipeline ? <Skeleton h={140} /> : BUCKETS.map((b) => (
                <div key={b.key} className="pipe-row" onClick={() => nav(b.key === 'out' ? '/out' : leadsLink(`?bucket=${b.key}`))}>
                  <span className={`bucket b-${b.key}`}>{b.label}</span>
                  <b>{pipeline[b.key] ?? 0}</b>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
      {openTask && <TaskDrawer id={openTask} onClose={() => setOpenTask(null)} onChanged={() => setReload((n) => n + 1)} />}
    </div>
  );
}

function Card({ label, v, sub, onClick, dot, soon }: {
  label: string; v?: number; sub?: ReactNode; onClick?: () => void; dot?: boolean; soon?: boolean;
}) {
  if (soon) return (
    <div className="card soon"><div className="k">{label}</div><div className="v muted">—</div><div className="meta"><span className="soon-chip">Coming soon</span></div></div>
  );
  return (
    <div className={`card clickable`} onClick={onClick}>
      <div className="k">{label}{dot && <span className="red-dot" />}</div>
      <div className={`v ${v === 0 ? 'zero' : ''}`}>{v ?? <Skeleton h={30} w={50} />}</div>
      <div className="meta">{v === 0 && !dot ? '' : sub}</div>
    </div>
  );
}

