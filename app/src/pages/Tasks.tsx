import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useApp } from '../auth';
import { rpc, supabase } from '../lib/supabase';
import { addDays, todayIST } from '../lib/format';
import { PRIORITIES, TASK_STATUSES, TEAMS, statusLabel, type Task, type TaskStatus } from '../lib/types';
import { Empty, Skeleton, useToast } from '../components/ui';
import { BlockedModal, DueTag, NewTaskModal, PriorityTag, StatusTag, TaskDrawer, isOverdue, useCanChange } from '../components/TaskParts';

type Tab = 'mine' | 'team' | 'raised' | 'all';
const PRIO_ORDER = { high: 0, medium: 1, low: 2 } as const;

function readView(): 'board' | 'list' {
  try { return localStorage.getItem('crm.tasks.view') === 'list' ? 'list' : 'board'; } catch { return 'board'; }
}

export default function Tasks() {
  const { me, isAdmin, teamName } = useApp();
  const toast = useToast();
  const canChange = useCanChange();
  const [sp, setSp] = useSearchParams();
  const tab = (sp.get('tab') as Tab) || 'mine';
  const due = sp.get('due') ?? '';
  const [view, setView] = useState<'board' | 'list'>(readView);
  const [rows, setRows] = useState<Task[] | null>(null);
  const [q, setQ] = useState('');
  const [prio, setPrio] = useState('');
  const [teamF, setTeamF] = useState('');
  const [open, setOpen] = useState<string | null>(sp.get('task'));
  const [adding, setAdding] = useState<TaskStatus | null>(null);
  const [blocking, setBlocking] = useState<Task | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [overCol, setOverCol] = useState<TaskStatus | null>(null);

  const setParam = (k: string, v: string) => { const n = new URLSearchParams(sp); if (v) n.set(k, v); else n.delete(k); setSp(n, { replace: true }); };

  async function load() {
    let query = supabase.from('tasks').select('*').order('updated_at', { ascending: false }).limit(1000);
    if (tab === 'mine') query = query.or(`assignee_id.eq.${me!.id},and(assignee_id.is.null,to_team.eq.${me!.team})`);
    if (tab === 'team') query = query.eq('to_team', me!.team);
    if (tab === 'raised') query = query.eq('created_by', me!.id);
    const { data } = await query;
    setRows((data as Task[]) ?? []);
  }
  useEffect(() => { setRows(null); load(); }, [tab]);
  useEffect(() => { try { localStorage.setItem('crm.tasks.view', view); } catch { /* ignore */ } }, [view]);

  const shown = useMemo(() => {
    const today = todayIST();
    const term = q.trim().toLowerCase();
    return (rows ?? []).filter((t) =>
      (!prio || t.priority === prio) &&
      (!teamF || t.to_team === teamF) &&
      (!term || `${t.title} ${t.details ?? ''} ${t.lead_name ?? ''}`.toLowerCase().includes(term)) &&
      (!due || (due === 'overdue' ? isOverdue(t)
        : due === 'today' ? t.status !== 'done' && t.due_date === today
        : t.status !== 'done' && !!t.due_date && t.due_date <= addDays(today, 7))),
    ).sort((a, b) =>
      Number(isOverdue(b)) - Number(isOverdue(a)) ||
      PRIO_ORDER[a.priority] - PRIO_ORDER[b.priority] ||
      (a.due_date ?? '9999').localeCompare(b.due_date ?? '9999'));
  }, [rows, q, prio, teamF, due]);

  async function move(t: Task, s: TaskStatus) {
    if (t.status === s) return;
    if (!canChange(t)) { toast('Only the owning team or the person who raised it can move this task', 'err'); return; }
    if (s === 'blocked') { setBlocking(t); return; }
    setRows((r) => r?.map((x) => (x.id === t.id ? { ...x, status: s } : x)) ?? null); // optimistic
    try { await rpc('set_task_status', { p_task: t.id, p_status: s }); toast(`Moved to ${statusLabel(s)}`); }
    catch (e) { toast((e as Error).message, 'err'); }
    load();
  }

  const tabs: { key: Tab; label: string }[] = [
    { key: 'mine', label: 'Assigned to me' },
    { key: 'team', label: `${me!.team} team` },
    { key: 'raised', label: 'Raised by me' },
    ...(isAdmin ? [{ key: 'all' as Tab, label: 'All' }] : []),
  ];
  const filtersOn = q || prio || teamF || due;

  return (
    <div className="main-inner wide">
      <div className="page-head">
        <div><h1>Tasks</h1><p>Requests between you and the Operations, Compliance and Investment teams.</p></div>
        <div className="row-gap">
          <div className="seg">
            <button className={view === 'board' ? 'on' : ''} onClick={() => setView('board')}>Board</button>
            <button className={view === 'list' ? 'on' : ''} onClick={() => setView('list')}>List</button>
          </div>
          <button className="btn" onClick={() => setAdding('open')}>New task</button>
        </div>
      </div>

      <div className="tabs">
        {tabs.map((t) => <button key={t.key} className={`tab ${tab === t.key ? 'on' : ''}`} onClick={() => setParam('tab', t.key === 'mine' ? '' : t.key)}>{t.label}</button>)}
      </div>

      <div className="toolbar" style={{ marginBottom: 14 }}>
        <div className="search"><input placeholder="Search title, details, lead" value={q} onChange={(e) => setQ(e.target.value)} /></div>
        <select className="filter" value={prio} onChange={(e) => setPrio(e.target.value)}>
          <option value="">All priorities</option>{PRIORITIES.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
        </select>
        <select className="filter" value={teamF} onChange={(e) => setTeamF(e.target.value)}>
          <option value="">All teams</option>{TEAMS.map((t) => <option key={t}>{t}</option>)}
        </select>
        <select className="filter" value={due} onChange={(e) => setParam('due', e.target.value)}>
          <option value="">Any due date</option><option value="overdue">Overdue</option><option value="today">Due today</option><option value="week">Due this week</option>
        </select>
        {filtersOn && <button className="linkbtn" onClick={() => { setQ(''); setPrio(''); setTeamF(''); setParam('due', ''); }}>Clear filters</button>}
      </div>

      {rows === null ? <div className="board">{[0, 1, 2, 3].map((i) => <div key={i} className="col"><Skeleton h={120} /></div>)}</div>
        : view === 'board' ? (
          <div className="board">
            {TASK_STATUSES.map((s) => {
              const items = shown.filter((t) => t.status === s.key);
              return (
                <div key={s.key} className={`col ${overCol === s.key ? 'over' : ''}`}
                  onDragOver={(e) => { e.preventDefault(); setOverCol(s.key); }}
                  onDragLeave={() => setOverCol(null)}
                  onDrop={(e) => { e.preventDefault(); setOverCol(null); const t = rows.find((x) => x.id === dragId); if (t) move(t, s.key); setDragId(null); }}>
                  <div className="col-head">
                    <span className={`col-dot cd-${s.key}`} />{s.label}<span className="col-n">{items.length}</span>
                    {s.key !== 'blocked' && <button className="linkbtn small" style={{ marginLeft: 'auto' }} onClick={() => setAdding(s.key)}>Add task</button>}
                  </div>
                  <div className="col-body">
                    {items.map((t) => (
                      <div key={t.id} className={`tcard ${dragId === t.id ? 'dragging' : ''} ${canChange(t) ? '' : 'locked'}`}
                        draggable={canChange(t)}
                        onDragStart={() => setDragId(t.id)} onDragEnd={() => setDragId(null)}
                        onClick={() => setOpen(t.id)}>
                        <div className="tc-top"><PriorityTag p={t.priority} />{isOverdue(t) && <span className="red small">Overdue</span>}</div>
                        <div className="tc-title">{t.title}</div>
                        {t.lead_name && <div className="tc-sub">{t.lead_name}</div>}
                        {t.status === 'blocked' && t.blocked_reason && <div className="tc-blocked">{t.blocked_reason}</div>}
                        <div className="tc-foot">
                          <span>{t.from_team} → {t.to_team}</span>
                          <span>{t.assignee_id ? teamName(t.assignee_id) : 'Unassigned'}</span>
                          <DueTag task={t} />
                        </div>
                      </div>
                    ))}
                    {items.length === 0 && <div className="col-empty">No tasks</div>}
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="panel">
            <div className="table-wrap">
              <table>
                <thead><tr><th>Priority</th><th>Task</th><th>Lead</th><th>From → to</th><th>Assignee</th><th>Due</th><th>Status</th></tr></thead>
                <tbody>
                  {shown.map((t) => (
                    <tr key={t.id} className="lead-row" onClick={() => setOpen(t.id)}>
                      <td><PriorityTag p={t.priority} /></td>
                      <td><div className="lead-name">{t.title}</div>{t.status === 'blocked' && t.blocked_reason && <div className="lead-sub">Blocked: {t.blocked_reason}</div>}</td>
                      <td>{t.lead_name ?? <span className="muted">—</span>}</td>
                      <td className="small">{t.from_team} → {t.to_team}</td>
                      <td>{t.assignee_id ? teamName(t.assignee_id) : <span className="muted">Unassigned</span>}</td>
                      <td><DueTag task={t} /></td>
                      <td><StatusTag s={t.status} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {shown.length === 0 && <Empty>{filtersOn ? 'No tasks match your filters.' : 'No tasks here yet.'}</Empty>}
            </div>
          </div>
        )}

      {open && <TaskDrawer id={open} onClose={() => { setOpen(null); setParam('task', ''); }} onChanged={load} />}
      {adding && <NewTaskModal status={adding} onClose={() => setAdding(null)} onSaved={load} />}
      {blocking && <BlockedModal onClose={() => setBlocking(null)} onConfirm={async (r) => {
        try { await rpc('set_task_status', { p_task: blocking.id, p_status: 'blocked', p_reason: r }); toast('Marked blocked'); }
        catch (e) { toast((e as Error).message, 'err'); }
        setBlocking(null); load();
      }} />}
    </div>
  );
}
