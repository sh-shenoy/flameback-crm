import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useApp } from '../auth';
import { rpc, supabase } from '../lib/supabase';
import { fmtDate, fmtDateTime, relativeDay, todayIST } from '../lib/format';
import {
  PRIORITIES, TASK_STATUSES, TASK_TEMPLATES, TEAMS, statusLabel,
  type Lead, type Task, type TaskComment, type TaskEvent, type TaskStatus, type Team,
} from '../lib/types';
import { Drawer, Field, Modal, useToast } from './ui';

/* ───────── small bits ───────── */
export function PriorityTag({ p }: { p: Task['priority'] }) {
  return <span className={`prio pr-${p}`}>{PRIORITIES.find((x) => x.key === p)?.label}</span>;
}
export function StatusTag({ s }: { s: TaskStatus }) {
  return <span className={`tstatus ts-${s}`}>{statusLabel(s)}</span>;
}
export function DueTag({ task }: { task: Task }) {
  if (!task.due_date) return <span className="muted">—</span>;
  const r = relativeDay(task.due_date);
  const overdue = task.status !== 'done' && r.tone === 'overdue';
  return <span className={overdue ? 'red' : task.status !== 'done' && r.tone === 'today' ? 'amber' : ''}>{fmtDate(task.due_date)}</span>;
}
export function isOverdue(t: Task) {
  return t.status !== 'done' && !!t.due_date && t.due_date < todayIST();
}

/** Who may move / edit a task (mirrors the database rule). */
export function useCanChange() {
  const { me, isAdmin } = useApp();
  return (t: Task) => isAdmin || t.assignee_id === me!.id || t.to_team === me!.team || t.created_by === me!.id;
}

/* ───────── lead picker (own leads) ───────── */
function LeadPicker({ value, label, onChange }: { value: string; label: string; onChange: (id: string, name: string) => void }) {
  const { me } = useApp();
  const [q, setQ] = useState('');
  const [res, setRes] = useState<Lead[]>([]);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (q.trim().length < 2) { setRes([]); return; }
    const t = setTimeout(async () => {
      const like = `%${q.trim().replace(/[%,()]/g, '')}%`;
      const { data } = await supabase.from('leads').select('*').eq('rm_id', me!.id).or(`name.ilike.${like},phone.ilike.${like},email.ilike.${like}`).limit(6);
      setRes((data as Lead[]) ?? []);
    }, 200);
    return () => clearTimeout(t);
  }, [q]);
  if (value) return (
    <div className="picked"><span>{label}</span><button className="linkbtn" onClick={() => onChange('', '')}>Remove</button></div>
  );
  return (
    <div className="picker">
      <input placeholder="Search your leads (optional)" value={q} onChange={(e) => { setQ(e.target.value); setOpen(true); }}
        onBlur={() => setTimeout(() => setOpen(false), 150)} />
      {open && res.length > 0 && (
        <div className="picker-drop">
          {res.map((l) => <button key={l.id} onMouseDown={() => { onChange(l.id, l.name); setQ(''); }}>{l.name}</button>)}
        </div>
      )}
    </div>
  );
}

