import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useApp } from '../auth';
import { rpc, supabase } from '../lib/supabase';
import { fmtDate, todayIST } from '../lib/format';
import { ITEM_STATUSES, RESIDENCY_LABEL, type Holder, type ItemStatus, type Lead, type OnboardingItem } from '../lib/types';
import { Field, Modal, useToast } from './ui';

export const fmtINR = (n: number) =>
  new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(n);

/**
 * Onboarding for a prospect (agreed to join): checklist per person, joint holders, Ask Ops,
 * and Mark as funded, which makes them a client. The RM drives it; Ops items follow their task.
 */
export default function OnboardingCard({ lead, onChanged, readOnly }: { lead: Lead; onChanged: () => void; readOnly?: boolean }) {
  const toast = useToast();
  const [items, setItems] = useState<OnboardingItem[] | null>(null);
  const [holders, setHolders] = useState<Holder[]>([]);
  const [open, setOpen] = useState(lead.bucket === 'converting' || !!readOnly);
  const [askFor, setAskFor] = useState<OnboardingItem | null>(null);
  const [funding, setFunding] = useState(false);
  const [notesFor, setNotesFor] = useState<string | null>(null);
  const isProspect = lead.bucket === 'converting' && !readOnly;   // can edit

  const load = useCallback(async () => {
    const [i, h] = await Promise.all([
      supabase.from('onboarding_items').select('*').eq('lead_id', lead.id).order('sort_order').order('created_at'),
      supabase.from('lead_holders').select('*').eq('lead_id', lead.id).order('created_at'),
    ]);
    setItems((i.data as OnboardingItem[]) ?? []);
    setHolders((h.data as Holder[]) ?? []);
  }, [lead.id]);
  useEffect(() => { load(); }, [load, lead.updated_at]);

  async function run(fn: string, args: Record<string, unknown>, msg?: string) {
    try { await rpc(fn, args); if (msg) toast(msg); await load(); return true; }
    catch (e) { toast((e as Error).message, 'err'); return false; }
  }

  async function setStatus(it: OnboardingItem, status: ItemStatus) {
    let reason: string | null = null;
    if (status === 'blocked') {
      reason = prompt('What is it blocked on?');
      if (!reason?.trim()) return;
    }
    await run('update_onboarding_item', { p_item: it.id, p: { status, ...(reason ? { blocked_reason: reason } : {}) } });
  }

  const total = items?.length ?? 0;
  const done = items?.filter((i) => i.status === 'done').length ?? 0;
  const waitingClient = items?.filter((i) => i.status === 'waiting').length ?? 0;
  const withOps = items?.filter((i) => i.owner === 'ops' && i.status !== 'done').length ?? 0;
  const blocked = items?.filter((i) => i.status === 'blocked').length ?? 0;

  const groups = useMemo(() => [
    { id: null as string | null, name: lead.name, sub: holders.length ? 'main applicant & shared items' : null },
    ...holders.map((h) => ({ id: h.id as string | null, name: h.name, sub: h.relation })),
  ], [holders, lead.name]);

  return (
    <div className="panel onboarding">
      <div className="panel-head">
        <h2>Onboarding</h2>
        <div className="ob-summary">
          {total > 0 && <span className="ob-progress" title={`${done} of ${total} done`}><i style={{ width: `${(done / total) * 100}%` }} /></span>}
          <span className="muted small">{total ? `${done} of ${total} done` : 'No checklist yet'}
            {waitingClient > 0 && ` · ${waitingClient} waiting on client`}{withOps > 0 && ` · ${withOps} with Ops`}{blocked > 0 && <span className="red"> · {blocked} blocked</span>}</span>
          {!isProspect && <button className="linkbtn small" onClick={() => setOpen(!open)}>{open ? 'Hide' : 'Show'}</button>}
        </div>
      </div>
      {open && (
        <div className="pad">
          <div className="ob-meta">
            <span>{lead.product} · {lead.residency ? RESIDENCY_LABEL[lead.residency] : <span className="amber">Resident / NRI not set</span>}</span>
            {isProspect ? <HolderChips holders={holders} onRemove={(h) => confirm(`Remove ${h.name} and their checklist items?`) && run('remove_holder', { p_holder: h.id }, `${h.name} removed`)}
              onAdd={(name, rel) => run('add_holder', { p_lead: lead.id, p_name: name, p_relation: rel || null }, `${name} added`)} /> : holders.length > 0 && <span className="ob-holders">{holders.map((h) => <span key={h.id} className="ob-chip">{h.name}{h.relation && <span className="muted"> · {h.relation}</span>}</span>)}</span>}
          </div>

          {items === null ? <p className="muted">Loading…</p> : total === 0 ? (
            <div className="ob-empty">
              <p>No checklist items yet. {lead.residency ? '' : 'Set Resident / NRI in the header, then '}Load the {lead.product} checklist, or add items below.</p>
              {isProspect && <button className="btn ghost sm" onClick={async () => {
                try { const n = await rpc<number>('load_onboarding_checklist', { p_lead: lead.id }); toast(n ? `${n} item${n === 1 ? '' : 's'} added` : `No ${lead.product} · ${lead.residency ? RESIDENCY_LABEL[lead.residency] : 'Resident'} checklist set up yet (Admin → Onboarding checklists)`); await load(); }
                catch (e) { toast((e as Error).message, 'err'); }
              }}>Load checklist</button>}
            </div>
          ) : groups.map((g) => {
            const mine = items.filter((i) => i.holder_id === g.id);
            if (!mine.length) return null;
            return (
              <div key={g.id ?? 'main'} className="ob-group">
                <div className="ob-person">{g.name}{g.sub && <span className="muted small"> · {g.sub}</span>}</div>
                {mine.map((it) => (
                  <div key={it.id} className={`ob-item s-${it.status}`}>
                    <div className="ob-line">
                      <select className={`ob-status st-${it.status}`} value={it.status} disabled={!isProspect}
                        onChange={(e) => setStatus(it, e.target.value as ItemStatus)} aria-label={`Status of ${it.title}`}>
                        {ITEM_STATUSES.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
                      </select>
                      <span className="ob-title">{it.title}</span>
                      <span className={`ob-owner o-${it.owner}`}>{it.owner === 'ops' ? 'Ops' : 'RM'}</span>
                      {it.task_id && <Link className="small" to={`/tasks?task=${it.task_id}`}>Ops task</Link>}
                      <span className="ob-spacer" />
                      {isProspect && <input type="date" className="ob-due" value={it.due_date ?? ''} title="Due date"
                        onChange={(e) => run('update_onboarding_item', { p_item: it.id, p: { due_date: e.target.value } })} />}
                      {!isProspect && it.due_date && <span className="muted small">due {fmtDate(it.due_date)}</span>}
                      {isProspect && <button className="linkbtn small" onClick={() => setNotesFor(notesFor === it.id ? null : it.id)}>{it.notes ? 'Notes•' : 'Notes'}</button>}
                      {isProspect && it.status !== 'done' && !(it.task_id && it.owner === 'ops') &&
                        <button className="linkbtn small" onClick={() => setAskFor(it)}>Ask Ops</button>}
                      {isProspect && <button className="ob-del" aria-label={`Delete ${it.title}`} onClick={() => confirm(`Delete "${it.title}"?`) && run('delete_onboarding_item', { p_item: it.id })}>×</button>}
                    </div>
                    {it.status === 'blocked' && it.blocked_reason && <div className="ob-sub red">Blocked: {it.blocked_reason}</div>}
                    {notesFor === it.id ? (
                      <NotesEditor initial={it.notes ?? ''} onSave={async (v) => { if (await run('update_onboarding_item', { p_item: it.id, p: { notes: v } })) setNotesFor(null); }} />
                    ) : it.notes && <div className="ob-sub muted">{it.notes}</div>}
                  </div>
                ))}
              </div>
            );
          })}

          {isProspect && <AddItem holders={holders} leadName={lead.name}
            onAdd={(title, owner, holder) => run('add_onboarding_item', { p_lead: lead.id, p_title: title, p_owner: owner, p_holder: holder }, 'Item added')} />}

          {isProspect && (
            <div className="ob-foot">
              <span className="muted small">They become a client when the money arrives.</span>
              {total > 0 && <button className="linkbtn small" onClick={async () => {
                try { const n = await rpc<number>('load_onboarding_checklist', { p_lead: lead.id }); toast(n ? `${n} new item${n === 1 ? '' : 's'} added from the checklist` : 'Nothing new in the checklist'); await load(); }
                catch (e) { toast((e as Error).message, 'err'); }
              }}>Add missing checklist items</button>}
              <button className="btn gold" onClick={() => setFunding(true)}>Mark as funded</button>
            </div>
          )}
        </div>
      )}
      {askFor && <AskOpsDialog item={askFor} onClose={() => setAskFor(null)}
        onDone={() => { setAskFor(null); load(); }} />}
      {funding && <FundedDialog lead={lead} openItems={total - done} onClose={() => setFunding(false)}
        onDone={() => { setFunding(false); onChanged(); }} />}
    </div>
  );
}

function HolderChips({ holders, onAdd, onRemove }: { holders: Holder[]; onAdd: (name: string, rel: string) => void; onRemove: (h: Holder) => void }) {
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [rel, setRel] = useState('');
  return (
    <span className="ob-holders">
      {holders.map((h) => (
        <span key={h.id} className="ob-chip">{h.name}{h.relation && <span className="muted"> · {h.relation}</span>}
          <button aria-label={`Remove ${h.name}`} onClick={() => onRemove(h)}>×</button></span>
      ))}
      {adding ? (
        <span className="ob-addholder">
          <input autoFocus placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} />
          <input placeholder="Relation (e.g. Spouse)" value={rel} onChange={(e) => setRel(e.target.value)} />
          <button className="btn sm" disabled={!name.trim()} onClick={() => { onAdd(name.trim(), rel.trim()); setName(''); setRel(''); setAdding(false); }}>Add</button>
          <button className="linkbtn small" onClick={() => setAdding(false)}>Cancel</button>
        </span>
      ) : <button className="linkbtn small" onClick={() => setAdding(true)}>+ Joint holder</button>}
    </span>
  );
}

