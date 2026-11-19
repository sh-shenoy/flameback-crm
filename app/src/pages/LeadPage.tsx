import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { useApp } from '../auth';
import { rpc, supabase } from '../lib/supabase';
import {
  addDays, fmtDate, fmtDateTime, fmtPhone, fmtTime, fromISTInput, istAt, istHHMM, toISTInput, todayIST,
} from '../lib/format';
import {
  BUCKETS, CALL_OUTCOMES, ENTRY_KINDS, stageLabel, STATUS_GROUPS, MESSAGE_PLATFORMS, PLATFORM_LABEL, VIDEO_PLATFORMS, entryLabel, type Platform, INCOME_BANDS, MARITAL, MESSAGE_OUTCOMES, OUTCOME_LABEL, PRODUCTS,
  RESIDENCY_LABEL, bucketLabel, contactState, holdingGap, isNewLead, type Bucket, type EntryKind, type Lead, type LeadEntry, type LeadEvent, type Outcome,
} from '../lib/types';
import { Drawer, StagePill, Empty, Field, Modal, Skeleton, Strikes, useToast } from '../components/ui';
import { LanguagePicker, Select } from '../components/AddLead';
import NotesCard from '../components/NotesCard';
import OnboardingCard, { fmtINR } from '../components/OnboardingCard';
import SummaryBox from '../components/SummaryBox';
import { DueTag, NewTaskModal, PriorityTag, StatusTag, TaskDrawer } from '../components/TaskParts';
import type { Task } from '../lib/types';
import { calcom, joinLabel, videoLabel, type CalEventType, type MeetingRow } from '../lib/calcom';

const ONBOARDING_ROUTE: Record<string, string> = {
  RIA: 'the Flameback app',
  PMS: 'Silver Bullet',
  'US RIA': 'the onboarding module (process to be decided)',
};

type LeadTab = 'onboarding' | 'timeline' | 'notes' | 'profile' | 'tasks';
type Dialog = null | 'email' | 'schedule' | 'cal_reschedule' | 'cal_cancel' | 'booking' | 'task' | 'entry' | 'reschedule' | 'bring_back' | 'stage';

