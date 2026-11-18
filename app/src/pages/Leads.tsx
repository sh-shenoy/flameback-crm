import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useApp } from '../auth';
import { rpc, supabase } from '../lib/supabase';
import { addDays, fmtDate, fmtPhone, todayIST } from '../lib/format';
import { BUCKETS, PRODUCTS, type Bucket, type Lead } from '../lib/types';
import { BucketPill, Empty, Field, FollowUp, Modal, ProductTag, Skeleton, Strikes, useToast } from '../components/ui';

type Row = Lead & { lead_entries: { count: number }[] };
const PAGE = 100;
const WORKING: Bucket[] = ['active_contact', 'awaiting_meeting', 'holding', 'deferred'];

export default function Leads() {
  const { me, sources, isAdmin, team } = useApp();
  const [sp, setSp] = useSearchParams();
  const nav = useNavigate();
  const tab = (sp.get('bucket') as Bucket | 'open' | null) ?? 'open';
  const product = sp.get('product') ?? '';
  const source = sp.get('source') ?? '';
  const due = sp.get('due') ?? '';
  const q = sp.get('q') ?? '';
  const page = Number(sp.get('page') ?? 0);

  const [rows, setRows] = useState<Row[] | null>(null);
  const [total, setTotal] = useState(0);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [deleting, setDeleting] = useState(false);
  const [reload, setReload] = useState(0);
  const [moveTo, setMoveTo] = useState('');
  const toast = useToast();
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [search, setSearch] = useState(q);

  const setParam = (k: string, v: string) => {
    const n = new URLSearchParams(sp);
    if (v) n.set(k, v); else n.delete(k);
    if (k !== 'page') n.delete('page');
    setSp(n, { replace: true });
  };

  useEffect(() => { const t = setTimeout(() => search !== q && setParam('q', search), 250); return () => clearTimeout(t); }, [search]);

  // filters shared by the list and tab counts
  const applyFilters = useMemo(() => (query: any) => {
    let x = query;
    if (product) x = x.eq('product', product);
    if (source) x = x.eq('source', source);
    x = x.eq('rm_id', me!.id);
    const today = todayIST();
    if (due === 'overdue') x = x.lt('next_follow_up', today);
    if (due === 'today') x = x.eq('next_follow_up', today);
    if (due === 'week') x = x.lte('next_follow_up', addDays(today, 7));
    if (q.trim()) {
      const like = `%${q.trim().replace(/[%,()]/g, '')}%`;
      const digits = q.replace(/\D/g, '');
      const ors = [`name.ilike.${like}`, `email.ilike.${like}`, `campaign.ilike.${like}`];
      if (digits.length >= 3) ors.push(`phone.ilike.%${digits}%`);
      x = x.or(ors.join(','));
    }
    return x;
  }, [product, source, due, q, me]);

  useEffect(() => {
    let cancelled = false;
    setRows(null);
    let query = supabase.from('leads').select('*, lead_entries(count)', { count: 'exact' });
    query = tab === 'open' ? query.in('bucket', WORKING) : query.eq('bucket', tab);
    query = applyFilters(query)
      .order('next_follow_up', { ascending: true, nullsFirst: false })
      .order('created_at', { ascending: false })
      .range(page * PAGE, page * PAGE + PAGE - 1);
    query.then(({ data, count }: { data: Row[] | null; count: number | null }) => {
      if (cancelled) return;
      setRows(data ?? []);
      setTotal(count ?? 0);
      setSel(new Set());
    });
    // tab counts
    Promise.all([...WORKING, 'converting' as Bucket, 'client' as Bucket].map(async (b) => {
      const { count } = await applyFilters(supabase.from('leads').select('id', { count: 'exact', head: true }).eq('bucket', b));
      return [b, count ?? 0] as const;
    })).then((pairs) => {
      if (cancelled) return;
      const c: Record<string, number> = Object.fromEntries(pairs);
      c.open = WORKING.reduce((s, b) => s + (c[b] ?? 0), 0);
      setCounts(c);
    });
    return () => { cancelled = true; };
  }, [tab, page, applyFilters, reload]);

  const tabs: { key: string; label: string }[] = [
    { key: 'open', label: 'All open' },
    ...BUCKETS.filter((b) => b.key !== 'out').map((b) => ({ key: b.key, label: b.label })),
  ];
  const strikeBucket = (b: Bucket) => ['active_contact', 'awaiting_meeting'].includes(b);
  const filtersOn = product || source || due || q;

  return (
    <div className="main-inner">
      <div className="page-head">
        <div><h1>Leads</h1><p>Your leads, most urgent follow-up first.</p></div>
        <div className="row-gap">
          <button className="btn ghost" onClick={() => nav('/upload')}>Upload</button>
          <button className="btn" onClick={() => window.dispatchEvent(new Event('crm:add-lead'))}>Add lead</button>
        </div>
      </div>

      <div className="tabs">
        {tabs.map((t) => (
          <button key={t.key} className={`tab ${tab === t.key ? 'on' : ''}`} onClick={() => setParam('bucket', t.key === 'open' ? '' : t.key)}>
            {t.label} <span className="tab-n">{counts[t.key] ?? '·'}</span>
          </button>
        ))}
      </div>

      <div className="panel">
        <div className="panel-head">
          <div className="toolbar">
            <div className="search"><input placeholder="Name, phone, email, campaign" value={search} onChange={(e) => setSearch(e.target.value)} /></div>
            <select className="filter" value={product} onChange={(e) => setParam('product', e.target.value)}>
              <option value="">All products</option>{PRODUCTS.map((p) => <option key={p}>{p}</option>)}
            </select>
            <select className="filter" value={source} onChange={(e) => setParam('source', e.target.value)}>
              <option value="">All sources</option>{sources.map((s) => <option key={s.name}>{s.name}</option>)}
            </select>
            <select className="filter" value={due} onChange={(e) => setParam('due', e.target.value)}>
              <option value="">Any follow-up</option>
              <option value="overdue">Overdue</option>
              <option value="today">Due today</option>
              <option value="week">Due this week</option>
            </select>
            {filtersOn && <button className="linkbtn" onClick={() => { setSearch(''); setSp(tab === 'open' ? {} : { bucket: tab }, { replace: true }); }}>Clear filters</button>}
          </div>
          <span className="muted small">{total} lead{total === 1 ? '' : 's'}</span>
        </div>
        {isAdmin && sel.size > 0 && (
          <div className="bulk-bar">
            <b>{sel.size} selected</b>
            <button className="linkbtn small" onClick={() => setSel(new Set())}>Clear</button>
            <div className="row-gap" style={{ marginLeft: 'auto' }}>
              {isAdmin && <>
                <select className="filter" value={moveTo} onChange={(e) => setMoveTo(e.target.value)}>
                  <option value="">Reassign to…</option>
                  {team.filter((t) => t.is_active && t.role !== 'admin' && t.id !== me!.id).map((t) => <option key={t.id} value={t.id}>{t.full_name}</option>)}
                </select>
                <button className="btn ghost sm" disabled={!moveTo} onClick={async () => {
                  try { const n = await rpc<number>('reassign_leads', { p_leads: [...sel], p_rm: moveTo }); toast(`${n} lead${n === 1 ? '' : 's'} reassigned`); setMoveTo(''); setReload((x) => x + 1); }
                  catch (e) { toast((e as Error).message, 'err'); }
                }}>Reassign</button>
              </>}
              <button className="btn danger sm" onClick={() => setDeleting(true)}>Delete</button>
            </div>
          </div>
        )}
        <div className="table-wrap">
          <table>
            <thead><tr>
              {isAdmin && <th className="chk"><input type="checkbox" aria-label="Select all on this page"
                checked={!!rows?.length && sel.size === rows.length}
                onChange={() => setSel(rows && sel.size !== rows.length ? new Set(rows.map((r) => r.id)) : new Set())} /></th>}
              <th>Name</th><th>Source</th><th>Product</th><th>Bucket</th><th>Interactions</th><th>Strikes</th><th>Next follow-up</th>
            </tr></thead>
            <tbody>
              {rows === null && [0, 1, 2, 3, 4].map((i) => <tr key={i}><td colSpan={9}><Skeleton /></td></tr>)}
              {rows?.map((l) => {
                const n = l.lead_entries?.[0]?.count ?? 0;
                return (
                  <tr key={l.id} className={`lead-row ${sel.has(l.id) ? 'selected' : ''}`} onClick={() => nav(`/leads/${l.id}`)}>
                    {isAdmin && <td className="chk" onClick={(e) => e.stopPropagation()}>
                      <input type="checkbox" aria-label={`Select ${l.name}`} checked={sel.has(l.id)}
                        onChange={() => { const n = new Set(sel); n.has(l.id) ? n.delete(l.id) : n.add(l.id); setSel(n); }} />
                    </td>}
                    <td>
                      <div className="lead-name">{l.name} {n === 0 && <span className="new-badge">New</span>}</div>
                      <div className="lead-sub">{fmtPhone(l.phone) || l.email}</div>
                    </td>
                    <td><span className="src">{l.source}</span>{l.campaign && <div className="lead-sub">{l.campaign}</div>}</td>
                    <td><ProductTag product={l.product} /></td>
                    <td>
                      <BucketPill bucket={l.bucket} />
                      {l.bucket === 'awaiting_meeting' && l.meeting_at && <div className="lead-sub">Meets {fmtDate(l.meeting_at)}</div>}
                      {l.bucket === 'deferred' && <div className="lead-sub">Until {fmtDate(l.deferred_until)}</div>}
                    </td>
                    <td>{n}</td>
                    <td><Strikes n={l.strikes} show={strikeBucket(l.bucket)} /></td>
                    <td>{l.bucket === 'client' ? <span className="muted small">Funded {fmtDate(l.funded_at ?? null)}</span> : l.bucket === 'converting' ? <span className="muted small">Prospect since {fmtDate(l.converted_at)}</span> : <FollowUp date={l.next_follow_up} />}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {rows?.length === 0 && <Empty>{filtersOn ? 'No leads match your filters.' : 'No leads here yet. Add one, or upload a list.'}</Empty>}
        </div>
        {total > PAGE && (
          <div className="pager">
            <button className="btn ghost sm" disabled={page === 0} onClick={() => setParam('page', String(page - 1))}>← Prev</button>
            <span className="muted small">Page {page + 1} of {Math.ceil(total / PAGE)}</span>
            <button className="btn ghost sm" disabled={(page + 1) * PAGE >= total} onClick={() => setParam('page', String(page + 1))}>Next →</button>
          </div>
        )}
      </div>
      {deleting && (
        <DeleteLeads ids={[...sel]} onClose={() => setDeleting(false)}
          onDone={(n) => { setDeleting(false); toast(`${n} lead${n === 1 ? '' : 's'} deleted`); setReload((x) => x + 1); }} />
      )}
    </div>
  );
}

function DeleteLeads({ ids, onClose, onDone }: { ids: string[]; onClose: () => void; onDone: (n: number) => void }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const needType = ids.length >= 10;
  return (
    <Modal title={`Delete ${ids.length} lead${ids.length === 1 ? '' : 's'}?`} onClose={onClose}
      footer={<><button className="btn ghost" onClick={onClose}>Cancel</button>
        <button className="btn danger" disabled={busy || (needType && text.trim() !== String(ids.length))} onClick={async () => {
          setBusy(true); setErr(null);
          try { onDone(await rpc<number>('delete_leads', { p_leads: ids })); }
          catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
        }}>{busy ? 'Deleting…' : 'Delete permanently'}</button></>}>
      <p style={{ marginBottom: 10 }}>This permanently removes the selected leads and everything about them: activity, notes, emails, summary, onboarding checklist, meetings, tasks and notifications. Reports and the funnel stop counting them. It can't be undone.</p>
      {needType && <Field label={`Type ${ids.length} to confirm`}><input value={text} onChange={(e) => setText(e.target.value)} inputMode="numeric" /></Field>}
      {err && <div className="form-err">{err}</div>}
    </Modal>
  );
}