function AddItem({ holders, leadName, onAdd }: { holders: Holder[]; leadName: string; onAdd: (title: string, owner: 'rm' | 'ops', holder: string | null) => Promise<boolean> }) {
  const [title, setTitle] = useState('');
  const [holder, setHolder] = useState('');
  const [busy, setBusy] = useState(false);
  async function add() {
    if (!title.trim()) return;
    setBusy(true);
    if (await onAdd(title.trim(), 'rm', holder || null)) setTitle('');
    setBusy(false);
  }
  return (
    <div className="ob-add">
      <input placeholder="Add an item, e.g. Cancelled cheque" value={title} onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') add(); }} />
      {holders.length > 0 && (
        <select value={holder} onChange={(e) => setHolder(e.target.value)} aria-label="For whom">
          <option value="">{leadName} / shared</option>
          {holders.map((h) => <option key={h.id} value={h.id}>{h.name}</option>)}
        </select>
      )}
      <button className="btn ghost sm" disabled={busy || !title.trim()} onClick={add}>Add</button>
    </div>
  );
}

function NotesEditor({ initial, onSave }: { initial: string; onSave: (v: string) => void }) {
  const [v, setV] = useState(initial);
  return (
    <div className="ob-notes">
      <textarea rows={2} value={v} onChange={(e) => setV(e.target.value)} placeholder="Reference numbers, what the client said, where the document is…" />
      <button className="btn sm" onClick={() => onSave(v)}>Save</button>
    </div>
  );
}