export default function LeadPage() {
  const { id } = useParams();
  const { isAdmin, team, teamName, me, statuses } = useApp();
  const toast = useToast();
  const [lead, setLead] = useState<Lead | null>(null);
  const [entries, setEntries] = useState<LeadEntry[]>([]);
  const [events, setEvents] = useState<LeadEvent[]>([]);
  const [missing, setMissing] = useState(false);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [openTask, setOpenTask] = useState<string | null>(null);
  const [calEvent, setCalEvent] = useState<MeetingRow | null>(null);
  const [tab, setTab] = useState<LeadTab | null>(null);   // null = default for the stage
  useEffect(() => setTab(null), [id]);

  const load = useCallback(async () => {
    const [l, e, ev, tk] = await Promise.all([
      supabase.from('leads').select('*').eq('id', id!).maybeSingle(),
      supabase.from('lead_entries').select('*').eq('lead_id', id!).order('occurred_at', { ascending: false }),
      supabase.from('lead_events').select('*').eq('lead_id', id!).order('at', { ascending: false }),
      supabase.from('tasks').select('*').eq('lead_id', id!).order('created_at', { ascending: false }),
    ]);
    setTasks((tk.data as Task[]) ?? []);
    const { data: ce } = await supabase.from('meetings').select('*').eq('lead_id', id!).eq('status', 'active').eq('provider', 'calcom')
      .gt('start_time', new Date().toISOString()).order('start_time').limit(1);
    setCalEvent(((ce as MeetingRow[] | null) ?? [])[0] ?? null);
    if (!l.data) { setMissing(true); return; }
    setLead(l.data as Lead);
    setEntries((e.data as LeadEntry[]) ?? []);
    setEvents((ev.data as LeadEvent[]) ?? []);
  }, [id]);

  useEffect(() => { load(); }, [load]);

  // arriving from the calendar's "Schedule meeting"
  const [sp, setSp] = useSearchParams();
  useEffect(() => {
    if (sp.get('schedule') === '1' && lead) { if (!isAdmin) setDialog('schedule'); sp.delete('schedule'); setSp(sp, { replace: true }); }
  }, [sp, lead?.id]);

  // pull this lead's emails from Gmail when the page opens
  useEffect(() => {
    if (!me?.gmail_connected_at || !lead?.email) return;
    supabase.functions.invoke('gmail', { body: { action: 'sync', lead_id: lead.id } })
      .then(({ data }) => { if ((data as { added?: number } | null)?.added) load(); }, () => undefined);
  }, [lead?.id, lead?.email, me?.gmail_connected_at]);

  async function act(fn: string, args: Record<string, unknown>, msg: string) {
    try {
      await rpc(fn, { p_lead: id, ...args });
      toast(msg);
      setDialog(null);
      await load();
    } catch (e) {
      toast((e as Error).message, 'err');
    }
  }

  if (missing) return <div className="main-inner"><Empty>This lead doesn't exist or isn't in your book. <Link to="/leads">Back to leads</Link></Empty></div>;
  if (!lead) return <div className="main-inner"><Skeleton h={90} /><br /><Skeleton h={300} /></div>;

  const open = lead.bucket !== 'out' && lead.bucket !== 'converting' && lead.bucket !== 'client';
  const countsStrikes = ['active_contact', 'awaiting_meeting'].includes(lead.bucket);
  const cstate = contactState(lead);
  const bucketHelp = cstate === 'new'
    ? 'New lead: nobody has reached out yet. Log your first call or message.'
    : cstate === 'not_picked'
    ? `Not picked up yet${lead.strikes ? ` (${lead.strikes} of 5 attempts)` : ''}. Keep trying; once they pick up or reply it moves to Follow-up. Five unanswered attempts send it to the Out List.`
    : BUCKETS.find((b) => b.key === lead.bucket)?.help;

  return (
    <div className="main-inner">
      <div className="crumbs"><Link to="/leads">Leads</Link> / {lead.name}</div>

      {/* header */}
      <div className="panel lead-head">
        <div className="lh-top">
          <div>
            <h1>{lead.name} {isNewLead(lead) && <span className="new-badge">New</span>}</h1>
            <div className="lh-contact">
              {lead.phone && <a href={`tel:${lead.phone}`}>{fmtPhone(lead.phone)}</a>}
              {lead.alt_phone && <a href={`tel:${lead.alt_phone}`} title="Secondary number">{fmtPhone(lead.alt_phone)} <span className="muted small">(2nd)</span></a>}
              {lead.email && <a href={`mailto:${lead.email}`}>{lead.email}</a>}
              <span className="src">{lead.source}</span>
              {lead.campaign && <span className="muted small">Campaign: {lead.campaign}</span>}
              {lead.referred_by && <span className="muted small">Referred by {lead.referred_by}</span>}
            </div>
          </div>
          <div className="lh-right">
            <StagePill lead={lead} />
            {countsStrikes && <div className="small muted" style={{ marginTop: 6 }}><Strikes n={lead.strikes} /> {lead.strikes}/5</div>}
            {lead.bucket === 'holding' && <div className="small muted" style={{ marginTop: 6 }}>{(lead.holding_step ?? 0) === 0 ? 'No follow-ups yet' : `${lead.holding_step} follow-up${lead.holding_step === 1 ? '' : 's'} so far`} · next gap {holdingGap((lead.holding_step ?? 0) + 1)} days</div>}
          </div>
        </div>
        <div className="lh-grid">
          <div>
            <div className="k">Product</div>
            <select className="inline-select" value={lead.product} disabled={isAdmin}
              onChange={(e) => act('update_lead', { p: { product: e.target.value } }, `Product changed to ${e.target.value}`)}>
              {PRODUCTS.map((p) => <option key={p}>{p}</option>)}
            </select>
          </div>
          <div>
            <div className="k">Residency</div>
            <select className="inline-select" value={lead.residency ?? ''} disabled={isAdmin}
              onChange={(e) => act('set_residency', { p_residency: e.target.value || null }, e.target.value ? `Marked as ${RESIDENCY_LABEL[e.target.value]}` : 'Residency cleared')}>
              <option value="">Not set</option><option value="resident">Resident</option><option value="nri">NRI</option>
            </select>
          </div>
          <div>
            <div className="k">Next follow-up</div>
            {open && !isAdmin ? (
              <div className="row-gap fu-inline">
                <input type="date" className="inline-select" value={lead.next_follow_up ?? ''}
                  onChange={(e) => act('update_lead', { p: { next_follow_up: e.target.value } }, 'Follow-up date updated')} />
                <input type="time" className="inline-select" value={lead.next_follow_up_at ? istHHMM(lead.next_follow_up_at) : ''} disabled={!lead.next_follow_up}
                  title={lead.next_follow_up ? 'Time (IST): puts the follow-up on your calendar' : 'Pick a date first'}
                  onChange={(e) => e.target.value && act('set_follow_up', { p_at: istAt(lead.next_follow_up!, e.target.value) }, `Follow-up set for ${fmtDate(lead.next_follow_up)}, ${e.target.value}`)} />
              </div>
            ) : <span className={open ? '' : 'muted'}>{open ? <>{!lead.next_follow_up ? (isNewLead(lead) ? 'Not contacted yet' : 'Not set') : fmtDate(lead.next_follow_up)}{lead.next_follow_up_at && `, ${fmtTime(lead.next_follow_up_at)}`}</> : '—'}</span>}
          </div>
          {lead.bucket === 'awaiting_meeting' && (
            <div><div className="k">Meeting</div>{lead.meeting_at ? fmtDateTime(lead.meeting_at) : <span className="amber">Not booked yet</span>}
              {lead.meeting_url && <div><a href={lead.meeting_url} target="_blank" rel="noreferrer">{joinLabel(lead.meeting_url)}</a></div>}</div>
          )}
          {lead.bucket === 'deferred' && <div><div className="k">Returns on</div>{fmtDate(lead.deferred_until)}</div>}
          {lead.bucket !== 'awaiting_meeting' && calEvent && (
            <div><div className="k">Next meeting</div>{fmtDateTime(calEvent.start_time)}
              {calEvent.join_url && <div><a href={calEvent.join_url} target="_blank" rel="noreferrer">{joinLabel(calEvent.join_url)}</a></div>}</div>
          )}
          <div>
            <div className="k">RM</div>
            {isAdmin ? (
              <select className="inline-select" value={lead.rm_id}
                onChange={(e) => act('reassign_lead', { p_rm: e.target.value }, `Reassigned to ${teamName(e.target.value)}`)}>
                {team.filter((t) => (t.is_active && t.role !== 'admin') || t.id === lead.rm_id).map((t) => <option key={t.id} value={t.id}>{t.full_name}</option>)}
              </select>
            ) : teamName(lead.rm_id)}
          </div>
          <div><div className="k">Added</div>{fmtDate(lead.created_at)}</div>
          <div><div className="k">Last contact</div>{fmtDate(lead.last_contact_at)}</div>
          <div><div className="k">Lead status</div>
            {isAdmin ? (lead.lead_status ?? '—') : (
              <select className="inline-select" value={lead.lead_status ?? ''} title={lead.lead_status_at ? `Set ${fmtDateTime(lead.lead_status_at)}` : 'Usually set when you log a call'}
                onChange={(e) => act('set_lead_status', { p_status: e.target.value || null }, e.target.value ? `Lead status: ${e.target.value}` : 'Lead status cleared')}>
                <option value="">—</option>
                {STATUS_GROUPS.map((g) => <optgroup key={g.label} label={g.label}>{statuses.filter(g.test).map((x) => <option key={x.name}>{x.name}</option>)}</optgroup>)}
              </select>
            )}
          </div>
        </div>

        {lead.bucket === 'converting' && (
          <div className="banner ok">
            <b>Prospect since {fmtDate(lead.converted_at)}.</b> They agreed to join; work through the onboarding checklist below. {lead.product} accounts are opened in {ONBOARDING_ROUTE[lead.product] ?? 'the product platform'}.
            {!isAdmin && <button className="linkbtn" onClick={() => act('undo_converting', {}, 'Moved back to Holding period')}>Not joining after all?</button>}
          </div>
        )}
        {lead.bucket === 'client' && (
          <div className="banner ok">
            <b>Client since {fmtDate(lead.funded_at ?? null)}</b>{lead.funded_amount != null && <> · funded {fmtINR(lead.funded_amount)}</>}.
            {!isAdmin && <button className="linkbtn" onClick={() => act('undo_funded', {}, 'Moved back to Prospect')}>Undo</button>}
          </div>
        )}
        {lead.bucket === 'out' && (
          <div className="banner warn">
            <b>On the Out List</b> · {lead.out_reason} · {fmtDate(lead.out_at)} (was in {bucketLabel(lead.out_from_bucket ?? 'active_contact')})
          </div>
        )}

        {isAdmin ? (
          <div className="actions">
            <span className="muted small admin-note">You're viewing as an admin: reassign the lead (RM above) or raise a task. Calls, notes and stage changes are made by {teamName(lead.rm_id)}.</span>
            <button className="btn ghost" style={{ marginLeft: 'auto' }} onClick={() => setDialog('task')}>Raise task</button>
          </div>
        ) : (
          <div className="actions">
          {lead.bucket !== 'out' && <button className="btn" onClick={() => setDialog('entry')}>Log activity</button>}
          {lead.bucket === 'active_contact' && <>
            <button className="btn gold" onClick={() => setDialog('schedule')}>Schedule meeting</button>
          </>}
          {lead.bucket === 'awaiting_meeting' && <>
            {calEvent ? <>
              <button className="btn ghost" onClick={() => setDialog('cal_reschedule')}>Reschedule</button>
              <button className="btn ghost" onClick={() => setDialog('cal_cancel')}>Cancel meeting</button>
            </> : <>
              <button className="btn ghost" onClick={() => setDialog('schedule')}>Schedule on Cal.com</button>
              <button className="btn ghost" onClick={() => setDialog('reschedule')}>{lead.meeting_at ? 'Change time manually' : 'Set time manually'}</button>
            </>}
          </>}
          {(['holding', 'deferred', 'converting', 'client'] as Bucket[]).includes(lead.bucket) && (calEvent ? <>
            <button className="btn ghost" onClick={() => setDialog('cal_reschedule')}>Reschedule meeting</button>
            <button className="btn ghost" onClick={() => setDialog('cal_cancel')}>Cancel meeting</button>
          </> : <button className="btn ghost" onClick={() => setDialog('schedule')}>{lead.bucket === 'holding' ? 'Schedule follow-up meeting' : 'Schedule meeting'}</button>)}
          {lead.bucket === 'out' && <button className="btn" onClick={() => setDialog('bring_back')}>Bring back</button>}
          <button className="btn ghost" onClick={() => setDialog('stage')}>Change stage</button>
          <button className="btn ghost" style={{ marginLeft: 'auto' }} onClick={() => setDialog('email')}>Email</button>
          {lead.bucket !== 'out' && <button className="btn ghost" onClick={() => setDialog('booking')}>Send booking link</button>}
          <button className="btn ghost" onClick={() => setDialog('task')}>Raise task</button>
        </div>
        )}
        {bucketHelp && open && !isAdmin && <div className="stage-help">{bucketHelp}</div>}
      </div>

      <SummaryBox leadId={lead.id} version={`${lead.updated_at}:${entries.length}:${tasks.length}`} />

      {(() => {
        const onboarding = lead.bucket === 'converting' || lead.bucket === 'client';
        const openTasks = tasks.filter((t) => t.status !== 'done').length;
        const tabs: { key: LeadTab; label: string; n?: number }[] = [
          ...(onboarding ? [{ key: 'onboarding' as const, label: 'Onboarding' }] : []),
          { key: 'timeline', label: 'Timeline', n: entries.length },
          { key: 'notes', label: lead.general_notes ? 'Notes •' : 'Notes' },
          { key: 'profile', label: 'Profile' },
          { key: 'tasks', label: 'Tasks', n: openTasks },
        ];
        const cur: LeadTab = tab && tabs.some((t) => t.key === tab) ? tab : onboarding && lead.bucket === 'converting' ? 'onboarding' : 'timeline';
        return (
          <>
            <div className="tabs lead-tabs" role="tablist">
              {tabs.map((t) => (
                <button key={t.key} role="tab" aria-selected={cur === t.key} className={`tab ${cur === t.key ? 'on' : ''}`} onClick={() => setTab(t.key)}>
                  {t.label}{t.n ? <span className="tab-n">{t.n}</span> : null}
                </button>
              ))}
            </div>
            <div className="lead-tab-body" role="tabpanel">
              {cur === 'onboarding' && <OnboardingCard lead={lead} onChanged={load} readOnly={isAdmin} />}
              {cur === 'timeline' && <Timeline entries={entries} events={events} teamName={teamName} onChanged={load} readOnly={isAdmin} />}
              {cur === 'notes' && <NotesCard lead={lead} onSaved={load} readOnly={isAdmin} />}
              {cur === 'profile' && <ProfileCard lead={lead} onSaved={load} readOnly={isAdmin} />}
              {cur === 'tasks' && (
                <div className="panel">
                  <div className="panel-head"><h2>Tasks</h2>
                    <span className="row-gap"><span className="muted small">{openTasks} open</span>
                      <button className="btn ghost sm" onClick={() => setDialog('task')}>Raise task</button></span>
                  </div>
                  {tasks.length === 0 ? <Empty>No tasks about this lead yet.</Empty> : tasks.map((t) => (
                    <div key={t.id} className="task-row" onClick={() => setOpenTask(t.id)}>
                      <PriorityTag p={t.priority} />
                      <span className="tr-title">{t.title}<span className="muted small"> · {t.to_team}</span></span>
                      <DueTag task={t} />
                      <StatusTag s={t.status} />
                    </div>
                  ))}
                </div>
              )}
            </div>
          </>
        );
      })()}

      {(dialog === 'schedule' || dialog === 'cal_reschedule') && (
        <ScheduleMeetingDialog lead={lead} connected={!!me!.cal_connected_at} replaces={dialog === 'cal_reschedule' ? calEvent : null}
          onClose={() => setDialog(null)} onBooked={() => { setDialog(null); load(); setTimeout(load, 4000); setTimeout(load, 10000); }} />
      )}
      {dialog === 'cal_cancel' && calEvent && (
        <CancelMeetingDialog lead={lead} ev={calEvent} onClose={() => setDialog(null)} onDone={() => { setDialog(null); setTimeout(load, 3000); setTimeout(load, 8000); }} />
      )}
      {dialog === 'email' && <EmailDialog lead={lead} onClose={() => setDialog(null)} onSent={() => { setDialog(null); load(); }} />}
      {dialog === 'booking' && <BookingLinkDialog lead={lead} bookingUrl={me!.cal_url} rmName={me!.full_name ?? ''} onClose={() => setDialog(null)} />}
      {dialog === 'task' && <NewTaskModal lead={{ id: lead.id, name: lead.name }} onClose={() => setDialog(null)} onSaved={load} />}
      {openTask && <TaskDrawer id={openTask} onClose={() => setOpenTask(null)} onChanged={load} />}
      {dialog === 'entry' && <AddEntry lead={lead} onClose={() => setDialog(null)} onSaved={load} />}
      {dialog === 'reschedule' && <RescheduleDialog lead={lead} onClose={() => setDialog(null)} act={act} />}
      {dialog === 'bring_back' && <BringBackDialog lead={lead} onClose={() => setDialog(null)} act={act} />}
      {dialog === 'stage' && <ChangeStageDialog lead={lead} onClose={() => setDialog(null)} act={act} />}
    </div>
  );
}

