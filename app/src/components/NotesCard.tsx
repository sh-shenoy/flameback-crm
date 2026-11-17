import { useEffect, useRef, useState } from 'react';
import { useApp } from '../auth';
import { rpc } from '../lib/supabase';
import { timeAgo } from '../lib/format';
import type { Lead } from '../lib/types';
import { useToast } from './ui';
import { invokeAI } from './SummaryBox';

/**
 * Free notes on a lead: anything the RM wants to keep (family, preferences, context).
 * The AI summary reads them. "Fix grammar" tidies spelling and grammar; the RM reviews, then saves.
 */
export default function NotesCard({ lead, onSaved }: { lead: Lead; onSaved: () => void }) {
  const { teamName } = useApp();
  const toast = useToast();
  const saved = lead.general_notes ?? '';
  const [text, setText] = useState(saved);
  const [busy, setBusy] = useState<'' | 'save' | 'fix'>('');
  const [fixedFrom, setFixedFrom] = useState<string | null>(null);   // text before the AI fix, for Undo
  const dirty = text !== saved;
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;

  // pick up a change saved elsewhere, but never throw away what someone is typing
  useEffect(() => { if (!dirtyRef.current) setText(saved); }, [saved]);

  async function save() {
    setBusy('save');
    try {
      await rpc('save_lead_notes', { p_lead: lead.id, p_notes: text });
      setFixedFrom(null);
      toast('Notes saved');
      onSaved();
    } catch (e) { toast((e as Error).message, 'err'); } finally { setBusy(''); }
  }

  async function fix() {
    setBusy('fix');
    try {
      const r = await invokeAI<{ text?: string }>({ action: 'polish', text });
      if (r.error) { toast(r.error, 'err'); return; }
      if (typeof r.text !== 'string') { toast('The AI returned nothing. Try again.', 'err'); return; }
      if (r.text === text) { toast('Nothing to fix'); return; }
      setFixedFrom(text);
      setText(r.text);
      toast('Grammar fixed. Check it, then Save.');
    } finally { setBusy(''); }
  }

  return (
    <div className="panel notes-card">
      <div className="panel-head"><h2>Notes</h2>
        {lead.notes_updated_at && <span className="muted small">Edited {timeAgo(lead.notes_updated_at)} by {teamName(lead.notes_updated_by ?? null)}</span>}
      </div>
      <div className="pad">
        <textarea rows={7} value={text} onChange={(e) => { setText(e.target.value); setFixedFrom(null); }}
          placeholder="Anything worth remembering: family, existing investments, preferences, best time to call… The AI summary reads these notes." />
        <div className="row-gap notes-actions">
          <button className="btn ghost sm" disabled={!text.trim() || !!busy} onClick={fix}
            title="Corrects spelling and grammar only; contact details are never sent">{busy === 'fix' ? 'Fixing…' : 'Fix grammar'}</button>
          {fixedFrom !== null && <button className="linkbtn small" onClick={() => { setText(fixedFrom); setFixedFrom(null); }}>Undo fix</button>}
          <span style={{ flex: 1 }} />
          {dirty && <button className="btn ghost sm" disabled={!!busy} onClick={() => { setText(saved); setFixedFrom(null); }}>Discard</button>}
          <button className="btn sm" disabled={!dirty || !!busy} onClick={save}>{busy === 'save' ? 'Saving…' : 'Save notes'}</button>
        </div>
      </div>
    </div>
  );
}
