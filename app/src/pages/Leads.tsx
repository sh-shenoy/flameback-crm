import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useApp } from '../auth';
import { RmScopeSelect, scoped, useRmScope } from '../components/RmScope';
import { rpc, supabase } from '../lib/supabase';
import { addDays, fmtDate, fmtDateTime, fmtPhone, fmtTime, todayIST } from '../lib/format';
import { BUCKETS, PRODUCTS, type Bucket, type Lead } from '../lib/types';
import { Empty, Field, FollowUp, Modal, ProductTag, Skeleton, StagePill, Strikes, useToast } from '../components/ui';

type Row = Lead & { lead_entries: { count: number }[] };
const PAGE = 100;
const WORKING: Bucket[] = ['active_contact', 'awaiting_meeting', 'holding', 'deferred'];

export default function Leads() {
  const { me, sources, isAdmin, team } = useApp();
  const [sp, setSp] = useSearchParams();
  const nav = useNavigate();
  const tab = (sp.get('bucket') as Bucket | 'open' | 'new' | null) ?? 'open';
  const product = sp.get('product') ?? '';
  const source = sp.get('source') ?? '';
  const due = sp.get('due') ?? '';
  const added = sp.get('added') ?? '';
  const sort = sp.get('sort') ?? '';
  const batch = sp.get('upload') ?? '';
  const [batches, setBatches] = useState<{ id: string; file_name: string; created_at: string; inserted: number }[]>([]);
  useEffect(() => {
    supabase.from('import_batches').select('id, file_name, created_at, inserted').order('created_at', { ascending: false }).limit(50)
      .then(({ data }) => setBatches((data as typeof batches) ?? []));
  }, []);   // '' = most urgent, 'new' = newest added, 'old' = oldest added
  const addedFrom = sp.get('from') ?? '';
  const addedTo = sp.get('to') ?? '';
  const sc = useRmScope();
  const scopeKey = sc.ids === null ? 'all' : sc.ids.join(',');
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
    x = scoped(x, sc.ids);
    // when the lead was added (IST days)
    const ist = (d: string) => `${d}T00:00:00+05:30`;
    const t0 = todayIST();
    const range: [string, string] | null = added === 'today' ? [t0, t0] : added === 'yesterday' ? [addDays(t0, -1), addDays(t0, -1)]
      : added === '7' ? [addDays(t0, -6), t0] : added === '30' ? [addDays(t0, -29), t0] : added === 'month' ? [t0.slice(0, 8) + '01', t0]
      : added === 'custom' && addedFrom ? [addedFrom, addedTo || t0] : null;
    if (range) x = x.gte('created_at', ist(range[0])).lt('created_at', ist(addDays(range[1], 1)));
    if (batch) x = x.eq('import_batch_id', batch);
    const today = todayIST();
    if (due === 'new') x = x.eq('bucket', 'active_contact').is('next_follow_up', null);
    if (due === 'overdue') x = x.lt('next_follow_up', today);
    if (due === 'today') x = x.eq('next_follow_up', today);
    if (due === 'week') x = x.lte('next_follow_up', addDays(today, 7));
    if (q.trim()) {
      const like = `%${q.trim().replace(/[%,()]/g, '')}%`;
      const digits = q.replace(/\D/g, '');
      const ors = [`name.ilike.${like}`, `email.ilike.${like}`, `campaign.ilike.${like}`];
      if (digits.length >= 3) { ors.push(`phone.ilike.%${digits}%`); ors.push(`alt_phone.ilike.%${digits}%`); }
      x = x.or(ors.join(','));
    }
    return x;
  }, [product, source, due, q, me, added, addedFrom, addedTo, scopeKey, batch]);   // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    let cancelled = false;
    setRows(null);
    let query = supabase.from('leads').select('*, lead_entries(count)', { count: 'exact' });
    query = tab === 'open' ? query.in('bucket', WORKING)
      : tab === 'new' ? query.eq('bucket', 'active_contact').is('next_follow_up', null)
      : tab === 'active_contact' ? query.eq('bucket', 'active_contact').not('next_follow_up', 'is', null)
      : query.eq('bucket', tab);
    query = applyFilters(query);
    query = (sort === 'new' ? query.order('created_at', { ascending: false })
      : sort === 'old' ? query.order('created_at', { ascending: true })
      : query.order('next_follow_up', { ascending: true, nullsFirst: false }).order('created_at', { ascending: false }))
      .range(page * PAGE, page * PAGE + PAGE - 1);
    query.then(({ data, count }: { data: Row[] | null; count: number | null }) => {
      if (cancelled) return;
      setRows(data ?? []);
      setTotal(count ?? 0);
      setSel(new Set());
    });
    // tab counts
    Promise.all([...WORKING, 'converting' as Bucket, 'client' as Bucket, 'new'].map(async (b) => {
      let cq = supabase.from('leads').select('id', { count: 'exact', head: true });
      cq = b === 'new' ? cq.eq('bucket', 'active_contact').is('next_follow_up', null)
        : b === 'active_contact' ? cq.eq('bucket', 'active_contact').not('next_follow_up', 'is', null) : cq.eq('bucket', b);
      const { count } = await applyFilters(cq);
      return [b, count ?? 0] as const;
    })).then((pairs) => {
      if (cancelled) return;
      const c: Record<string, number> = Object.fromEntries(pairs);
      c.open = WORKING.reduce((s, b) => s + (c[b] ?? 0), 0) + (c.new ?? 0);
      setCounts(c);
    });
    return () => { cancelled = true; };
  }, [tab, page, applyFilters, reload, sort]);

  const tabs: { key: string; label: string }[] = [
    { key: 'open', label: 'All open' },
    { key: 'new', label: 'New' },
    ...BUCKETS.filter((b) => b.key !== 'out').map((b) => ({ key: b.key, label: b.label })),
  ];
  const strikeBucket = (b: Bucket) => ['active_contact', 'awaiting_meeting'].includes(b);
  const filtersOn = product || source || due || q || added || batch;

  return (
    <div className="main-inner">
      <div className="page-head">
        <div><h1>Leads</h1><p>{isAdmin ? 'Your team\'s leads.' : 'Your leads: new ones to contact, then follow-ups, most urgent first.'}</p></div>
        <div className="row-gap">
          <RmScopeSelect s={sc} />
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
              <option value="new">New (not contacted yet)</option>
              <option value="overdue">Overdue</option>
              <option value="today">Due today</option>
              <option value="week">Due this week</option>
            </select>
            <select className="filter" value={sort} onChange={(e) => setParam('sort', e.target.value)} aria-label="Sort">
              <option value="">Sort: most urgent</option>
              <option value="new">Sort: newest added</option>
              <option value="old">Sort: oldest added</option>
            </select>
            <select className="filter" value={added} onChange={(e) => setParam('added', e.target.value)} aria-label="Added">
              <option value="">Added any time</option>
              <option value="today">Added today</option>
              <option value="yesterday">Added yesterday</option>
              <option value="7">Added last 7 days</option>
              <option value="30">Added last 30 days</option>
              <option value="month">Added this month</option>
              <option value="custom">Added between…</option>
            </select>
            {batches.length > 0 && (
              <select className="filter" value={batch} onChange={(e) => setParam('upload', e.target.value)} aria-label="From upload">
                <option value="">From any upload or added by hand</option>
                {batches.map((b) => <option key={b.id} value={b.id}>{b.file_name} · {fmtDateTime(b.created_at)} ({b.inserted})</option>)}
              </select>
            )}
            {added === 'custom' && <>
              <input type="date" className="filter" value={addedFrom} max={addedTo || undefined} onChange={(e) => setParam('from', e.target.value)} aria-label="Added from" />
              <span className="muted small">to</span>
              <input type="date" className="filter" value={addedTo} min={addedFrom || undefined} onChange={(e) => setParam('to', e.target.value)} aria-label="Added to" />
            </>}
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
              <th>Name</th><th>Source</th><th>Product</th><th>Stage</th><th className="sortable" onClick={() => setParam('sort', sort === 'new' ? 'old' : 'new')} title="Sort by date added">Added {sort === 'new' ? '↓' : sort === 'old' ? '↑' : ''}</th><th>Interactions</th><th>Strikes</th><th>Next follow-up</th>
            </tr></thead>
            <tbody>
              {rows === null && [0, 1, 2, 3, 4].map((i) => <tr key={i}><td colSpan={10}><Skeleton /></td></tr>)}
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
                      <StagePill lead={l} />
                      {l.bucket === 'awaiting_meeting' && l.meeting_at && <div className="lead-sub">Meets {fmtDate(l.meeting_at)}</div>}
                      {l.bucket === 'deferred' && <div className="lead-sub">Until {fmtDate(l.deferred_until)}</div>}
                    </td>
                    <td className="small nowrap">{fmtDate(l.created_at)}<div className="lead-sub">{fmtTime(l.created_at)}</div></td>
                    <td>{n}</td>
                    <td><Strikes n={l.strikes} show={strikeBucket(l.bucket)} /></td>
                    <td>{l.bucket === 'client' ? <span className="muted small">Funded {fmtDate(l.funded_at ?? null)}</span> : l.bucket === 'converting' ? <span className="muted small">Prospect since {fmtDate(l.converted_at)}</span> : l.bucket === 'active_contact' && !l.next_follow_up ? ((l as { lead_entries?: { count: number }[] }).lead_entries?.[0]?.count ? <span className="muted small" title="Contacted, but no follow-up date set">No date set</span> : <span className="tag-new">To contact</span>) : <><FollowUp date={l.next_follow_up} />{l.next_follow_up_at && <div className="lead-sub">{fmtTime(l.next_follow_up_at)}</div>}</>}</td>
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