type Act = (fn: string, args: Record<string, unknown>, msg: string) => Promise<void>;

/* ───────── profile ───────── */
function ProfileCard({ lead, onSaved, readOnly }: { lead: Lead; onSaved: () => void; readOnly?: boolean }) {
  const toast = useToast();
  const init = () => ({
    name: lead.name, phone: lead.phone ?? '', alt_phone: lead.alt_phone ?? '', email: lead.email ?? '', city: lead.city ?? '',
    age: lead.age?.toString() ?? '', marital_status: lead.marital_status ?? '', income_band: lead.income_band ?? '',
    language: lead.language ?? '', requirement: lead.requirement ?? '', budget: lead.budget ?? '',
    campaign: lead.campaign ?? '', referred_by: lead.referred_by ?? '',
  });
  const [f, setF] = useState(init);
  const [busy, setBusy] = useState(false);
  useEffect(() => setF(init()), [lead.updated_at]);
  const dirty = JSON.stringify(f) !== JSON.stringify(init());
  const set = (k: keyof ReturnType<typeof init>) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  const missing = ['city', 'age', 'marital_status', 'income_band', 'language'].filter((k) => !f[k as keyof typeof f]);

  async function save() {
    setBusy(true);
    try {
      await rpc('update_lead', { p_lead: lead.id, p: f });
      toast('Profile saved');
      onSaved();
    } catch (e) { toast((e as Error).message, 'err'); } finally { setBusy(false); }
  }

  return (
    <div className="panel">
      <div className="panel-head"><h2>Profile</h2>
        {missing.length > 0 && <span className="muted small">{missing.length} profile field{missing.length > 1 ? 's' : ''} to fill</span>}
      </div>
      <div className="pad">
        <fieldset className="plain-fs" disabled={readOnly}>
        <Field label="Name"><input value={f.name} onChange={set('name')} /></Field>
        <div className="grid2">
          <Field label="Phone"><input value={f.phone} onChange={set('phone')} inputMode="tel" /></Field>
          <Field label="Secondary phone"><input value={f.alt_phone} onChange={set('alt_phone')} inputMode="tel" placeholder="Optional" /></Field>
          <Field label="Email"><input value={f.email} onChange={set('email')} /></Field>
          <Field label="City / region"><input value={f.city} onChange={set('city')} /></Field>
          <Field label="Age"><input type="number" value={f.age} onChange={set('age')} /></Field>
          <Field label="Marital status"><Select v={f.marital_status} on={set('marital_status')} opts={MARITAL} /></Field>
          <Field label="Income level"><Select v={f.income_band} on={set('income_band')} opts={INCOME_BANDS} /></Field>
          <Field label="Budget"><input value={f.budget} onChange={set('budget')} /></Field>
          <Field label="Campaign"><input value={f.campaign} onChange={set('campaign')} /></Field>
          <Field label="Referred by"><input value={f.referred_by} onChange={set('referred_by')} /></Field>
        </div>
        <Field label="Languages"><LanguagePicker value={f.language} onChange={(v) => setF({ ...f, language: v })} /></Field>
        <Field label="What they want"><textarea value={f.requirement} onChange={set('requirement')} /></Field>
        </fieldset>
        {!readOnly && <div className="row-gap" style={{ justifyContent: 'flex-end' }}>
          {dirty && <button className="btn ghost sm" onClick={() => setF(init())}>Discard</button>}
          <button className="btn sm" disabled={!dirty || busy} onClick={save}>Save profile</button>
        </div>}
      </div>
    </div>
  );
}