/* ───────── new task ───────── */
export function NewTaskModal({ onClose, onSaved, lead, status }: {
  onClose: () => void; onSaved?: (id: string) => void; lead?: { id: string; name: string }; status?: TaskStatus;
}) {
  const { team } = useApp();
  const toast = useToast();
  const [tpl, setTpl] = useState('');
  const [f, setF] = useState({
    title: '', details: '', to_team: 'Operations' as Team, assignee_id: '', priority: 'medium',
    due_date: '', lead_id: lead?.id ?? '', lead_name: lead?.name ?? '',
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });

  function applyTemplate(key: string) {
    setTpl(key);
    const t = TASK_TEMPLATES.find((x) => x.key === key);
    if (!t) { setF({ ...f, title: '', details: '' }); return; }
    setF({ ...f, title: t.title + (f.lead_name ? ` · ${f.lead_name}` : ''), details: t.details, to_team: t.to_team, assignee_id: '' });
  }

  async function save() {
    if (!f.title.trim()) { setErr('Give the task a title'); return; }
    setBusy(true); setErr(null);
    try {
      const id = await rpc<string>('create_task', { p: {
        title: f.title, details: f.details, to_team: f.to_team, assignee_id: f.assignee_id, priority: f.priority,
        due_date: f.due_date, lead_id: f.lead_id, template: tpl, status: status ?? 'open',
      } });
      toast(`Task raised to ${f.to_team}`);
      onClose();
      onSaved?.(id);
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  }

  const members = team.filter((p) => p.is_active && p.team === f.to_team);
  return (
    <Modal title="New task" onClose={onClose} wide
      footer={<><button className="btn ghost" onClick={onClose}>Cancel</button><button className="btn" disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Raise task'}</button></>}>
      <Field label="Start from a template">
        <div className="chips">
          <button className={`chip ${tpl === '' ? 'on' : ''}`} onClick={() => applyTemplate('')}>Blank</button>
          {TASK_TEMPLATES.map((t) => <button key={t.key} className={`chip ${tpl === t.key ? 'on' : ''}`} onClick={() => applyTemplate(t.key)}>{t.label}</button>)}
        </div>
      </Field>
      <Field label="Title" required><input autoFocus value={f.title} onChange={set('title')} /></Field>
      <div className="grid2">
        <Field label="Send to team" required>
          <select value={f.to_team} onChange={(e) => setF({ ...f, to_team: e.target.value as Team, assignee_id: '' })}>
            {TEAMS.map((t) => <option key={t}>{t}</option>)}
          </select>
        </Field>
        <Field label="Assignee" hint={members.length ? undefined : 'Nobody in this team has signed in yet; the whole team will see it.'}>
          <select value={f.assignee_id} onChange={set('assignee_id')}>
            <option value="">Anyone in {f.to_team}</option>
            {members.map((p) => <option key={p.id} value={p.id}>{p.full_name}</option>)}
          </select>
        </Field>
        <Field label="Priority">
          <select value={f.priority} onChange={set('priority')}>{PRIORITIES.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}</select>
        </Field>
        <Field label="Due date"><input type="date" min={todayIST()} value={f.due_date} onChange={set('due_date')} /></Field>
      </div>
      <Field label="Lead">
        <LeadPicker value={f.lead_id} label={f.lead_name} onChange={(id, name) => setF({ ...f, lead_id: id, lead_name: name })} />
      </Field>
      <Field label="Details"><textarea rows={5} value={f.details} onChange={set('details')} /></Field>
      {err && <div className="form-err">{err}</div>}
    </Modal>
  );
}

/* ───────── blocked reason ───────── */
export function BlockedModal({ onClose, onConfirm }: { onClose: () => void; onConfirm: (reason: string) => Promise<void> }) {
  const [r, setR] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <Modal title="Why is this blocked?" onClose={onClose}
      footer={<><button className="btn ghost" onClick={onClose}>Cancel</button>
        <button className="btn" disabled={busy || !r.trim()} onClick={async () => { setBusy(true); await onConfirm(r); setBusy(false); }}>Mark blocked</button></>}>
      <Field label="Reason" required hint="Everyone on the task sees this."><textarea autoFocus value={r} onChange={(e) => setR(e.target.value)} placeholder="e.g. Waiting for the client's PAN copy" /></Field>
    </Modal>
  );
}

/* ───────── detail drawer ───────── */
export function TaskDrawer({ id, onClose, onChanged }: { id: string; onClose: () => void; onChanged: () => void }) {
  const { me, team, teamName, isAdmin } = useApp();
  const toast = useToast();
  const canChange = useCanChange();
  const [t, setT] = useState<Task | null>(null);
  const [comments, setComments] = useState<TaskComment[]>([]);
  const [events, setEvents] = useState<TaskEvent[]>([]);
  const [f, setF] = useState<Partial<Task>>({});
  const [comment, setComment] = useState('');
  const [blocking, setBlocking] = useState(false);
  const [canOpenLead, setCanOpenLead] = useState(false);

  const load = useCallback(async () => {
    const [a, b, c] = await Promise.all([
      supabase.from('tasks').select('*').eq('id', id).maybeSingle(),
      supabase.from('task_comments').select('*').eq('task_id', id).order('created_at'),
      supabase.from('task_events').select('*').eq('task_id', id).order('at'),
    ]);
    const task = a.data as Task | null;
    setT(task);
    if (task) setF({ title: task.title, details: task.details, priority: task.priority, to_team: task.to_team, assignee_id: task.assignee_id, due_date: task.due_date });
    setComments((b.data as TaskComment[]) ?? []);
    setEvents((c.data as TaskEvent[]) ?? []);
    if (task?.lead_id) {
      const { count } = await supabase.from('leads').select('id', { count: 'exact', head: true }).eq('id', task.lead_id);
      setCanOpenLead((count ?? 0) > 0);
    }
  }, [id]);
  useEffect(() => { load(); }, [load]);

  if (!t) return <Drawer title="Task" onClose={onClose}><div className="muted">Loading…</div></Drawer>;
  const editable = canChange(t);
  const dirty = (['title', 'details', 'priority', 'to_team', 'assignee_id', 'due_date'] as const).some((k) => (f[k] ?? null) !== (t[k] ?? null));

  async function call(fn: string, args: Record<string, unknown>, msg: string) {
    try { await rpc(fn, args); toast(msg); await load(); onChanged(); }
    catch (e) { toast((e as Error).message, 'err'); }
  }
  async function setStatus(s: TaskStatus) {
    if (s === 'blocked') { setBlocking(true); return; }
    await call('set_task_status', { p_task: t!.id, p_status: s }, `Moved to ${statusLabel(s)}`);
  }
  const members = team.filter((p) => p.is_active && p.team === f.to_team);

  return (
    <Drawer title={t.title} sub={`Raised by ${teamName(t.created_by)} (${t.from_team}) · ${fmtDateTime(t.created_at)}`} onClose={onClose}
      footer={<>
        {(isAdmin || t.created_by === me!.id) && (
          <button className="btn ghost danger-text" style={{ marginRight: 'auto' }}
            onClick={async () => { if (confirm('Delete this task?')) { await call('delete_task', { p_task: t.id }, 'Task deleted'); onClose(); } }}>Delete</button>
        )}
        <button className="btn ghost" onClick={onClose}>Close</button>
        {editable && <button className="btn" disabled={!dirty} onClick={() => call('update_task', { p_task: t.id, p: f }, 'Task saved')}>Save changes</button>}
      </>}>
      <Field label="Status">
        <div className="chips">
          {TASK_STATUSES.map((s) => (
            <button key={s.key} disabled={!editable} className={`chip ${t.status === s.key ? 'on' : ''}`} onClick={() => setStatus(s.key)}>{s.label}</button>
          ))}
        </div>
      </Field>
      {t.status === 'blocked' && t.blocked_reason && <div className="banner warn">Blocked: {t.blocked_reason}</div>}
      {editable ? (
        <>
          <Field label="Title"><input value={f.title ?? ''} onChange={(e) => setF({ ...f, title: e.target.value })} /></Field>
          <div className="grid2">
            <Field label="Team">
              <select value={f.to_team} onChange={(e) => setF({ ...f, to_team: e.target.value as Team, assignee_id: null })}>{TEAMS.map((x) => <option key={x}>{x}</option>)}</select>
            </Field>
            <Field label="Assignee">
              <select value={f.assignee_id ?? ''} onChange={(e) => setF({ ...f, assignee_id: e.target.value || null })}>
                <option value="">Anyone in {f.to_team}</option>
                {members.map((p) => <option key={p.id} value={p.id}>{p.full_name}</option>)}
              </select>
            </Field>
            <Field label="Priority">
              <select value={f.priority} onChange={(e) => setF({ ...f, priority: e.target.value as Task['priority'] })}>{PRIORITIES.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}</select>
            </Field>
            <Field label="Due date"><input type="date" value={f.due_date ?? ''} onChange={(e) => setF({ ...f, due_date: e.target.value || null })} /></Field>
          </div>
          <Field label="Details"><textarea rows={5} value={f.details ?? ''} onChange={(e) => setF({ ...f, details: e.target.value })} /></Field>
        </>
      ) : (
        <div className="kv">
          <div><span>Team</span>{t.to_team}</div>
          <div><span>Assignee</span>{t.assignee_id ? teamName(t.assignee_id) : `Anyone in ${t.to_team}`}</div>
          <div><span>Priority</span><PriorityTag p={t.priority} /></div>
          <div><span>Due</span><DueTag task={t} /></div>
          {t.details && <div className="kv-wide"><span>Details</span><p className="pre">{t.details}</p></div>}
        </div>
      )}
      {t.lead_name && (
        <div className="kv"><div><span>Lead</span>{canOpenLead && t.lead_id ? <Link to={`/leads/${t.lead_id}`} onClick={onClose}>{t.lead_name}</Link> : t.lead_name}</div></div>
      )}

      <div className="section-h">Comments</div>
      {comments.length === 0 && <div className="muted small" style={{ marginBottom: 10 }}>No comments yet.</div>}
      {comments.map((c) => (
        <div key={c.id} className="comment">
          <div className="c-head"><b>{teamName(c.author)}</b><span className="muted small">{fmtDateTime(c.created_at)}</span></div>
          <div className="pre">{c.body}</div>
        </div>
      ))}
      <div className="comment-box">
        <textarea rows={2} placeholder="Write a comment" value={comment} onChange={(e) => setComment(e.target.value)} />
        <button className="btn sm" disabled={!comment.trim()} onClick={async () => { await call('add_task_comment', { p_task: t.id, p_body: comment }, 'Comment added'); setComment(''); }}>Comment</button>
      </div>

      <div className="section-h">Activity</div>
      <ul className="tl compact">
        {events.map((e) => (
          <li key={e.id} className="tl-event">
            <div>{describe(e, teamName)}</div>
            <div className="when">{fmtDateTime(e.at)}{e.actor ? ` · ${teamName(e.actor)}` : ''}</div>
          </li>
        ))}
      </ul>

      {blocking && <BlockedModal onClose={() => setBlocking(false)} onConfirm={async (r) => {
        await call('set_task_status', { p_task: t.id, p_status: 'blocked', p_reason: r }, 'Marked blocked'); setBlocking(false);
      }} />}
    </Drawer>
  );
}

function describe(e: TaskEvent, name: (id: string | null) => string): string {
  switch (e.kind) {
    case 'created': return 'Task raised';
    case 'status': return `Moved from ${statusLabel(e.from_value as TaskStatus)} to ${statusLabel(e.to_value as TaskStatus)}${e.detail?.reason ? ` · ${e.detail.reason}` : ''}`;
    case 'assigned': return e.to_value ? `Assigned to ${name(e.to_value)}` : 'Unassigned (whole team)';
    case 'edited': {
      const field = e.detail?.field;
      if (field === 'team') return `Sent to ${e.to_value} (was ${e.from_value})`;
      if (field === 'due') return `Due date changed to ${e.to_value ? fmtDate(e.to_value) : 'none'}`;
      if (field === 'priority') return `Priority changed to ${e.to_value}`;
      return 'Edited';
    }
    default: return e.kind;
  }
}
