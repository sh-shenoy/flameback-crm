import { useCallback, useEffect, useState } from 'react';
import { rpc, supabase } from '../lib/supabase';
import { PRODUCTS, type OnboardingTemplate } from '../lib/types';
import { useToast } from '../components/ui';

/** Admin: the onboarding checklist each new prospect gets, per product and Resident / NRI. */
export default function OnboardingTemplates() {
  const toast = useToast();
  const [product, setProduct] = useState<string>(PRODUCTS[0]);
  const [residency, setResidency] = useState<'resident' | 'nri'>('resident');
  const [rows, setRows] = useState<OnboardingTemplate[] | null>(null);
  const [title, setTitle] = useState('');
  const [owner, setOwner] = useState<'rm' | 'ops'>('rm');
  const [perHolder, setPerHolder] = useState(false);

  const load = useCallback(async () => {
    const { data } = await supabase.from('onboarding_templates').select('*').eq('product', product).eq('residency', residency).order('sort_order').order('created_at');
    setRows((data as OnboardingTemplate[]) ?? []);
  }, [product, residency]);
  useEffect(() => { setRows(null); load(); }, [load]);

  async function save(id: string | null, p: Record<string, unknown>, msg?: string) {
    try { await rpc('save_onboarding_template', { p_id: id, p }); if (msg) toast(msg); await load(); return true; }
    catch (e) { toast((e as Error).message, 'err'); return false; }
  }
  async function move(i: number, dir: -1 | 1) {
    if (!rows) return;
    const a = rows[i], b = rows[i + dir];
    if (!b) return;
    await save(a.id, { sort_order: b.sort_order === a.sort_order ? a.sort_order + dir : b.sort_order });
    await save(b.id, { sort_order: a.sort_order });
  }

  return (
    <div>
      <p className="muted small" style={{ marginBottom: 12 }}>
        When a lead agrees to join, they get the checklist for their product and residency. RMs can add or remove items for each prospect.
        Changes here apply to new prospects; existing ones can pull new items with <b>Add missing checklist items</b>.
      </p>
      <div className="toolbar" style={{ marginBottom: 14 }}>
        <div className="seg">{PRODUCTS.map((p) => <button key={p} className={product === p ? 'on' : ''} onClick={() => setProduct(p)}>{p}</button>)}</div>
        <div className="seg">
          <button className={residency === 'resident' ? 'on' : ''} onClick={() => setResidency('resident')}>Resident</button>
          <button className={residency === 'nri' ? 'on' : ''} onClick={() => setResidency('nri')}>NRI</button>
        </div>
      </div>
      <div className="panel">
        <div className="panel-head"><h2>{product} · {residency === 'nri' ? 'NRI' : 'Resident'}</h2><span className="muted small">{rows?.length ?? 0} items</span></div>
        <div className="table-wrap">
          <table>
            <thead><tr><th style={{ width: 70 }}>Order</th><th>Item</th><th>Usually done by</th><th>Each joint holder</th><th>In use</th><th /></tr></thead>
            <tbody>
              {rows?.map((t, i) => (
                <tr key={t.id} className={t.is_active ? '' : 'inactive'}>
                  <td><button className="linkbtn small" disabled={i === 0} onClick={() => move(i, -1)} aria-label="Move up">↑</button>{' '}
                    <button className="linkbtn small" disabled={i === rows.length - 1} onClick={() => move(i, 1)} aria-label="Move down">↓</button></td>
                  <td><input className="inline-select tpl-title" defaultValue={t.title} onBlur={(e) => e.target.value.trim() !== t.title && save(t.id, { title: e.target.value }, 'Saved')} /></td>
                  <td><select className="filter" value={t.owner} onChange={(e) => save(t.id, { owner: e.target.value })}><option value="rm">RM</option><option value="ops">Operations</option></select></td>
                  <td><label className="toggle"><input type="checkbox" checked={t.per_holder} onChange={(e) => save(t.id, { per_holder: e.target.checked })} /><span /></label></td>
                  <td><label className="toggle"><input type="checkbox" checked={t.is_active} onChange={(e) => save(t.id, { is_active: e.target.checked })} /><span /></label></td>
                  <td><button className="linkbtn small danger-text" onClick={async () => {
                    if (!confirm(`Delete "${t.title}" from this checklist? Prospects who already have it keep it.`)) return;
                    try { await rpc('delete_onboarding_template', { p_id: t.id }); await load(); } catch (e) { toast((e as Error).message, 'err'); }
                  }}>Delete</button></td>
                </tr>
              ))}
              {rows?.length === 0 && <tr><td colSpan={6} className="muted">No items yet for {product} · {residency === 'nri' ? 'NRI' : 'Resident'}. Add the first one below.</td></tr>}
            </tbody>
          </table>
        </div>
        <div className="pad tpl-add">
          <input placeholder="New item, e.g. PAN card copy" value={title} onChange={(e) => setTitle(e.target.value)} />
          <select value={owner} onChange={(e) => setOwner(e.target.value as 'rm' | 'ops')}><option value="rm">RM</option><option value="ops">Operations</option></select>
          <label className="check"><input type="checkbox" checked={perHolder} onChange={(e) => setPerHolder(e.target.checked)} /> each joint holder</label>
          <button className="btn sm" disabled={!title.trim()} onClick={async () => {
            if (await save(null, { product, residency, title, owner, per_holder: perHolder }, 'Added')) { setTitle(''); setPerHolder(false); }
          }}>Add item</button>
        </div>
      </div>
    </div>
  );
}
