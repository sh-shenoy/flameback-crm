import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useApp } from '../auth';
import { rpc, supabase } from '../lib/supabase';
import {
  addDays, fmtDate, fmtDateTime, fmtPhone, fromISTInput, toISTInput, todayIST,
} from '../lib/format';
import {
  BUCKETS, CALL_OUTCOMES, ENTRY_KINDS, INCOME_BANDS, LANGUAGES, MARITAL, MESSAGE_OUTCOMES, OUTCOME_LABEL, PRODUCTS,
  bucketLabel, type Bucket, type EntryKind, type Lead, type LeadEntry, type LeadEvent, type Outcome,
} from '../lib/types';
import { BucketPill, Drawer, Empty, Field, Modal, Skeleton, Strikes, useToast } from '../components/ui';
import { Select } from '../components/AddLead';

const ONBOARDING_ROUTE: Record<string, string> = {
  RIA: 'the Flameback app',
  PMS: 'Silver Bullet',
};

type Dialog = null | 'entry' | 'interested' | 'meeting' | 'reschedule' | 'defer' | 'commit' | 'not_interested' | 'bring_back';

export default function LeadPage() {
  const { id } = useParams();
  const { isAdmin, team, teamName } = useApp();
  const toast = useToast();
  const [lead, setLead] = useState<Lead | null>(null);
  const [entries, setEntries] = useState<LeadEntry[]>([]);
  const [events, setEvents] = useState<LeadEvent[]>([]);
  const [missing, setMissing] = useState(false);
  const [dialog, setDialog] = useState<Dialog>(null);

  const load = useCallback(async () => {
    const [l, e, ev] = await Promise.all([
      supabase.from('leads').select('*').eq('id', id!).maybeSingle(),
      supabase.from('lead_entries').select('*').eq('lead_id', id!).order('occurred_at', { ascending: false }),
      supabase.from('lead_events').select('*').eq('lead_id', id!).order('at', { ascending: false }),
    ]);
    if (!l.data) { setMissing(true); return; }
    setLead(l.data as Lead);
    setEntries((e.data as LeadEntry[]) ?? []);
    setEvents((ev.data as LeadEvent[]) ?? []);
  }, [id]);

  useEffect(() => { load(); }, [load]);

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

  const open = lead.bucket !== 'out' && lead.bucket !== 'converting';
  const countsStrikes = ['active_contact', 'awaiting_meeting', 'holding'].includes(lead.bucket);
  const bucketHelp = BUCKETS.find((b) => b.key === lead.bucket)?.help;

  return (
    <div className="main-inner">
      <div className="crumbs"><Link to="/leads">Leads</Link> / {lead.name}</div>

      {/* header */}
      <div className="panel lead-head">
        <div className="lh-top">
          <div>
            <h1>{lead.name} {entries.length === 0 && open && <span className="new-badge">New</span>}</h1>
            <div className="lh-contact">
              {lead.phone && <a href={`tel:${lead.phone}`}>{fmtPhone(lead.phone)}</a>}
              {lead.email && <a href={`mailto:${lead.email}`}>{lead.email}</a>}
              <span className="src">{lead.source}</span>
              {lead.campaign && <span className="muted small">Campaign: {lead.campaign}</span>}
              {lead.referred_by && <span className="muted small">Referred by {lead.referred_by}</span>}
            </div>
          </div>
          <div className="lh-right">
            <BucketPill bucket={lead.bucket} />
            {countsStrikes && <div className="small muted" style={{ marginTop: 6 }}><Strikes n={lead.strikes} /> {lead.strikes}/5</div>}
          </div>
        </div>
        <div className="lh-grid">
          <div>
            <div className="k">Product</div>
            <select className="inline-select" value={lead.product}
              onChange={(e) => act('update_lead', { p: { product: e.target.value } }, `Product changed to ${e.target.value}`)}>
              {PRODUCTS.map((p) => <option key={p}>{p}</option>)}
            </select>
          </div>
          <div>
            <div className="k">Next follow-up</div>
            {open ? (
              <input type="date" className="inline-select" value={lead.next_follow_up ?? ''}
                onChange={(e) => act('update_lead', { p: { next_follow_up: e.target.value } }, 'Follow-up date updated')} />
            ) : <span className="muted">—</span>}
          </div>
          {lead.bucket === 'awaiting_meeting' && (
            <div><div className="k">Meeting</div>{lead.meeting_at ? fmtDateTime(lead.meeting_at) : <span className="amber">Not booked yet</span>}</div>
          )}
          {lead.bucket === 'deferred' && <div><div className="k">Returns on</div>{fmtDate(lead.deferred_until)}</div>}
          <div>
            <div className="k">RM</div>
            {isAdmin ? (
              <select className="inline-select" value={lead.rm_id}
                onChange={(e) => act('reassign_lead', { p_rm: e.target.value }, `Reassigned to ${teamName(e.target.value)}`)}>
                {team.filter((t) => t.is_active || t.id === lead.rm_id).map((t) => <option key={t.id} value={t.id}>{t.full_name}</option>)}
              </select>
            ) : teamName(lead.rm_id)}
          </div>
          <div><div className="k">Added</div>{fmtDate(lead.created_at)}</div>
          <div><div className="k">Last contact</div>{fmtDate(lead.last_contact_at)}</div>
        </div>

        {lead.bucket === 'converting' && (
          <div className="banner ok">
            <b>Committed {fmtDate(lead.converted_at)}.</b> {lead.product} onboarding happens in {ONBOARDING_ROUTE[lead.product] ?? 'the onboarding module'}.
            The onboarding module is coming soon; this lead now waits there.
            <button className="linkbtn" onClick={() => act('undo_converting', {}, 'Moved back to Holding period')}>Undo</button>
          </div>
        )}
        {lead.bucket === 'out' && (
          <div className="banner warn">
            <b>On the Out List</b> · {lead.out_reason} · {fmtDate(lead.out_at)} (was in {bucketLabel(lead.out_from_bucket ?? 'active_contact')})
          </div>
        )}

        <div className="actions">
          {open && <button className="btn" onClick={() => setDialog('entry')}>Add entry</button>}
          {lead.bucket === 'active_contact' && <button className="btn gold" onClick={() => setDialog('interested')}>Interested → book meeting</button>}
          {lead.bucket === 'awaiting_meeting' && <>
            <button className="btn gold" onClick={() => setDialog('meeting')}>Record meeting</button>
            <button className="btn ghost" onClick={() => setDialog('reschedule')}>{lead.meeting_at ? 'Reschedule' : 'Set meeting time'}</button>
          </>}
          {lead.bucket === 'holding' && <>
            <button className="btn gold" onClick={() => setDialog('commit')}>Commits</button>
            <button className="btn ghost" onClick={() => setDialog('meeting')}>Record another meeting</button>
          </>}
          {lead.bucket === 'deferred' && <button className="btn gold" onClick={() => setDialog('commit')}>Commits now</button>}
          {(lead.bucket === 'holding' || lead.bucket === 'awaiting_meeting') && <button className="btn ghost" onClick={() => setDialog('defer')}>Defer</button>}
          {open && <button className="btn ghost danger-text" onClick={() => setDialog('not_interested')}>Not interested</button>}
          {lead.bucket === 'out' && <button className="btn" onClick={() => setDialog('bring_back')}>Bring back</button>}
        </div>
        {bucketHelp && open && <div className="stage-help">{bucketHelp}</div>}
      </div>

      <div className="lead-cols">
        <ProfileCard lead={lead} onSaved={load} />
        <Timeline entries={entries} events={events} teamName={teamName} onChanged={load} />
      </div>

      {dialog === 'entry' && <AddEntry lead={lead} onClose={() => setDialog(null)} onSaved={load} />}
      {dialog === 'interested' && <InterestedDialog onClose={() => setDialog(null)} act={act} />}
      {dialog === 'reschedule' && <RescheduleDialog lead={lead} onClose={() => setDialog(null)} act={act} />}
      {dialog === 'meeting' && <MeetingDialog lead={lead} onClose={() => setDialog(null)} act={act} />}
      {dialog === 'defer' && <DeferDialog onClose={() => setDialog(null)} act={act} />}
      {dialog === 'commit' && <CommitDialog lead={lead} onClose={() => setDialog(null)} act={act} />}
      {dialog === 'not_interested' && <NotInterestedDialog onClose={() => setDialog(null)} act={act} />}
      {dialog === 'bring_back' && <BringBackDialog lead={lead} onClose={() => setDialog(null)} act={act} />}
    </div>
  );
}

