import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { Empty, Skeleton, useToast } from '../components/ui';

interface Template { id: string; title: string; slug: string; length_minutes: number; description: string | null; sort_order: number; is_active: boolean }
const slugify = (t: string) => t.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);

/** Admin → Meeting types: the standard list every RM's Cal.com gets. */
export default function MeetingTypes() {
  const toast = useToast();
  const [rows, setRows] = useState<Template[] | null>(null);
  const [draft, setDraft] = useState({ title: '', length_minutes: 30, description: '' });

  async function load() {
    const { data, error } = await supabase.from('meeting_templates').select('*').order('sort_order').order('created_at');
    if (error) { toast(error.message.includes('meeting_templates') ? 'Run migration 0007 in Supabase first' : error.message, 'err'); setRows([]); return; }
    setRows((data as Template[]) ?? []);
  }
  useEffect(() => { load(); }, []);

  async function save(t: Template, patch: Partial<Template>) {
    const { error } = await supabase.from('meeting_templates').update(patch).eq('id', t.id);
    if (error) toast(error.message, 'err'); else { toast('Saved'); load(); }
  }
  async function add() {
    const slug = slugify(draft.title);
    if (!slug) return;
    const { error } = await supabase.from('meeting_templates').insert({
      title: draft.title.trim(), slug, length_minutes: draft.length_minutes, description: draft.description.trim() || null,
      sort_order: ((rows ?? []).reduce((m, r) => Math.max(m, r.sort_order), 0) + 10),
    });
    if (error) toast(error.message.includes('duplicate') ? 'A meeting type with that name already exists' : error.message, 'err');
    else { toast(`${draft.title} added`); setDraft({ title: '', length_minutes: 30, description: '' }); load(); }
  }
  async function remove(t: Template) {
    if (!confirm(`Remove "${t.title}" from the standard list? It stays in Cal.com accounts that already have it.`)) return;
    const { error } = await supabase.from('meeting_templates').delete().eq('id', t.id);
    if (error) toast(error.message, 'err'); else load();
  }

  return (
    <>
      <p className="muted small" style={{ marginBottom: 12 }}>
        Every RM's Cal.com gets these when they connect it, and again whenever they click <b>Add Flameback meeting types</b> under Connections.
        Only missing ones are added; nothing an RM already has is changed or removed.
      </p>
      <div className="panel">
        <div className="table-wrap">
          <table>
            <thead><tr><th>Meeting type</th><th>Length</th><th>Description (shown to clients)</th><th>Link name</th><th>Active</th><th /></tr></thead>
            <tbody>
              {rows === null && [0, 1, 2].map((i) => <tr key={i}><td colSpan={6}><Skeleton /></td></tr>)}
              {rows?.map((t) => <Row key={t.id} t={t} onSave={(p) => save(t, p)} onRemove={() => remove(t)} />)}
              <tr className="add-row">
                <td><input placeholder="New meeting type, e.g. Quarterly review" value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} /></td>
                <td><select value={draft.length_minutes} onChange={(e) => setDraft({ ...draft, length_minutes: +e.target.value })}>
                  {[15, 20, 30, 45, 60, 90].map((m) => <option key={m} value={m}>{m} min</option>)}</select></td>
                <td><input placeholder="What it's for" value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} /></td>
                <td className="muted small">{slugify(draft.title) || '—'}</td>
                <td />
                <td><button className="btn sm" disabled={!draft.title.trim()} onClick={add}>Add</button></td>
              </tr>
            </tbody>
          </table>
          {rows?.length === 0 && <Empty>No standard meeting types yet.</Empty>}
        </div>
      </div>
    </>
  );
}

function Row({ t, onSave, onRemove }: { t: Template; onSave: (p: Partial<Template>) => void; onRemove: () => void }) {
  const [title, setTitle] = useState(t.title);
  const [desc, setDesc] = useState(t.description ?? '');
  const dirty = title !== t.title || desc !== (t.description ?? '');
  return (
    <tr className={t.is_active ? '' : 'inactive'}>
      <td><input value={title} onChange={(e) => setTitle(e.target.value)} /></td>
      <td><select value={t.length_minutes} onChange={(e) => onSave({ length_minutes: +e.target.value })}>
        {[15, 20, 30, 45, 60, 90].map((m) => <option key={m} value={m}>{m} min</option>)}</select></td>
      <td><input value={desc} onChange={(e) => setDesc(e.target.value)} /></td>
      <td className="muted small">{t.slug}</td>
      <td><label className="toggle"><input type="checkbox" checked={t.is_active} onChange={(e) => onSave({ is_active: e.target.checked })} /><span /></label></td>
      <td><div className="row-gap" style={{ flexWrap: 'nowrap' }}>
        {dirty && <button className="btn sm" onClick={() => onSave({ title: title.trim(), description: desc.trim() || null })}>Save</button>}
        <button className="linkbtn small danger-text" onClick={onRemove}>Remove</button>
      </div></td>
    </tr>
  );
}