function AskOpsDialog({ item, onClose, onDone }: { item: OnboardingItem; onClose: () => void; onDone: () => void }) {
  const { team } = useApp();
  const toast = useToast();
  const [details, setDetails] = useState('');
  const [due, setDue] = useState(item.due_date ?? '');
  const [who, setWho] = useState('');
  const [busy, setBusy] = useState(false);
  const ops = team.filter((t) => t.is_active && t.team === 'Operations');
  async function go() {
    setBusy(true);
    try {
      await rpc('ask_ops', { p_item: item.id, p_details: details || null, p_due: due || null, p_assignee: who || null });
      toast('Sent to Operations as a task');
      onDone();
    } catch (e) { toast((e as Error).message, 'err'); } finally { setBusy(false); }
  }
  return (
    <Modal title={`Ask Ops · ${item.title}`} onClose={onClose}
      footer={<><button className="btn ghost" onClick={onClose}>Cancel</button><button className="btn" disabled={busy} onClick={go}>{busy ? 'Sending…' : 'Raise task for Ops'}</button></>}>
      <p className="muted" style={{ marginBottom: 12 }}>Operations gets a task linked to this lead. When they mark it done, this item ticks itself.</p>
      <Field label="What do they need to do?"><textarea rows={3} value={details} onChange={(e) => setDetails(e.target.value)} placeholder="e.g. Open NRE account with HDFC; client's documents are attached to the lead" /></Field>
      <div className="grid2">
        <Field label="Due date"><input type="date" min={todayIST()} value={due} onChange={(e) => setDue(e.target.value)} /></Field>
        <Field label="Person (optional)">
          <select value={who} onChange={(e) => setWho(e.target.value)}>
            <option value="">Anyone in Operations</option>
            {ops.map((p) => <option key={p.id} value={p.id}>{p.full_name}</option>)}
          </select>
        </Field>
      </div>
    </Modal>
  );
}