type Act = (fn: string, args: Record<string, unknown>, msg: string) => Promise<void>;

/* ───────── profile ───────── */
function ProfileCard({ lead, onSaved }: { lead: Lead; onSaved: () => void }) {
  const toast = useToast();
  const init = () => ({
    name: lead.name, phone: lead.phone ?? '', email: lead.email ?? '', city: lead.city ?? '',
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
        <Field label="Name"><input value={f.name} onChange={set('name')} /></Field>
        <div className="grid2">
          <Field label="Phone"><input value={f.phone} onChange={set('phone')} /></Field>
          <Field label="Email"><input value={f.email} onChange={set('email')} /></Field>
          <Field label="City / region"><input value={f.city} onChange={set('city')} /></Field>
          <Field label="Age"><input type="number" value={f.age} onChange={set('age')} /></Field>
          <Field label="Marital status"><Select v={f.marital_status} on={set('marital_status')} opts={MARITAL} /></Field>
          <Field label="Income level"><Select v={f.income_band} on={set('income_band')} opts={INCOME_BANDS} /></Field>
          <Field label="Language"><Select v={f.language} on={set('language')} opts={LANGUAGES} /></Field>
          <Field label="Budget"><input value={f.budget} onChange={set('budget')} /></Field>
          <Field label="Campaign"><input value={f.campaign} onChange={set('campaign')} /></Field>
          <Field label="Referred by"><input value={f.referred_by} onChange={set('referred_by')} /></Field>
        </div>
        <Field label="What they want"><textarea value={f.requirement} onChange={set('requirement')} /></Field>
        <div className="row-gap" style={{ justifyContent: 'flex-end' }}>
          {dirty && <button className="btn ghost sm" onClick={() => setF(init())}>Discard</button>}
          <button className="btn sm" disabled={!dirty || busy} onClick={save}>Save profile</button>
        </div>
      </div>
    </div>
  );
}

/* ───────── timeline ───────── */
function Timeline({ entries, events, teamName, onChanged }: {
  entries: LeadEntry[]; events: LeadEvent[]; teamName: (id: string | null) => string; onChanged: () => void;
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
                <b>{ENTRY_KINDS.find((k) => k.key === e.kind)?.label}</b>
                {e.outcome && <span className={`outcome o-${e.outcome}`}>{OUTCOME_LABEL[e.outcome]}</span>}
                {e.strike_state === 'counted' && <span className="strike-tag">Strike</span>}
                {e.strike_state === 'pending' && <>
                  <span className="strike-tag pending">Strike in 48h if no reply</span>
                  <button className="linkbtn small" onClick={() => markReplied(e.id)}>They replied</button>
                </>}
              </div>
              {e.notes && <div className="tl-notes">{e.notes}</div>}
              <div className="when">{fmtDateTime(at)} · {teamName(e.created_by)} · in {bucketLabel(e.bucket_at)}</div>
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
    case 'created': return ev.detail?.via === 'upload' ? 'Lead added from an upload' : 'Lead added';
    case 'assigned': return ev.from_value ? `Reassigned from ${teamName(ev.from_value)} to ${teamName(ev.to_value)}` : `Assigned to ${teamName(ev.to_value)}`;
    case 'bucket': {
      const reason = (ev.detail?.reason as string) ?? '';
      return `Moved from ${bucketLabel(ev.from_value as Bucket)} to ${bucketLabel(ev.to_value as Bucket)}${reason ? ` · ${reason}` : ''}`;
    }
    case 'meeting': return ev.from_value && ev.from_value !== '' ? `Meeting moved to ${fmtDateTime(ev.to_value)}` : `Meeting booked for ${fmtDateTime(ev.to_value)}`;
    case 'merged': return 'Duplicate details merged in';
    case 'edited': return `Product changed from ${ev.from_value} to ${ev.to_value}`;
    default: return ev.kind;
  }
}

/* ───────── add entry ───────── */
function AddEntry({ lead, onClose, onSaved }: { lead: Lead; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [kind, setKind] = useState<EntryKind>('phone_call');
  const [when, setWhen] = useState(toISTInput(new Date().toISOString()));
  const [outcome, setOutcome] = useState<Outcome | ''>('');
  const [notes, setNotes] = useState('');
  const [next, setNext] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const isCall = kind === 'phone_call' || kind === 'meet_call';
  const isMsg = kind === 'message' || kind === 'email';
  const outcomes = isCall ? CALL_OUTCOMES : isMsg ? MESSAGE_OUTCOMES : [];
  const notesRequired = outcome === 'connected' || kind === 'in_person' || kind === 'note';

  const effect = (() => {
    if (outcome === 'not_interested') return { tone: 'red', text: 'Moves the lead to the Out List.' };
    if (lead.bucket === 'active_contact') {
      if (outcome === 'no_answer') return lead.strikes + 1 >= 5
        ? { tone: 'red', text: 'Fifth strike: the lead moves to the Out List.' }
        : { tone: 'amber', text: `Adds a strike (${lead.strikes} → ${lead.strikes + 1} of 5).` };
      if (outcome === 'sent') return { tone: 'amber', text: 'Becomes a strike if there is no reply within 48 hours.' };
      if ((outcome === 'connected' || outcome === 'replied' || kind === 'in_person') && lead.strikes > 0) return { tone: 'green', text: 'Resets strikes to 0.' };
    }
    if ((lead.bucket === 'awaiting_meeting' || lead.bucket === 'holding') && (isCall || isMsg) && outcome) {
      const word = lead.bucket === 'awaiting_meeting' ? 'reminder' : 'follow-up';
      return lead.strikes + 1 >= 5
        ? { tone: 'red', text: `Fifth ${word} without progress: the lead moves to the Out List.` }
        : { tone: 'amber', text: `Counts as ${word} ${lead.strikes + 1} of 5.` };
    }
    return null;
  })();

  async function save() {
    if ((isCall || isMsg) && !outcome) { setErr('Pick an outcome'); return; }
    if (notesRequired && !notes.trim()) { setErr('Notes are required for this entry'); return; }
    setBusy(true); setErr(null);
    try {
      await rpc('log_entry', {
        p_lead: lead.id, p_kind: kind, p_outcome: outcome || null, p_notes: notes || null,
        p_occurred_at: fromISTInput(when), p_next_follow_up: next || null,
      });
      toast('Entry saved');
      onClose();
      onSaved();
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  }

  return (
    <Drawer title="Add entry" sub={`${lead.name} · ${bucketLabel(lead.bucket)}`} onClose={onClose}
      footer={<><button className="btn ghost" onClick={onClose}>Cancel</button><button className="btn" disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Save entry'}</button></>}>
      <Field label="Type" required>
        <div className="chips">
          {ENTRY_KINDS.map((k) => (
            <button key={k.key} className={`chip ${kind === k.key ? 'on' : ''}`} onClick={() => { setKind(k.key); setOutcome(''); }}>
              {k.label}
            </button>
          ))}
        </div>
      </Field>
      <Field label="Date and time (IST)" required><input type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} /></Field>
      {outcomes.length > 0 && (
        <Field label="Outcome" required>
          <div className="chips">
            {outcomes.map((o) => (
              <button key={o} className={`chip ${outcome === o ? 'on' : ''} ${o === 'not_interested' ? 'chip-red' : ''}`} onClick={() => setOutcome(o)}>
                {OUTCOME_LABEL[o]}
              </button>
            ))}
          </div>
        </Field>
      )}
      {effect && <div className={`effect ${effect.tone}`}>{effect.text}</div>}
      <Field label="Notes" required={notesRequired}
        hint={kind === 'meet_call' ? 'Paste the Google Meet transcript here, or write what was discussed.' : undefined}>
        <textarea rows={7} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="What was discussed, concerns, decisions, next steps" />
      </Field>
      {outcome !== 'not_interested' && (
        <Field label="Next follow-up" hint={lead.next_follow_up ? `Currently ${fmtDate(lead.next_follow_up)}` : undefined}>
          <div className="row-gap">
            <input type="date" value={next} onChange={(e) => setNext(e.target.value)} />
            {[1, 2, 7].map((d) => <button key={d} className="chip" onClick={() => setNext(addDays(todayIST(), d))}>+{d}d</button>)}
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

function InterestedDialog({ onClose, act }: { onClose: () => void; act: Act }) {
  const [when, setWhen] = useState('');
  const { busy, run } = useBusy();
  return (
    <Modal title="Interested · book the first meeting" onClose={onClose}
      footer={<><button className="btn ghost" onClick={onClose}>Cancel</button>
        <button className="btn" disabled={busy} onClick={() => run(() => act('mark_interested', { p_meeting_at: fromISTInput(when) }, 'Moved to Awaiting meeting'))}>Move to Awaiting meeting</button></>}>
      <p className="muted" style={{ marginBottom: 12 }}>The lead moves to <b>Awaiting meeting</b> and strikes reset. From here, each reminder counts; five reminders with no meeting sends it to the Out List.</p>
      <Field label="Meeting date and time (IST)" hint="Leave empty if the time isn't fixed yet; you can set it later.">
        <input type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} />
      </Field>
    </Modal>
  );
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

function MeetingDialog({ lead, onClose, act }: { lead: Lead; onClose: () => void; act: Act }) {
  const [kind, setKind] = useState<'meet_call' | 'in_person' | 'phone_call'>('meet_call');
  const [result, setResult] = useState<'commits' | 'undecided' | 'later' | ''>('');
  const [notes, setNotes] = useState('');
  const [later, setLater] = useState('');
  const [next, setNext] = useState(addDays(todayIST(), 3));
  const [product, setProduct] = useState(lead.product);
  const { busy, run } = useBusy();
  const ok = result && notes.trim() && (result !== 'later' || later);
  const msg = result === 'commits' ? 'Committed · moved to Converting' : result === 'later' ? 'Moved to Deferred' : 'Moved to Holding period';
  return (
    <Modal title="Record meeting" onClose={onClose} wide
      footer={<><button className="btn ghost" onClick={onClose}>Cancel</button>
        <button className="btn" disabled={busy || !ok} onClick={() => run(() => act('record_meeting', {
          p_result: result, p_kind: kind, p_notes: notes, p_deferred_until: later || null,
          p_next_follow_up: result === 'undecided' ? next : null, p_product: product,
        }, msg))}>Save meeting</button></>}>
      <Field label="How did you meet?" required>
        <div className="chips">
          {([['meet_call', 'Google Meet'], ['in_person', 'In-person'], ['phone_call', 'Phone']] as const).map(([k, l]) => (
            <button key={k} className={`chip ${kind === k ? 'on' : ''}`} onClick={() => setKind(k)}>{l}</button>
          ))}
        </div>
      </Field>
      <Field label="Outcome" required>
        <div className="outcome-cards">
          <button className={result === 'commits' ? 'on' : ''} onClick={() => setResult('commits')}><b>Commits</b><span>Moves to Converting → onboarding</span></button>
          <button className={result === 'undecided' ? 'on' : ''} onClick={() => setResult('undecided')}><b>Undecided</b><span>Holding period · up to 5 follow-ups</span></button>
          <button className={result === 'later' ? 'on' : ''} onClick={() => setResult('later')}><b>Will commit later</b><span>Deferred until a set date</span></button>
        </div>
      </Field>
      {result === 'commits' && (
        <Field label="Product" hint={`Onboarding happens in ${ONBOARDING_ROUTE[product]}.`}>
          <select value={product} onChange={(e) => setProduct(e.target.value as Lead['product'])}>{PRODUCTS.map((p) => <option key={p}>{p}</option>)}</select>
        </Field>
      )}
      {result === 'later' && <Field label="Comes back on" required><input type="date" min={addDays(todayIST(), 1)} value={later} onChange={(e) => setLater(e.target.value)} /></Field>}
      {result === 'undecided' && <Field label="First follow-up"><input type="date" value={next} onChange={(e) => setNext(e.target.value)} /></Field>}
      <Field label="Meeting notes" required hint="Paste the Meet transcript or write what was discussed.">
        <textarea rows={7} value={notes} onChange={(e) => setNotes(e.target.value)} />
      </Field>
    </Modal>
  );
}

function DeferDialog({ onClose, act }: { onClose: () => void; act: Act }) {
  const [d, setD] = useState('');
  const { busy, run } = useBusy();
  return (
    <Modal title="Defer" onClose={onClose}
      footer={<><button className="btn ghost" onClick={onClose}>Cancel</button>
        <button className="btn" disabled={busy || !d} onClick={() => run(() => act('defer_lead', { p_until: d }, 'Moved to Deferred'))}>Defer</button></>}>
      <p className="muted" style={{ marginBottom: 12 }}>They'll commit later. The lead leaves the working queue and returns to <b>Holding period</b> on this date, with a follow-up due that day.</p>
      <Field label="Comes back on" required><input type="date" min={addDays(todayIST(), 1)} value={d} onChange={(e) => setD(e.target.value)} /></Field>
    </Modal>
  );
}

function CommitDialog({ lead, onClose, act }: { lead: Lead; onClose: () => void; act: Act }) {
  const [product, setProduct] = useState(lead.product);
  const { busy, run } = useBusy();
  return (
    <Modal title="Mark as committed" onClose={onClose}
      footer={<><button className="btn ghost" onClick={onClose}>Cancel</button>
        <button className="btn" disabled={busy} onClick={() => run(() => act('mark_committed', { p_product: product }, 'Committed · moved to Converting'))}>Confirm</button></>}>
      <p className="muted" style={{ marginBottom: 12 }}>The lead moves to <b>Converting</b> and leaves the working pipeline, ready for onboarding.</p>
      <Field label="Product" hint={`Onboarding happens in ${ONBOARDING_ROUTE[product]}.`}>
        <select value={product} onChange={(e) => setProduct(e.target.value as Lead['product'])}>{PRODUCTS.map((p) => <option key={p}>{p}</option>)}</select>
      </Field>
    </Modal>
  );
}

function NotInterestedDialog({ onClose, act }: { onClose: () => void; act: Act }) {
  const [note, setNote] = useState('');
  const { busy, run } = useBusy();
  return (
    <Modal title="Mark not interested" onClose={onClose}
      footer={<><button className="btn ghost" onClick={onClose}>Cancel</button>
        <button className="btn danger" disabled={busy} onClick={() => run(() => act('mark_not_interested', { p_note: note || null }, 'Moved to the Out List'))}>Move to Out List</button></>}>
      <p className="muted" style={{ marginBottom: 12 }}>The lead moves to the Out List and its follow-ups stop. It can be brought back later.</p>
      <Field label="Reason / note (optional)"><textarea value={note} onChange={(e) => setNote(e.target.value)} /></Field>
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

