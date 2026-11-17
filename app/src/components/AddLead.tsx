import { useState, type KeyboardEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApp } from '../auth';
import { rpc } from '../lib/supabase';
import { normalizeEmail, normalizePhone } from '../lib/phone';
import { todayIST } from '../lib/format';
import { INCOME_BANDS, LANGUAGES, MARITAL, PRODUCTS, type Bucket } from '../lib/types';
import { BucketPill, Field, Modal, useToast } from './ui';

interface Dup { lead_id: string; name: string; rm_name: string; bucket: Bucket; matched_on: string; can_open: boolean }

const blank = {
  name: '', phone: '', email: '', product: '', source: '', campaign: '', referred_by: '',
  city: '', age: '', marital_status: '', income_band: '', language: '', requirement: '', budget: '',
  next_follow_up: todayIST(), rm_id: '',
};

export default function AddLead({ onClose }: { onClose: () => void }) {
  const { sources, team, isAdmin, teamName } = useApp();
  const [f, setF] = useState(blank);
  const [more, setMore] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [dups, setDups] = useState<Dup[] | null>(null);
  const toast = useToast();
  const nav = useNavigate();
  const set = (k: keyof typeof blank) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });

  function validate(): string | null {
    if (!f.name.trim()) return 'Name is required';
    if (!f.phone.trim() && !f.email.trim()) return 'Add a phone number or an email';
    if (normalizePhone(f.phone) === 'invalid') return 'That phone number doesn\'t look right';
    if (normalizeEmail(f.email) === 'invalid') return 'That email doesn\'t look right';
    if (!f.product) return 'Pick a product';
    if (!f.source) return 'Pick where the lead came from';
    return null;
  }

  async function save() {
    const v = validate();
    if (v) { setErr(v); return; }
    setErr(null); setBusy(true);
    try {
      const found = await rpc<Dup[]>('find_duplicates', { p_phone: f.phone || null, p_email: f.email || null });
      if (found.length) { setDups(found); return; }
      const id = await rpc<string>('create_lead', { p: payload() });
      toast(`Lead added · ${f.name.trim()}`);
      onClose();
      nav(`/leads/${id}`);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function payload() {
    const p: Record<string, string> = {};
    for (const [k, v] of Object.entries(f)) if (v !== '' && (k !== 'rm_id' || isAdmin)) p[k] = v;
    return p;
  }

  async function merge(d: Dup) {
    setBusy(true);
    try {
      await rpc('merge_into_lead', { p_lead: d.lead_id, p: payload(), p_note: 'Duplicate added by hand and merged' });
      toast(`Merged into ${d.name}`);
      onClose();
      nav(`/leads/${d.lead_id}`);
    } catch (e) {
      setErr((e as Error).message);
    } finally { setBusy(false); }
  }

  if (dups) {
    return (
      <Modal title="This person may already be in the CRM" onClose={onClose}
        footer={<button className="btn ghost" onClick={() => setDups(null)}>← Back to the form</button>}>
        <p className="muted" style={{ marginBottom: 12 }}>A lead with the same {dups.map((d) => d.matched_on).join(' / ')} already exists, so a new one can't be created.</p>
        {dups.map((d) => (
          <div key={d.lead_id} className="dup-card">
            <div>
              <b>{d.name}</b> <BucketPill bucket={d.bucket} />
              <div className="muted small">Matched on {d.matched_on} · with {d.rm_name}</div>
            </div>
            {d.can_open ? (
              <div className="row-gap">
                <button className="btn ghost sm" onClick={() => { onClose(); nav(`/leads/${d.lead_id}`); }}>Open</button>
                <button className="btn sm" disabled={busy} onClick={() => merge(d)}>Merge into this lead</button>
              </div>
            ) : (
              <span className="muted small">Owned by {d.rm_name}. Ask them or an admin.</span>
            )}
          </div>
        ))}
        {err && <div className="form-err">{err}</div>}
        <p className="hint" style={{ marginTop: 10 }}>Merge fills in any empty details on the existing lead and adds a note to its timeline. Nothing already there is overwritten.</p>
      </Modal>
    );
  }

  const src = sources.find((s) => s.name === f.source);
  return (
    <Modal title="New lead" onClose={onClose}
      footer={<>
        <span className="muted small" style={{ marginRight: 'auto' }}>
          {isAdmin && f.rm_id ? `Assigned to ${teamName(f.rm_id)}` : 'Assigned by round-robin'}
        </span>
        <button className="btn ghost" onClick={onClose}>Cancel</button>
        <button className="btn" disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Add lead'}</button>
      </>}>
      <Field label="Name" required><input autoFocus value={f.name} onChange={set('name')} /></Field>
      <div className="grid2">
        <Field label="Phone" hint="10-digit Indian mobile, or + country code"><input value={f.phone} onChange={set('phone')} inputMode="tel" /></Field>
        <Field label="Email"><input value={f.email} onChange={set('email')} type="email" /></Field>
      </div>
      <div className="grid2">
        <Field label="Product" required>
          <select value={f.product} onChange={set('product')}>
            <option value="">Select…</option>
            {PRODUCTS.map((p) => <option key={p}>{p}</option>)}
          </select>
        </Field>
        <Field label="Source" required hint={src ? `${src.kind === 'cold' ? 'Cold' : 'Warm'} source` : undefined}>
          <select value={f.source} onChange={set('source')}>
            <option value="">Select…</option>
            <optgroup label="Warm">{sources.filter((s) => s.kind === 'warm' && s.is_active).map((s) => <option key={s.name}>{s.name}</option>)}</optgroup>
            <optgroup label="Cold">{sources.filter((s) => s.kind === 'cold' && s.is_active).map((s) => <option key={s.name}>{s.name}</option>)}</optgroup>
          </select>
        </Field>
      </div>
      <div className="grid2">
        <Field label="Campaign"><input value={f.campaign} onChange={set('campaign')} placeholder="e.g. Diwali RIA push" /></Field>
        {f.source === 'Referral'
          ? <Field label="Referred by"><input value={f.referred_by} onChange={set('referred_by')} /></Field>
          : <Field label="City"><input value={f.city} onChange={set('city')} /></Field>}
      </div>
      <div className="grid2">
        <Field label="First follow-up"><input type="date" value={f.next_follow_up} onChange={set('next_follow_up')} /></Field>
        {isAdmin && (
          <Field label="Assign to">
            <select value={f.rm_id} onChange={set('rm_id')}>
              <option value="">Round-robin</option>
              {team.filter((t) => t.is_active).map((t) => <option key={t.id} value={t.id}>{t.full_name}</option>)}
            </select>
          </Field>
        )}
      </div>

      <button className="linkbtn" onClick={() => setMore(!more)}>{more ? '− Fewer details' : '+ More details (profile)'}</button>
      {more && (
        <div style={{ marginTop: 12 }}>
          <div className="grid2">
            {f.source === 'Referral' && <Field label="City"><input value={f.city} onChange={set('city')} /></Field>}
            <Field label="Age"><input type="number" min={16} max={110} value={f.age} onChange={set('age')} /></Field>
            <Field label="Marital status"><Select v={f.marital_status} on={set('marital_status')} opts={MARITAL} /></Field>
            <Field label="Income level"><Select v={f.income_band} on={set('income_band')} opts={INCOME_BANDS} /></Field>
            <Field label="Budget"><input value={f.budget} onChange={set('budget')} placeholder="e.g. ₹50L" /></Field>
          </div>
          <Field label="Languages"><LanguagePicker value={f.language} onChange={(v) => setF({ ...f, language: v })} /></Field>
          <Field label="What they want"><textarea value={f.requirement} onChange={set('requirement')} /></Field>
        </div>
      )}
      {err && <div className="form-err">{err}</div>}
    </Modal>
  );
}

export function Select({ v, on, opts }: { v: string; on: (e: { target: { value: string } }) => void; opts: string[] }) {
  return (
    <select value={v} onChange={on}>
      <option value="">—</option>
      {opts.map((o) => <option key={o}>{o}</option>)}
    </select>
  );
}

/** Several languages as toggle chips, plus any other typed in. Value is "Hindi, English". */
export function LanguagePicker({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [other, setOther] = useState('');
  const picked = value.split(',').map((x) => x.trim()).filter(Boolean);
  const has = (l: string) => picked.some((p) => p.toLowerCase() === l.toLowerCase());
  const toggle = (l: string) => onChange((has(l) ? picked.filter((p) => p.toLowerCase() !== l.toLowerCase()) : [...picked, l]).join(', '));
  const add = () => {
    const l = other.trim().replace(/\b\w/g, (c) => c.toUpperCase());
    if (l && !has(l)) onChange([...picked, l].join(', '));
    setOther('');
  };
  const extra = picked.filter((p) => !LANGUAGES.some((l) => l.toLowerCase() === p.toLowerCase()));
  return (
    <div className="lang-picker">
      <div className="chips">
        {[...LANGUAGES, ...extra].map((l) => (
          <button type="button" key={l} className={`chip ${has(l) ? 'on' : ''}`} onClick={() => toggle(l)}>{l}</button>
        ))}
      </div>
      <input className="lang-other" placeholder="Other language, then Enter" value={other} onChange={(e) => setOther(e.target.value)}
        onBlur={add} onKeyDown={(e: KeyboardEvent<HTMLInputElement>) => { if (e.key === 'Enter') { e.preventDefault(); add(); } }} />
    </div>
  );
}