function FundedDialog({ lead, openItems, onClose, onDone }: { lead: Lead; openItems: number; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [date, setDate] = useState(todayIST());
  const [amount, setAmount] = useState('');
  const [busy, setBusy] = useState(false);
  const amt = amount.trim() ? Number(amount.replace(/[,₹\s]/g, '')) : null;
  const bad = amt !== null && (!Number.isFinite(amt) || amt < 0);
  async function go() {
    setBusy(true);
    try {
      await rpc('mark_funded', { p_lead: lead.id, p_date: date, p_amount: amt });
      toast(`${lead.name} is now a client`);
      onDone();
    } catch (e) { toast((e as Error).message, 'err'); } finally { setBusy(false); }
  }
  return (
    <Modal title={`Mark as funded · ${lead.name}`} onClose={onClose}
      footer={<><button className="btn ghost" onClick={onClose}>Cancel</button><button className="btn gold" disabled={busy || !date || bad} onClick={go}>{busy ? 'Saving…' : 'They are a client'}</button></>}>
      {openItems > 0 && <div className="banner warn" style={{ marginBottom: 12 }}>{openItems} checklist item{openItems === 1 ? ' is' : 's are'} not done yet. You can still mark them as funded.</div>}
      <div className="grid2">
        <Field label="Funds received on" required><input type="date" max={todayIST()} value={date} onChange={(e) => setDate(e.target.value)} /></Field>
        <Field label="Amount (₹)" hint={amt && !bad ? fmtINR(amt) : bad ? 'Enter a number' : 'Optional'}>
          <input inputMode="decimal" placeholder="e.g. 5000000" value={amount} onChange={(e) => setAmount(e.target.value)} />
        </Field>
      </div>
    </Modal>
  );
}