/* ───────── timeline ───────── */
function Timeline({ entries, events, teamName, onChanged, readOnly }: {
  entries: LeadEntry[]; events: LeadEvent[]; teamName: (id: string | null) => string; onChanged: () => void; readOnly?: boolean;
}) {
  const toast = useToast();
  const items = useMemo(() => {
    const a = entries.map((e) => ({ at: e.occurred_at, e, ev: null as LeadEvent | null }));
    const b = events.filter((ev) => ev.kind !== 'strike').map((ev) => ({ at: ev.at, e: null as LeadEntry | null, ev }));
    return [...a, ...b].sort((x, y) => y.at.localeCompare(x.at));
  }, [entries, events]);

  async function markReplied(id: string) {
    try { await rpc('set_entry_outcome', { p_entry: id, p_outcome: 'replied' }); toast('Marked as replied · strikes reset'); onChanged(); }
    catch (e) { toast((e as Error).message, 'err'); }
  }

  return (
    <div className="panel">
      <div className="panel-head"><h2>Timeline</h2><span className="muted small">{entries.length} entr{entries.length === 1 ? 'y' : 'ies'}</span></div>
      <div className="pad">
        {items.length === 0 && <Empty>No activity yet.</Empty>}
        <ul className="tl">
          {items.map(({ e, ev, at }) => e ? (
            <li key={e.id} className="tl-entry">
              <div className="tl-row">
                <b>{entryLabel(e.kind, e.platform)}</b>
                {e.lead_status ? <span className={`outcome o-${e.outcome ?? 'none'}`}>{e.lead_status}</span> : e.outcome && <span className={`outcome o-${e.outcome}`}>{OUTCOME_LABEL[e.outcome]}</span>}
                {e.strike_state === 'counted' && <span className="strike-tag">Strike</span>}
                {e.strike_state === 'pending' && <>
                  <span className="strike-tag pending">Strike in 48h if no reply</span>
                  {!readOnly && <button className="linkbtn small" onClick={() => markReplied(e.id)}>They replied</button>}
                </>}
              </div>
              {e.notes && <div className="tl-notes">{e.notes}</div>}
              <div className="when">{fmtDateTime(at)} · {teamName(e.created_by)}{e.bucket_at !== 'active_contact' && ` · in ${bucketLabel(e.bucket_at)}`}</div>
            </li>
          ) : ev && (
            <li key={`ev${ev.id}`} className="tl-event">
              <div>{describeEvent(ev, teamName)}</div>
              <div className="when">{fmtDateTime(at)}{ev.actor ? ` · ${teamName(ev.actor)}` : ' · system'}</div>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function describeEvent(ev: LeadEvent, teamName: (id: string | null) => string): string {
  switch (ev.kind) {
    case 'created': return ev.detail?.via === 'upload' ? 'Lead added from an upload' : ev.detail?.via === 'calendly' ? 'Lead created from a Calendly booking' : ev.detail?.via === 'calcom' ? 'Lead created from a Cal.com booking' : 'Lead added';
    case 'assigned': {
      const why = (ev.detail?.reason as string) ?? '';
      return (ev.from_value ? `Reassigned from ${teamName(ev.from_value)} to ${teamName(ev.to_value)}` : `Assigned to ${teamName(ev.to_value)}`) + (why ? ` · ${why}` : '');
    }
    case 'bucket': {
      const reason = (ev.detail?.reason as string) ?? '';
      return `Moved from ${bucketLabel(ev.from_value as Bucket)} to ${bucketLabel(ev.to_value as Bucket)}${reason ? ` · ${reason}` : ''}`;
    }
    case 'meeting': return ev.from_value && ev.from_value !== '' ? `Meeting moved to ${fmtDateTime(ev.to_value)}` : `Meeting booked for ${fmtDateTime(ev.to_value)}`;
    case 'merged': return 'Duplicate details merged in';
    case 'edited': return `Product changed from ${ev.from_value} to ${ev.to_value}`;
    case 'status': return ev.to_value ? `Lead status set to ${ev.to_value}` : 'Lead status cleared';
    default: return ev.kind;
  }
}

/* ───────── add entry ───────── */
type Result = '' | 'met' | 'commits' | 'later' | 'contact' | 'interested';

function AddEntry({ lead, onClose, onSaved }: { lead: Lead; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [kind, setKind] = useState<EntryKind>('phone_call');
  const [when, setWhen] = useState(toISTInput(new Date().toISOString()));
  const [outcome, setOutcome] = useState<Outcome | ''>('');
  const { statuses } = useApp();
  const [status, setStatus] = useState('');
  const st = statuses.find((x) => x.name === status) ?? null;
  const videoDefault: Platform = lead.meeting_pref === 'zoom' ? 'zoom' : 'google-meet';
  const [platform, setPlatform] = useState<Platform | ''>('');
  const [result, setResult] = useState<Result>('');
  const [later, setLater] = useState('');
  const [product, setProduct] = useState(lead.product);
  const [notes, setNotes] = useState('');
  const [next, setNext] = useState('');
  const [nextTime, setNextTime] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const isCall = kind === 'phone_call' || kind === 'meet_call';
  const isMsg = kind === 'message' || kind === 'email';
  // calls: the lead status decides the outcome; messages keep Sent / Replied
  const outcomes = isCall && statuses.length ? [] : isCall ? CALL_OUTCOMES : isMsg ? MESSAGE_OUTCOMES : [];
  function pickStatus(name: string) {
    const x = statuses.find((y) => y.name === name);
    setStatus(name);
    if (!x) return;
    if (isCall) setOutcome(x.outcome);
    else if (x.outcome === 'not_interested') setOutcome('not_interested');
    setResult(x.name === 'Interested' && lead.bucket === 'active_contact' ? 'interested' : '');
  }
  // did they actually talk / reply? then ask where it left things (any open stage)
  const reached = kind === 'in_person' || (isCall && outcome === 'connected') || (isMsg && outcome === 'replied');
  const asksResult = reached && ['active_contact', 'awaiting_meeting', 'holding', 'deferred'].includes(lead.bucket);
  const notesRequired = outcome === 'connected' || kind === 'in_person' || kind === 'note' || !!result;
  // only the RM puts a lead into Follow-up: if this leaves it in New / Follow-up, ask for the date
  // a follow-up date is required only for the Follow-Up status; for every other status
  // (Warm-Up, Just Exploring…) and after no answer it's optional ("try again on")
  const spoke = kind === 'in_person' || outcome === 'connected' || outcome === 'replied' || outcome === 'call_back';
  const needsDate = status === 'Follow-Up' && outcome !== 'not_interested' && result !== 'commits' && result !== 'later';
  const tryAgain = lead.bucket === 'active_contact' && !spoke && (outcome === 'no_answer' || outcome === 'sent');

  const resultOptions: { key: Result; label: string; sub: string }[] = lead.bucket === 'deferred'
    ? [
        { key: '', label: 'Just a check-in', sub: `Stays deferred until ${fmtDate(lead.deferred_until)}` },
        { key: 'met', label: 'Ready to discuss again', sub: 'Moves to Holding period' },
        { key: 'commits', label: 'Agreed to join', sub: 'Becomes a prospect → onboarding checklist' },
        { key: 'later', label: 'Pushed to a new date', sub: 'Stays deferred, new return date' },
      ]
    : lead.bucket === 'active_contact'
    ? [
        { key: '', label: 'Just a conversation', sub: 'Stays in Active contact' },
        { key: 'interested', label: 'Wants to meet', sub: 'Moves to Awaiting meeting' },
        { key: 'met', label: 'Met / discussed, still thinking', sub: 'Moves to Holding period' },
        { key: 'commits', label: 'Agreed to join', sub: 'Becomes a prospect → onboarding checklist' },
        { key: 'later', label: 'Will commit later', sub: 'Deferred until a date' },
      ]
    : lead.bucket === 'awaiting_meeting'
    ? [
        { key: '', label: 'Just confirming the meeting', sub: 'Counts as a reminder' },
        { key: 'met', label: 'Met, still deciding', sub: 'Moves to Holding period' },
        { key: 'contact', label: 'Spoke, no meeting fixed', sub: 'Back to Active contact, no strike' },
        { key: 'commits', label: 'Agreed to join', sub: 'Becomes a prospect → onboarding checklist' },
        { key: 'later', label: 'Will commit later', sub: 'Deferred until a date' },
      ]
    : [
        { key: '', label: 'Still thinking', sub: `Next follow-up in ${holdingGap((lead.holding_step ?? 0) + 1)} days` },
        { key: 'commits', label: 'Agreed to join', sub: 'Becomes a prospect → onboarding checklist' },
        { key: 'later', label: 'Will commit later', sub: 'Deferred until a date' },
      ];

  const effect = (() => {
    if (st?.out_reason) return { tone: 'red', text: `Moves the lead to the Out List (${st.out_reason}).` };
    if (outcome === 'not_interested') return { tone: 'red', text: 'Moves the lead to the Out List.' };
    if (asksResult && result === 'met') return { tone: 'green', text: `Moves to Holding period. No strikes there: first follow-up in 7 days, then 14, 28…` };
    if (asksResult && result === 'interested') return { tone: 'green', text: 'Moves to Awaiting meeting; strikes reset. Book the time later with Schedule meeting.' };
    if (asksResult && result === 'contact') return { tone: 'green', text: 'Logs the conversation and moves the lead back to Active contact. No strike; strikes reset.' };
    if (asksResult && result === 'commits') return { tone: 'green', text: `Agreed to join: becomes a prospect (${product}) with an onboarding checklist.` };
    if (asksResult && result === 'later') return { tone: 'green', text: lead.bucket === 'deferred' ? 'Stays deferred with the new date; comes back to Holding then.' : 'Moves to Deferred; comes back to Holding on the date.' };
    if (lead.bucket === 'active_contact') {
      if (outcome === 'no_answer') return lead.strikes + 1 >= 5
        ? { tone: 'red', text: 'Fifth strike: the lead moves to the Out List.' }
        : { tone: 'amber', text: `Adds a strike (${lead.strikes} → ${lead.strikes + 1} of 5).` };
      if (outcome === 'sent') return { tone: 'amber', text: 'Becomes a strike if there is no reply within 48 hours.' };
      if ((outcome === 'connected' || outcome === 'replied' || kind === 'in_person') && lead.strikes > 0) return { tone: 'green', text: 'Resets strikes to 0.' };
    }
    if (lead.bucket === 'holding' && ((isCall || isMsg) && outcome || kind === 'in_person')) {
      const gap = holdingGap((lead.holding_step ?? 0) + 1);
      return { tone: 'green', text: next
        ? `Not a strike. Next follow-up on ${fmtDate(next)} (your date).`
        : `Not a strike. Next follow-up set to ${fmtDate(addDays(todayIST(), gap))}, in ${gap} days.` };
    }
    if (lead.bucket === 'awaiting_meeting' && (isCall || isMsg) && outcome) {
      return lead.strikes + 1 >= 5
        ? { tone: 'red', text: 'Fifth reminder without progress: the lead moves to the Out List.' }
        : { tone: 'amber', text: `Counts as reminder ${lead.strikes + 1} of 5.` };
    }
    return null;
  })();

  async function save() {
    if (kind === 'message' && !platform) { setErr('Pick where you messaged them'); return; }
    if (isCall && statuses.length && !status) { setErr('Pick the lead status'); return; }
    if ((isCall || isMsg) && !outcome) { setErr('Pick an outcome'); return; }
    if (notesRequired && !notes.trim()) { setErr('Notes are required for this entry'); return; }
    if (asksResult && result === 'later' && !later) { setErr('Pick the date they will come back'); return; }
    if (needsDate && !next) { setErr('Follow-Up needs a follow-up date'); return; }
    setBusy(true); setErr(null);
    try {
      await rpc('log_activity', {
        p_lead: lead.id, p_kind: kind, p_outcome: outcome || null, p_notes: notes || null,
        p_occurred_at: fromISTInput(when), p_next_follow_up: next || null,
        p_result: asksResult && result ? result : null,
        p_deferred_until: asksResult && result === 'later' ? later : null,
        p_product: asksResult && result === 'commits' ? product : null,
        p_platform: kind === 'meet_call' || kind === 'message' ? platform || null : null,
        p_status: kind !== 'note' && status ? status : null,
      });
      // a follow-up time puts it on the calendar
      if (next && nextTime && outcome !== 'not_interested' && result !== 'commits' && result !== 'later') {
        try { await rpc('set_follow_up', { p_lead: lead.id, p_at: istAt(next, nextTime) }); } catch { /* stage changed: no follow-up */ }
      }
      toast(asksResult && result === 'commits' ? 'Agreed to join · now a prospect'
        : asksResult && result === 'met' ? 'Moved to Holding period'
        : asksResult && result === 'contact' ? 'Logged · back in Follow-up'
        : asksResult && result === 'interested' ? 'Moved to Awaiting meeting'
        : asksResult && result === 'later' ? (lead.bucket === 'deferred' ? 'New return date saved' : 'Moved to Deferred') : 'Activity logged');
      onClose();
      onSaved();
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  }

  return (
    <Drawer title="Log activity" sub={`${lead.name} · ${stageLabel(lead)}`} onClose={onClose}
      footer={<><button className="btn ghost" onClick={onClose}>Cancel</button><button className="btn" disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Save'}</button></>}>
      <Field label="What happened" required>
        <div className="chips">
          {ENTRY_KINDS.map((k) => (
            <button key={k.key} className={`chip ${kind === k.key ? 'on' : ''}`} onClick={() => { setKind(k.key); setOutcome(''); setResult(''); setPlatform(k.key === 'meet_call' ? videoDefault : k.key === 'message' ? 'whatsapp' : ''); setStatus(''); }}>
              {k.label}
            </button>
          ))}
        </div>
      </Field>
      {(kind === 'meet_call' || kind === 'message') && (
        <Field label={kind === 'meet_call' ? 'Video call on' : 'Message on'} required>
          <div className="chips">
            {(kind === 'meet_call' ? VIDEO_PLATFORMS : MESSAGE_PLATFORMS).map((p) => (
              <button key={p} className={`chip ${platform === p ? 'on' : ''}`} onClick={() => setPlatform(p)}>{PLATFORM_LABEL[p]}</button>
            ))}
          </div>
        </Field>
      )}
      <Field label="Date and time (IST)" required><input type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} /></Field>
      {kind !== 'note' && statuses.length > 0 && (isCall ? (
        <Field label="Lead status" required>
          {STATUS_GROUPS.map((g) => {
            const list = statuses.filter(g.test);
            return list.length ? (
              <div key={g.label} className="status-group">
                <span className="status-group-label">{g.label}</span>
                <div className="chips">
                  {list.map((x) => (
                    <button key={x.name} className={`chip ${status === x.name ? 'on' : ''} ${x.outcome === 'not_interested' || x.out_reason ? 'chip-red' : ''}`} onClick={() => pickStatus(x.name)}>{x.name}</button>
                  ))}
                </div>
              </div>
            ) : null;
          })}
        </Field>
      ) : (
        <Field label="Lead status (optional)">
          <select value={status} onChange={(e) => pickStatus(e.target.value)}>
            <option value="">—</option>
            {STATUS_GROUPS.map((g) => <optgroup key={g.label} label={g.label}>{statuses.filter(g.test).map((x) => <option key={x.name}>{x.name}</option>)}</optgroup>)}
          </select>
        </Field>
      ))}
      {outcomes.length > 0 && (
        <Field label="Outcome" required>
          <div className="chips">
            {outcomes.map((o) => (
              <button key={o} className={`chip ${outcome === o ? 'on' : ''} ${o === 'not_interested' ? 'chip-red' : ''}`} onClick={() => { setOutcome(o); setResult(''); }}>
                {OUTCOME_LABEL[o]}
              </button>
            ))}
          </div>
        </Field>
      )}
      {asksResult && (
        <Field label="Where did this leave things?" required>
          <div className="result-list">
            {resultOptions.map((r) => (
              <button key={r.key || 'none'} className={result === r.key ? 'on' : ''} onClick={() => setResult(r.key)}>
                <b>{r.label}</b><span>{r.sub}</span>
              </button>
            ))}
          </div>
        </Field>
      )}
      {asksResult && result === 'commits' && (
        <Field label="Product">
          <select value={product} onChange={(e) => setProduct(e.target.value as Lead['product'])}>{PRODUCTS.map((p) => <option key={p}>{p}</option>)}</select>
        </Field>
      )}
      {asksResult && result === 'later' && (
        <Field label={lead.bucket === 'deferred' ? 'New return date' : 'Comes back on'} required><input type="date" min={addDays(todayIST(), 1)} value={later} onChange={(e) => setLater(e.target.value)} /></Field>
      )}
      {effect && <div className={`effect ${effect.tone}`}>{effect.text}</div>}
      <Field label="Notes" required={notesRequired}
        hint={kind === 'meet_call' ? `Paste the ${platform === 'zoom' ? 'Zoom' : 'Google Meet'} transcript here, or write what was discussed.` : undefined}>
        <textarea rows={7} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="What was discussed, concerns, decisions, next steps" />
      </Field>
      {outcome !== 'not_interested' && result !== 'commits' && result !== 'later' && (
        <Field label={tryAgain ? 'Try again on (optional)' : 'Next follow-up (date and time)'} required={needsDate}
          hint={lead.bucket === 'holding' || result === 'met' ? 'Leave blank to space it out automatically'
            : next ? 'With a time it goes on your calendar, with a reminder 5 minutes before.'
            : needsDate ? 'Required for the Follow-Up status: when should you call next?'
            : tryAgain ? 'The lead shows as Not picked up until they answer. Add a date to get a reminder.'
            : lead.next_follow_up ? `Currently ${fmtDate(lead.next_follow_up)}. Leave blank to keep it.` : 'Optional.'}>
          <div className="row-gap">
            <input type="date" min={todayIST()} value={next} onChange={(e) => { setNext(e.target.value); if (e.target.value && !nextTime) setNextTime('11:00'); }} />
            <input type="time" value={nextTime} disabled={!next} onChange={(e) => setNextTime(e.target.value)} aria-label="Follow-up time" />
            {[1, 2, 7].map((d) => <button key={d} className="chip" onClick={() => { setNext(addDays(todayIST(), d)); if (!nextTime) setNextTime('11:00'); }}>+{d}d</button>)}
          </div>
        </Field>
      )}
      {err && <div className="form-err">{err}</div>}
    </Drawer>
  );
}

/* ───────── bucket dialogs ───────── */
function useBusy() {
  const [busy, setBusy] = useState(false);
  const run = async (fn: () => Promise<void>) => { setBusy(true); try { await fn(); } catch { /* toast shown */ } finally { setBusy(false); } };
  return { busy, run };
}

function RescheduleDialog({ lead, onClose, act }: { lead: Lead; onClose: () => void; act: Act }) {
  const [when, setWhen] = useState(toISTInput(lead.meeting_at));
  const { busy, run } = useBusy();
  return (
    <Modal title={lead.meeting_at ? 'Reschedule meeting' : 'Set meeting time'} onClose={onClose}
      footer={<><button className="btn ghost" onClick={onClose}>Cancel</button>
        <button className="btn" disabled={busy || !when} onClick={() => run(() => act('set_meeting', { p_meeting_at: fromISTInput(when) }, 'Meeting time saved'))}>Save</button></>}>
      <Field label="Meeting date and time (IST)" required><input type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} /></Field>
    </Modal>
  );
}

export function BringBackDialog({ lead, onClose, act }: { lead: Lead; onClose: () => void; act: Act }) {
  const [d, setD] = useState(addDays(todayIST(), 1));
  const { busy, run } = useBusy();
  const to = lead.out_from_bucket && ['active_contact', 'awaiting_meeting', 'holding'].includes(lead.out_from_bucket) ? lead.out_from_bucket : 'active_contact';
  return (
    <Modal title={`Bring back ${lead.name}`} onClose={onClose}
      footer={<><button className="btn ghost" onClick={onClose}>Cancel</button>
        <button className="btn" disabled={busy || !d} onClick={() => run(() => act('bring_back', { p_next_follow_up: d }, `Back in ${bucketLabel(to)}`))}>Bring back</button></>}>
      <p className="muted" style={{ marginBottom: 12 }}>Strikes reset to 0 and the lead returns to <b>{bucketLabel(to)}</b>.</p>
      <Field label="Next follow-up" required><input type="date" min={todayIST()} value={d} onChange={(e) => setD(e.target.value)} /></Field>
    </Modal>
  );
}


const STAGE_EFFECT: Record<Bucket, string> = {
  active_contact: 'Strikes reset. Goes to Follow-up on the date you pick.',
  awaiting_meeting: 'Strikes reset. Use this when they agreed to meet but the time isn\'t fixed; book it later with Schedule meeting.',
  holding: 'Met, still thinking. No strikes; follow-ups spaced out automatically (first in 7 days).',
  deferred: 'Comes back to Holding period on the date you pick.',
  converting: 'Agreed to join: becomes a prospect and gets an onboarding checklist.',
  client: 'Funded (use Mark as funded on the checklist).',
  out: 'Moves to the Out List and follow-ups stop. It can be brought back later.',
};

function ChangeStageDialog({ lead, onClose, act }: { lead: Lead; onClose: () => void; act: Act }) {
  const [to, setTo] = useState<Bucket | ''>('');
  const [note, setNote] = useState('');
  const [next, setNext] = useState('');
  const [until, setUntil] = useState('');
  const [product, setProduct] = useState(lead.product);
  const { busy, run } = useBusy();
  const choices = BUCKETS.filter((b) => b.key !== lead.bucket && b.key !== 'client');
  const ok = !!to && (to !== 'deferred' || !!until) && (to !== 'active_contact' || !!next);
  return (
    <Modal title={`Change stage · ${lead.name}`} onClose={onClose}
      footer={<><button className="btn ghost" onClick={onClose}>Cancel</button>
        <button className={`btn ${to === 'out' ? 'danger' : ''}`} disabled={busy || !ok} onClick={() => run(() => act('set_bucket', {
          p_to: to, p_note: note.trim() || null,
          p_next_follow_up: (to === 'active_contact' || to === 'awaiting_meeting' || to === 'holding') && next ? next : null,
          p_deferred_until: to === 'deferred' ? until : null,
          p_product: to === 'converting' ? product : null,
        }, `Moved to ${bucketLabel(to as Bucket)}`))}>{to ? `Move to ${bucketLabel(to)}` : 'Move'}</button></>}>
      <p className="muted" style={{ marginBottom: 12 }}>Now <b>{stageLabel(lead)}</b>. To record a conversation, use Log activity instead; this only moves the lead.</p>
      <Field label="Move to" required>
        <div className="result-list">
          {choices.map((b) => (
            <button key={b.key} className={to === b.key ? 'on' : ''} onClick={() => setTo(b.key)}>
              <b>{b.label}</b><span>{STAGE_EFFECT[b.key]}</span>
            </button>
          ))}
        </div>
      </Field>
      {(to === 'active_contact' || to === 'awaiting_meeting' || to === 'holding') && (
        <Field label="Next follow-up" required={to === 'active_contact'} hint={to === 'holding' ? 'Leave blank for 7 days' : to === 'awaiting_meeting' ? 'Leave blank for tomorrow' : 'Pick when to follow up'}>
          <div className="row-gap">
            <input type="date" min={todayIST()} value={next} onChange={(e) => setNext(e.target.value)} />
            {[1, 2, 7].map((d) => <button key={d} className="chip" onClick={() => setNext(addDays(todayIST(), d))}>+{d}d</button>)}
          </div>
        </Field>
      )}
      {to === 'deferred' && (
        <Field label="Comes back on" required><input type="date" min={addDays(todayIST(), 1)} value={until} onChange={(e) => setUntil(e.target.value)} /></Field>
      )}
      {to === 'converting' && (
        <Field label="Product"><select value={product} onChange={(e) => setProduct(e.target.value as Lead['product'])}>{PRODUCTS.map((p) => <option key={p}>{p}</option>)}</select></Field>
      )}
      {to && <Field label="Why (optional)" hint="Saved as a note on the timeline"><textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} /></Field>}
    </Modal>
  );
}

/* ───────── Cal.com booking link ───────── */
function BookingLinkDialog({ lead, bookingUrl, rmName, onClose }: { lead: Lead; bookingUrl: string | null; rmName: string; onClose: () => void }) {
  const toast = useToast();
  if (!bookingUrl) {
    return (
      <Modal title="Send booking link" onClose={onClose}
        footer={<><button className="btn ghost" onClick={onClose}>Close</button><Link className="btn" to="/connections" onClick={onClose}>Connect Cal.com</Link></>}>
        <p>Connect your Cal.com first (Connections → Cal.com). After that, this button gives you a link with {lead.name}'s details already filled in.</p>
      </Modal>
    );
  }
  // Cal.com fills the form from name / email, and passes metadata[...] through to the booking
  const params = new URLSearchParams({ name: lead.name, 'metadata[lead_id]': lead.id });
  if (lead.email) params.set('email', lead.email);
  const link = `${bookingUrl}${bookingUrl.includes('?') ? '&' : '?'}${params.toString()}`;
  const first = lead.name.split(' ')[0];
  const message = `Hi ${first}, thank you for your time. Please pick a slot that suits you for a short call: ${link}\n\n${rmName}, Flameback Capital`;
  const waNumber = lead.phone ? (/^\d{10}$/.test(lead.phone) ? '91' + lead.phone : lead.phone.replace(/\D/g, '')) : '';
  const copy = async (text: string, what: string) => {
    try { await navigator.clipboard.writeText(text); toast(`${what} copied`); } catch { toast('Couldn\'t copy. Select the text and copy it.', 'err'); }
  };
  return (
    <Modal title={`Send ${first} your booking link`} onClose={onClose} wide
      footer={<button className="btn ghost" onClick={onClose}>Done</button>}>
      <p className="muted" style={{ marginBottom: 12 }}>
        When {first} books through this link, the CRM matches it to this lead and moves it to <b>Awaiting meeting</b> with the time and meeting link.
      </p>
      <Field label="Link (name and email already filled in)">
        <div className="row-gap"><input readOnly value={link} onFocus={(e) => e.target.select()} /><button className="btn ghost sm" onClick={() => copy(link, 'Link')}>Copy link</button></div>
      </Field>
      <Field label="Message">
        <textarea readOnly rows={4} value={message} onFocus={(e) => e.target.select()} />
      </Field>
      <div className="row-gap">
        <button className="btn ghost" onClick={() => copy(message, 'Message')}>Copy message</button>
        {waNumber && <a className="btn ghost" href={`https://wa.me/${waNumber}?text=${encodeURIComponent(message)}`} target="_blank" rel="noreferrer">Open in WhatsApp</a>}
        {lead.email && <a className="btn ghost" href={`mailto:${lead.email}?subject=${encodeURIComponent('Scheduling a call with Flameback Capital')}&body=${encodeURIComponent(message)}`}>Open in email</a>}
      </div>
    </Modal>
  );
}

/* ───────── schedule a Cal.com meeting from the CRM ───────── */
function ScheduleMeetingDialog({ lead, connected, replaces, onClose, onBooked }: {
  lead: Lead; connected: boolean; replaces: MeetingRow | null; onClose: () => void; onBooked: () => void;
}) {
  const { team, me } = useApp();
  const toast = useToast();
  const [types, setTypes] = useState<CalEventType[] | null>(null);
  const [type, setType] = useState('');
  const [day, setDay] = useState(addDays(todayIST(), 1));
  const [slots, setSlots] = useState<string[] | null>(null);
  const [slot, setSlot] = useState('');
  const [email, setEmail] = useState(lead.email ?? '');
  const [guests, setGuests] = useState<string[]>([]);
  const [guestInput, setGuestInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [loc, setLoc] = useState('');
  // every Flameback meeting type offers Google Meet and Zoom; use the type's own list when Cal.com reports one
  const reported = types?.find((t) => String(t.id) === type)?.locations ?? [];
  const typeLocs = reported.length ? reported : ['google-meet', 'zoom'];

  // pick the lead's preferred video app when this meeting type offers it, else the type's first
  useEffect(() => {
    if (!typeLocs.length) { setLoc(''); return; }
    setLoc(lead.meeting_pref && typeLocs.includes(lead.meeting_pref) ? lead.meeting_pref : typeLocs[0]!);
  }, [type, types]);   // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!connected) return;
    calcom<{ event_types: CalEventType[] }>({ action: 'event_types' })
      .then((r) => { setTypes(r.event_types); if (r.event_types.length === 1) setType(String(r.event_types[0]!.id)); })
      .catch((e) => setErr((e as Error).message));
  }, [connected]);

  useEffect(() => {
    if (!type || !day) return;
    setSlots(null); setSlot(''); setErr(null);
    calcom<{ slots: string[] }>({ action: 'slots', event_type_id: type, date: day })
      .then((r) => setSlots(r.slots))
      .catch((e) => { setSlots([]); setErr((e as Error).message); });
  }, [type, day]);

  function addGuest(v: string) {
    const g = v.trim().toLowerCase();
    if (!g) return;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(g)) { setErr(`"${v}" isn't a valid email`); return; }
    if (!guests.includes(g)) setGuests([...guests, g]);
    setGuestInput(''); setErr(null);
  }

  async function book() {
    setBusy(true); setErr(null);
    try {
      await calcom({ action: 'book', lead_id: lead.id, event_type_id: type, start_time: slot, email, guests, ...(type && loc ? { location: loc } : {}) });
      if (replaces) {
        try { await calcom({ action: 'cancel', lead_id: lead.id, booking_uid: replaces.booking_uid, reason: 'Rescheduled' }); }
        catch (e) { toast(`New time booked, but the old meeting couldn't be cancelled: ${(e as Error).message}`, 'err'); }
      }
      toast(replaces ? 'Meeting rescheduled · Cal.com is sending the new invite' : 'Meeting booked · Cal.com is sending the invites');
      onBooked();
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  }

  if (!connected) {
    return (
      <Modal title="Schedule meeting" onClose={onClose}
        footer={<><button className="btn ghost" onClick={onClose}>Close</button><Link className="btn" to="/connections" onClick={onClose}>Connect Cal.com</Link></>}>
        <p>Connect your Cal.com first (Connections → Cal.com) to book meetings from here.</p>
      </Modal>
    );
  }
  const colleagues = team.filter((t) => t.is_active && t.id !== me!.id && !guests.includes(t.email));
  const selectedType = types?.find((t) => String(t.id) === type);
  return (
    <Modal title={replaces ? `Reschedule meeting with ${lead.name}` : `Schedule a meeting with ${lead.name}`} onClose={onClose} wide
      footer={<>
        <span className="muted small" style={{ marginRight: 'auto' }}>Cal.com emails the invite{guests.length ? 's' : ''} with the {loc ? videoLabel(loc) : 'meeting'} link.</span>
        <button className="btn ghost" onClick={onClose}>Cancel</button>
        <button className="btn" disabled={busy || !slot || !email} onClick={book}>{busy ? 'Booking…' : replaces ? 'Book new time' : 'Book meeting'}</button>
      </>}>
      {replaces && <div className="banner">Currently booked for <b>{fmtDateTime(replaces.start_time)}</b>. Booking a new time cancels this one.</div>}
      <div className="grid2">
        <Field label="Meeting type" required>
          <select value={type} onChange={(e) => setType(e.target.value)} disabled={!types}>
            <option value="">{types ? 'Select…' : 'Loading…'}</option>
            {types?.map((t) => <option key={t.id} value={String(t.id)}>{t.title}{t.length ? ` · ${t.length} min` : ''}</option>)}
          </select>
        </Field>
        <Field label="Date" required><input type="date" min={todayIST()} value={day} onChange={(e) => setDay(e.target.value)} /></Field>
      </div>
      {type && typeLocs.length > 1 && (
        <Field label="Meet on" hint={lead.meeting_pref ? `Last time: ${videoLabel(lead.meeting_pref)}` : 'Remembered for this lead next time'}>
          <div className="chips">{typeLocs.map((l) => <button key={l} className={`chip ${loc === l ? 'on' : ''}`} onClick={() => setLoc(l)}>{videoLabel(l)}</button>)}</div>
        </Field>
      )}
      {typeLocs.length === 1 && type && <p className="muted small" style={{ margin: '-4px 0 10px' }}>This meeting type is on {videoLabel(typeLocs[0]!)}.</p>}
      {types && types.length === 0 && <div className="banner warn">You have no event types in Cal.com. Create one (e.g. "Intro call" with Google Meet) and reopen this.</div>}
      {type && (
        <Field label={`Available times (IST)${selectedType?.length ? ` · ${selectedType.length} min` : ''}`} required>
          {slots === null ? <div className="muted small">Loading your free slots…</div>
            : slots.length === 0 ? <div className="muted small">No free slots on {fmtDate(day)}. Try another date.</div>
            : <div className="chips">{slots.map((s2) => <button key={s2} className={`chip ${slot === s2 ? 'on' : ''}`} onClick={() => setSlot(s2)}>{fmtTime(s2)}</button>)}</div>}
        </Field>
      )}
      <div className="grid2">
        <Field label="Client" hint="Cal.com sends the invite to this email."><input value={lead.name} readOnly /></Field>
        <Field label="Client email" required><input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Needed for the invite" /></Field>
      </div>
      <Field label="Other invitees" hint="Colleagues or anyone else, e.g. the client's spouse. Up to 10.">
        <div className="row-gap">
          <input placeholder="Type an email and press Enter" value={guestInput} onChange={(e) => setGuestInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); addGuest(guestInput); } }} onBlur={() => guestInput && addGuest(guestInput)} />
          {colleagues.length > 0 && (
            <select className="filter" value="" onChange={(e) => e.target.value && addGuest(e.target.value)}>
              <option value="">Add a colleague…</option>
              {colleagues.map((t) => <option key={t.id} value={t.email}>{t.full_name}</option>)}
            </select>
          )}
        </div>
        {guests.length > 0 && <div className="chips" style={{ marginTop: 8 }}>{guests.map((g) => (
          <span key={g} className="chip on">{g} <button className="chip-x" onClick={() => setGuests(guests.filter((x) => x !== g))} aria-label={`Remove ${g}`}>×</button></span>
        ))}</div>}
      </Field>
      {err && <div className="form-err">{err}</div>}
    </Modal>
  );
}

function CancelMeetingDialog({ lead, ev, onClose, onDone }: { lead: Lead; ev: MeetingRow; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  return (
    <Modal title="Cancel meeting" onClose={onClose}
      footer={<><button className="btn ghost" onClick={onClose}>Keep it</button>
        <button className="btn danger" disabled={busy} onClick={async () => {
          setBusy(true); setErr(null);
          try { await calcom({ action: 'cancel', lead_id: lead.id, booking_uid: ev.booking_uid, reason }); toast('Meeting cancelled · Cal.com is notifying everyone'); onDone(); }
          catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
        }}>Cancel meeting</button></>}>
      <p style={{ marginBottom: 12 }}>Cancels <b>{ev.event_name ?? 'the meeting'}</b> on <b>{fmtDateTime(ev.start_time)}</b> in Cal.com. Everyone invited gets a cancellation email, and the lead gets a follow-up for today.</p>
      <Field label="Reason (shared with the client)"><textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Something came up, I'll send new times shortly" /></Field>
      {err && <div className="form-err">{err}</div>}
    </Modal>
  );
}

/* ───────── email from the RM's Gmail ───────── */
function EmailDialog({ lead, onClose, onSent }: { lead: Lead; onClose: () => void; onSent: () => void }) {
  const { me } = useApp();
  const toast = useToast();
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState(`Hi ${lead.name.split(' ')[0]},\n\n\n\nRegards,\n${me!.full_name ?? ''}\nFlameback Capital`);
  const [cc, setCc] = useState('');
  const [thread, setThread] = useState<{ thread_id: string; subject: string | null } | null>(null);
  const [reply, setReply] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    supabase.from('gmail_messages').select('thread_id, subject, sent_at').eq('lead_id', lead.id).order('sent_at', { ascending: false }).limit(1)
      .then(({ data }) => {
        const t = (data as { thread_id: string; subject: string | null }[] | null)?.[0];
        if (t?.thread_id) { setThread(t); setSubject(t.subject?.startsWith('Re:') ? t.subject : `Re: ${t.subject ?? ''}`); }
      });
  }, [lead.id]);

  if (!me!.gmail_connected_at) {
    return (
      <Modal title="Email" onClose={onClose}
        footer={<><button className="btn ghost" onClick={onClose}>Close</button><Link className="btn" to="/connections" onClick={onClose}>Connect Gmail</Link></>}>
        <p>Connect your Gmail first (Connections → Gmail). Emails then go from your own address, and replies appear on the lead's timeline.</p>
      </Modal>
    );
  }
  if (!lead.email) {
    return (
      <Modal title="Email" onClose={onClose} footer={<button className="btn ghost" onClick={onClose}>Close</button>}>
        <p>{lead.name} has no email address. Add it in the Profile section first.</p>
      </Modal>
    );
  }
  async function send() {
    setBusy(true); setErr(null);
    try {
      const { data, error } = await supabase.functions.invoke('gmail', { body: {
        action: 'send', lead_id: lead.id, subject, body,
        cc: cc.split(/[,;\s]+/).filter(Boolean), thread_id: thread && reply ? thread.thread_id : null,
      } });
      let msg = (data as { error?: string } | null)?.error;
      if (!msg && error) { try { msg = (await (error as { context?: Response }).context?.clone().json())?.error; } catch { /* ignore */ } msg = msg || error.message; }
      if (msg) { setErr(msg); return; }
      toast(`Email sent to ${lead.email}`);
      onSent();
    } finally { setBusy(false); }
  }
  return (
    <Modal title={`Email ${lead.name}`} onClose={onClose} wide
      footer={<>
        <span className="muted small" style={{ marginRight: 'auto' }}>From {me!.gmail_address}</span>
        <button className="btn ghost" onClick={onClose}>Cancel</button>
        <button className="btn" disabled={busy || !subject.trim() || !body.trim()} onClick={send}>{busy ? 'Sending…' : 'Send'}</button>
      </>}>
      <div className="grid2">
        <Field label="To"><input value={`${lead.name} <${lead.email}>`} readOnly /></Field>
        <Field label="Cc" hint="Optional, separate with commas"><input value={cc} onChange={(e) => setCc(e.target.value)} /></Field>
      </div>
      {thread && (
        <label className="check" style={{ marginBottom: 12 }}>
          <input type="checkbox" checked={reply} onChange={(e) => { setReply(e.target.checked); if (!e.target.checked) setSubject(''); else setSubject(thread.subject?.startsWith('Re:') ? thread.subject : `Re: ${thread.subject ?? ''}`); }} />
          Reply in your last conversation ("{thread.subject ?? 'no subject'}")
        </label>
      )}
      <Field label="Subject" required><input value={subject} onChange={(e) => setSubject(e.target.value)} /></Field>
      <Field label="Message" required><textarea rows={10} value={body} onChange={(e) => setBody(e.target.value)} /></Field>
      {err && <div className="form-err">{err}</div>}
    </Modal>
  );
}
