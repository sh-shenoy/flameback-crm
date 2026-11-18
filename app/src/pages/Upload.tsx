import { useEffect, useMemo, useState } from 'react';
import Papa from 'papaparse';
import readXlsxFile from 'read-excel-file';
import { useApp } from '../auth';
import { rpc, supabase } from '../lib/supabase';
import { normalizeEmail, normalizePhone } from '../lib/phone';
import { fmtDateTime, fmtPhone } from '../lib/format';
import { PRODUCTS, normalizeProduct, type ImportBatch } from '../lib/types';
import { Empty, Field, Modal, useToast } from '../components/ui';

const MAX_ROWS = 10000;
const CHUNK = 200;

type FieldKey =
  | 'name' | 'first_name' | 'last_name' | 'phone' | 'email' | 'product' | 'source' | 'campaign'
  | 'city' | 'age' | 'marital_status' | 'income_band' | 'language' | 'residency' | 'requirement' | 'budget' | 'referred_by' | 'rm_email';

const FIELDS: { key: FieldKey; label: string; syn: string[]; admin?: boolean }[] = [
  { key: 'name', label: 'Full name', syn: ['name', 'full name', 'fullname', 'lead name', 'client name', 'contact name', 'customer name'] },
  { key: 'first_name', label: 'First name', syn: ['first name', 'firstname', 'first', 'given name'] },
  { key: 'last_name', label: 'Last name', syn: ['last name', 'lastname', 'surname', 'last', 'family name'] },
  { key: 'phone', label: 'Phone', syn: ['phone', 'mobile', 'mobile no', 'mobile number', 'phone number', 'contact', 'contact number', 'whatsapp', 'cell', 'phone no', 'mob'] },
  { key: 'email', label: 'Email', syn: ['email', 'e-mail', 'email id', 'email address', 'mail'] },
  { key: 'product', label: 'Product (RIA / PMS / US RIA)', syn: ['product', 'interest', 'product interest'] },
  { key: 'source', label: 'Source', syn: ['source', 'lead source', 'channel'] },
  { key: 'campaign', label: 'Campaign', syn: ['campaign', 'campaign name', 'ad name', 'adset', 'ad set name', 'utm campaign'] },
  { key: 'city', label: 'City / region', syn: ['city', 'location', 'region', 'town'] },
  { key: 'age', label: 'Age', syn: ['age'] },
  { key: 'marital_status', label: 'Marital status', syn: ['marital status', 'marital'] },
  { key: 'income_band', label: 'Income level', syn: ['income', 'income level', 'annual income', 'income band'] },
  { key: 'language', label: 'Language', syn: ['language', 'language preference', 'preferred language', 'languages'] },
  { key: 'residency', label: 'Residency (Resident / NRI)', syn: ['residency', 'residential status', 'resident status', 'nri', 'is nri', 'resident'] },
  { key: 'requirement', label: 'What they want / notes', syn: ['notes', 'note', 'requirement', 'comments', 'comment', 'remarks', 'message'] },
  { key: 'budget', label: 'Budget', syn: ['budget', 'investment amount', 'amount', 'ticket size'] },
  { key: 'referred_by', label: 'Referred by', syn: ['referred by', 'referrer', 'referral'] },
  { key: 'rm_email', label: 'RM email (assign to)', syn: ['rm', 'rm email', 'assigned to', 'owner', 'relationship manager'], admin: true },
];

const norm = (s: string) => s.toLowerCase().replace(/[_\-.]+/g, ' ').replace(/\s+/g, ' ').trim();

type PreviewStatus = 'ok' | 'file_dup' | 'db_dup' | 'invalid';
interface PRow { row: number; data: Record<string, string>; status: PreviewStatus; note: string; phone: string | null; email: string | null }
interface Result { row: number; status: 'inserted' | 'merged' | 'skipped' | 'failed'; lead_id?: string; message?: string }

export default function Upload() {
  const { sources, isAdmin, team } = useApp();
  const [step, setStep] = useState<1 | 2 | 3 | 4>(1);
  const [fileName, setFileName] = useState('');
  const [header, setHeader] = useState<string[]>([]);
  const [raw, setRaw] = useState<string[][]>([]);
  const [map, setMap] = useState<Record<number, FieldKey | ''>>({});
  const [source, setSource] = useState('');
  const [campaign, setCampaign] = useState('');
  const [product, setProduct] = useState('');
  const [dupMode, setDupMode] = useState<'skip' | 'merge'>('skip');
  const [assignTo, setAssignTo] = useState('');   // admins: '' = automatic routing, or one RM
  const [preview, setPreview] = useState<PRow[] | null>(null);
  const [pFilter, setPFilter] = useState<PreviewStatus | 'all'>('all');
  const [progress, setProgress] = useState(0);
  const [results, setResults] = useState<Result[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [batches, setBatches] = useState<ImportBatch[]>([]);
  const [undo, setUndo] = useState<ImportBatch | null>(null);

  const loadBatches = async () => {
    const { data } = await supabase.from('import_batches').select('*').order('created_at', { ascending: false }).limit(50);
    setBatches((data as ImportBatch[]) ?? []);
  };
  useEffect(() => { loadBatches(); }, []);

  function reset() {
    setStep(1); setFileName(''); setHeader([]); setRaw([]); setMap({}); setPreview(null); setResults(null);
    setProgress(0); setErr(null); setCampaign(''); setPFilter('all');
  }

  async function onFile(file: File) {
    setErr(null);
    try {
      let rows: string[][];
      if (/\.xlsx$/i.test(file.name)) {
        const r = await readXlsxFile(file);
        rows = r.map((row) => row.map((c) => (c === null || c === undefined ? '' : c instanceof Date ? c.toISOString().slice(0, 10) : String(c))));
      } else if (/\.(csv|txt)$/i.test(file.name)) {
        rows = await new Promise((res, rej) => Papa.parse<string[]>(file, { skipEmptyLines: 'greedy', complete: (r) => res(r.data), error: rej }));
      } else {
        setErr('Upload a .xlsx or .csv file. For .xls, open it in Excel and save as .xlsx first.');
        return;
      }
      rows = rows.filter((r) => r.some((c) => String(c).trim() !== ''));
      if (rows.length < 2) { setErr('The file needs a header row and at least one lead.'); return; }
      if (rows.length - 1 > MAX_ROWS) { setErr(`That's ${rows.length - 1} rows. Split it into files of up to ${MAX_ROWS.toLocaleString('en-IN')}.`); return; }
      const h = rows[0]!.map((c) => String(c).trim());
      // auto-map headers
      const m: Record<number, FieldKey | ''> = {};
      const used = new Set<FieldKey>();
      h.forEach((col, i) => {
        const f = FIELDS.find((f) => (!f.admin || isAdmin) && !used.has(f.key) && f.syn.some((s) => norm(s) === norm(col)));
        m[i] = f ? f.key : '';
        if (f) used.add(f.key);
      });
      setFileName(file.name); setHeader(h); setRaw(rows.slice(1)); setMap(m);
      setStep(2);
    } catch (e) {
      setErr(`Couldn't read that file: ${(e as Error).message}`);
    }
  }

  const mapped = useMemo(() => new Set(Object.values(map).filter(Boolean)), [map]);
  const mapErr = (() => {
    if (!mapped.has('name') && !mapped.has('first_name')) return 'Map a column to Full name (or First name).';
    if (!mapped.has('phone') && !mapped.has('email')) return 'Map a Phone or Email column.';
    if (!source && !mapped.has('source')) return 'Pick a source for this upload.';
    if (!product && !mapped.has('product')) return 'Pick a product for this upload, or map a Product column.';
    const counts: Record<string, number> = {};
    Object.values(map).forEach((v) => v && (counts[v] = (counts[v] ?? 0) + 1));
    const twice = Object.entries(counts).find(([, n]) => n > 1);
    if (twice) return `Two columns are mapped to ${FIELDS.find((f) => f.key === twice[0])?.label}.`;
    return null;
  })();

  async function buildPreview() {
    setErr(null);
    const srcNames = new Set(sources.map((s) => s.name.toLowerCase()));
    const seen = new Map<string, number>();
    const out: PRow[] = raw.map((r, idx) => {
      const d: Record<string, string> = {};
      Object.entries(map).forEach(([i, k]) => { if (k) d[k] = String(r[+i] ?? '').trim(); });
      if (!d.name && (d.first_name || d.last_name)) d.name = [d.first_name, d.last_name].filter(Boolean).join(' ');
      delete d.first_name; delete d.last_name;
      if (d.product) d.product = normalizeProduct(d.product) ?? d.product;
      if (d.residency !== undefined) {
        const v = d.residency.toLowerCase();
        d.residency = /nri|non[- ]?resident|^y(es)?$|overseas|abroad/.test(v) ? 'nri' : /resident|^n(o)?$|india/.test(v) ? 'resident' : '';
      }
      if (d.source) d.source = sources.find((s) => s.name.toLowerCase() === d.source!.toLowerCase())?.name ?? d.source;
      const phone = normalizePhone(d.phone);
      const email = normalizeEmail(d.email);
      const row = idx + 2;
      let status: PreviewStatus = 'ok'; let note = '';
      if (!d.name) { status = 'invalid'; note = 'Name is missing'; }
      else if (phone === 'invalid') { status = 'invalid'; note = `Phone "${d.phone}" is not valid`; }
      else if (email === 'invalid') { status = 'invalid'; note = `Email "${d.email}" is not valid`; }
      else if (!phone && !email) { status = 'invalid'; note = 'No phone or email'; }
      else if ((d.product || product) && !PRODUCTS.includes((d.product || product) as never)) { status = 'invalid'; note = `Product "${d.product}" must be RIA, PMS or US RIA`; }
      else if (d.source && !srcNames.has(d.source.toLowerCase())) { status = 'invalid'; note = `Unknown source "${d.source}"`; }
      else if (d.age && !/^\d{2,3}$/.test(d.age)) { status = 'invalid'; note = `Age "${d.age}" is not a number`; }
      else {
        const keys = [phone && `p:${phone}`, email && `e:${email}`].filter(Boolean) as string[];
        const first = keys.map((k) => seen.get(k)).find((x) => x !== undefined);
        if (first !== undefined) { status = 'file_dup'; note = `Same person as row ${first}`; }
        keys.forEach((k) => !seen.has(k) && seen.set(k, row));
      }
      return { row, data: d, status, note, phone: phone === 'invalid' ? null : phone, email: email === 'invalid' ? null : email };
    });

    // existing leads (in chunks)
    const ok = out.filter((r) => r.status === 'ok');
    for (let i = 0; i < ok.length; i += 500) {
      const part = ok.slice(i, i + 500);
      const { data, error } = await supabase.rpc('find_duplicates_bulk', {
        p_phones: part.map((r) => r.phone).filter(Boolean),
        p_emails: part.map((r) => r.email).filter(Boolean),
      });
      if (error) { setErr(error.message); return; }
      const byPhone = new Map<string, { name: string; rm_name: string; can_open: boolean }>();
      const byEmail = new Map<string, { name: string; rm_name: string; can_open: boolean }>();
      for (const d of (data ?? []) as { phone: string; email: string; name: string; rm_name: string; can_open: boolean }[]) {
        if (d.phone) byPhone.set(d.phone, d);
        if (d.email) byEmail.set(d.email, d);
      }
      for (const r of part) {
        const hit = (r.phone && byPhone.get(r.phone)) || (r.email && byEmail.get(r.email));
        if (hit) {
          r.status = 'db_dup';
          r.note = `Already in CRM as ${hit.name} (with ${hit.rm_name})` +
            (dupMode === 'merge' ? (hit.can_open ? ' · will merge' : ' · not yours, will skip') : ' · will skip');
        }
      }
    }
    setPreview(out);
    setStep(3);
  }

  async function runImport() {
    if (!preview) return;
    setErr(null); setStep(4); setProgress(0);
    // Everything goes to the database (it re-checks and records counts on the batch);
    // rows the browser already flagged keep the browser's clearer message.
    const clientNote = new Map(preview.filter((r) => r.status === 'invalid').map((r) => [r.row, r.note]));
    try {
      const batch = await rpc<string>('start_import', {
        p_file_name: fileName, p_source: source || 'Other', p_campaign: campaign, p_product: product || null,
        p_dup_mode: dupMode, p_total: preview.length,
      });
      const all: Result[] = [];
      for (let i = 0; i < preview.length; i += CHUNK) {
        const part = preview.slice(i, i + CHUNK).map((r) => ({
          row: r.row, ...r.data,
          ...(isAdmin && assignTo && !r.data.rm_email ? { rm_id: assignTo } : {}),
          // never send an unparseable age; the row is reported as failed either way
          ...(clientNote.has(r.row) && r.data.age && !/^\d{2,3}$/.test(r.data.age) ? { age: '', name: '' } : {}),
        }));
        const res = await rpc<Result[]>('import_rows', { p_batch: batch, p_rows: part });
        all.push(...res.map((x) => (x.status === 'failed' && clientNote.has(x.row) ? { ...x, message: clientNote.get(x.row) } : x)));
        setProgress(Math.min(1, (i + CHUNK) / preview.length));
      }
      setProgress(1);
      setResults(all.sort((a, b) => a.row - b.row));
      loadBatches();
    } catch (e) {
      setErr((e as Error).message);
    }
  }

  function downloadIssues() {
    if (!results || !preview) return;
    const byRow = new Map(preview.map((r) => [r.row, r]));
    const bad = results.filter((r) => r.status === 'failed' || r.status === 'skipped');
    const cols = [...new Set(bad.flatMap((r) => Object.keys(byRow.get(r.row)?.data ?? {})))];
    const csv = Papa.unparse([
      ['Row', 'Result', 'Reason', ...cols],
      ...bad.map((r) => [r.row, r.status, r.message ?? '', ...cols.map((c) => byRow.get(r.row)?.data[c] ?? '')]),
    ]);
    download(`${fileName.replace(/\.[^.]+$/, '')}-not-imported.csv`, csv);
  }

  const counts = (preview ?? []).reduce((a, r) => ({ ...a, [r.status]: (a[r.status] ?? 0) + 1 }), {} as Record<string, number>);
  const rc = (results ?? []).reduce((a, r) => ({ ...a, [r.status]: (a[r.status] ?? 0) + 1 }), {} as Record<string, number>);

  return (
    <div className="main-inner">
      <div className="page-head">
        <div><h1>Upload leads</h1><p>Bring in a list from an Excel or CSV file. New leads go to the right RM automatically (routing).</p></div>
        <button className="btn ghost" onClick={downloadTemplate}>Download template</button>
      </div>

      <div className="steps">
        {['Choose file', 'Match columns', 'Check', 'Import'].map((s, i) => (
          <div key={s} className={`stp ${step === i + 1 ? 'on' : step > i + 1 ? 'done' : ''}`}><span>{step > i + 1 ? '✓' : i + 1}</span>{s}</div>
        ))}
      </div>

      {err && <div className="banner warn">{err}</div>}

      {step === 1 && (
        <div className="panel pad">
          <div className="grid2">
            <Field label="Source of this list" required hint="Applies to every row unless the file has a Source column.">
              <select value={source} onChange={(e) => setSource(e.target.value)}>
                <option value="">Select…</option>
                <optgroup label="Warm">{sources.filter((s) => s.kind === 'warm').map((s) => <option key={s.name}>{s.name}</option>)}</optgroup>
                <optgroup label="Cold">{sources.filter((s) => s.kind === 'cold').map((s) => <option key={s.name}>{s.name}</option>)}</optgroup>
              </select>
            </Field>
            <Field label="Campaign" hint="Optional. A Campaign column in the file overrides this.">
              <input value={campaign} onChange={(e) => setCampaign(e.target.value)} placeholder="e.g. Meta · Nov RIA push" />
            </Field>
            <Field label="Product" required hint="A Product column in the file overrides this.">
              <select value={product} onChange={(e) => setProduct(e.target.value)}>
                <option value="">Select…</option>{PRODUCTS.map((p) => <option key={p}>{p}</option>)}
              </select>
            </Field>
            <Field label="If someone is already in the CRM">
              <select value={dupMode} onChange={(e) => setDupMode(e.target.value as 'skip' | 'merge')}>
                <option value="skip">Skip them (report them to me)</option>
                <option value="merge">Merge: fill in their empty details</option>
              </select>
            </Field>
            {isAdmin && (
              <Field label="Who gets these leads" hint={assignTo ? 'An RM email column in the file still wins for its rows.' : 'Each lead goes to the next RM who fits (product, NRI, language, limits, leave).'}>
                <select value={assignTo} onChange={(e) => setAssignTo(e.target.value)}>
                  <option value="">Automatic (routing)</option>
                  {team.filter((t) => t.is_active && t.role !== 'admin').map((t) => <option key={t.id} value={t.id}>All to {t.full_name}</option>)}
                </select>
              </Field>
            )}
          </div>
          <label className={`dropzone ${!source || !product ? 'disabled' : ''}`}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => { e.preventDefault(); if (source && product && e.dataTransfer.files[0]) onFile(e.dataTransfer.files[0]); }}>
            <input type="file" accept=".xlsx,.csv" disabled={!source || !product} onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])} hidden />
            <b>{source && product ? 'Drop an .xlsx or .csv file here, or click to choose' : 'Pick the source and product first'}</b>
            <div className="muted small">Up to {MAX_ROWS.toLocaleString('en-IN')} rows. The first row must be the column headers.</div>
          </label>
        </div>
      )}

      {step === 2 && (
        <div className="panel">
          <div className="panel-head"><h2>Match your columns · {fileName}</h2><span className="muted small">{raw.length} rows</span></div>
          <div className="table-wrap">
            <table>
              <thead><tr><th>Column in your file</th><th>Sample values</th><th>Goes into</th></tr></thead>
              <tbody>
                {header.map((h, i) => (
                  <tr key={i}>
                    <td><b>{h || <span className="muted">(no header)</span>}</b></td>
                    <td className="muted small">{raw.slice(0, 3).map((r) => r[i]).filter(Boolean).join(' · ').slice(0, 80)}</td>
                    <td>
                      <select className="filter" value={map[i] ?? ''} onChange={(e) => setMap({ ...map, [i]: e.target.value as FieldKey })}>
                        <option value="">— Don't import —</option>
                        {FIELDS.filter((f) => !f.admin || isAdmin).map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="panel-foot">
            {mapErr ? <span className="red small">{mapErr}</span> : <span className="muted small">Looks good.</span>}
            <div className="row-gap">
              <button className="btn ghost" onClick={reset}>Start over</button>
              <button className="btn" disabled={!!mapErr} onClick={buildPreview}>Check rows →</button>
            </div>
          </div>
        </div>
      )}

      {step === 3 && preview && (
        <div className="panel">
          <div className="panel-head">
            <div className="chips">
              <button className={`chip ${pFilter === 'all' ? 'on' : ''}`} onClick={() => setPFilter('all')}>All {preview.length}</button>
              <button className={`chip ${pFilter === 'ok' ? 'on' : ''}`} onClick={() => setPFilter('ok')}><i className="dot ok" />New {counts.ok ?? 0}</button>
              <button className={`chip ${pFilter === 'db_dup' ? 'on' : ''}`} onClick={() => setPFilter('db_dup')}><i className="dot warn" />Already in CRM {counts.db_dup ?? 0}</button>
              <button className={`chip ${pFilter === 'file_dup' ? 'on' : ''}`} onClick={() => setPFilter('file_dup')}><i className="dot warn" />Repeated in file {counts.file_dup ?? 0}</button>
              <button className={`chip ${pFilter === 'invalid' ? 'on' : ''}`} onClick={() => setPFilter('invalid')}><i className="dot bad" />Can't import {counts.invalid ?? 0}</button>
            </div>
          </div>
          <div className="table-wrap tall">
            <table>
              <thead><tr><th>Row</th><th>Name</th><th>Phone</th><th>Email</th><th>Product</th><th>Source</th><th>Check</th></tr></thead>
              <tbody>
                {preview.filter((r) => pFilter === 'all' || r.status === pFilter).slice(0, 300).map((r) => (
                  <tr key={r.row} className={`pv-${r.status}`}>
                    <td className="muted">{r.row}</td>
                    <td>{r.data.name}</td>
                    <td>{r.phone ? fmtPhone(r.phone) : <span className="muted">{r.data.phone}</span>}</td>
                    <td>{r.email ?? <span className="muted">{r.data.email}</span>}</td>
                    <td>{r.data.product || product}</td>
                    <td>{r.data.source || source}</td>
                    <td className="small">{r.status === 'ok' ? 'New' : r.note}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="panel-foot">
            <span className="muted small">
              {counts.ok ?? 0} new lead{counts.ok === 1 ? '' : 's'} will be added and shared round-robin.
              {(counts.db_dup ?? 0) + (counts.file_dup ?? 0) > 0 && ` ${(counts.db_dup ?? 0) + (counts.file_dup ?? 0)} duplicate${dupMode === 'merge' ? 's will be merged where they are yours, otherwise skipped' : 's will be skipped'}.`}
              {counts.invalid ? ` ${counts.invalid} can't be imported.` : ''}
            </span>
            <div className="row-gap">
              <button className="btn ghost" onClick={() => setStep(2)}>← Back</button>
              <button className="btn" disabled={!counts.ok && !(dupMode === 'merge' && counts.db_dup)} onClick={runImport}>Import {counts.ok ?? 0} lead{counts.ok === 1 ? '' : 's'}</button>
            </div>
          </div>
        </div>
      )}

      {step === 4 && (
        <div className="panel pad">
          {!results ? (
            <>
              <h2 style={{ marginBottom: 12 }}>Importing {fileName}…</h2>
              <div className="progress"><i style={{ width: `${Math.round(progress * 100)}%` }} /></div>
              <p className="muted small" style={{ marginTop: 8 }}>{Math.round(progress * 100)}% · keep this tab open.</p>
            </>
          ) : (
            <>
              <h2 style={{ marginBottom: 12 }}>Done · {fileName}</h2>
              <div className="cards">
                <div className="card"><div className="k">Added</div><div className="v">{rc.inserted ?? 0}</div></div>
                <div className="card"><div className="k">Merged</div><div className="v">{rc.merged ?? 0}</div></div>
                <div className="card"><div className="k">Skipped</div><div className="v">{rc.skipped ?? 0}</div><div className="meta">already in the CRM</div></div>
                <div className="card"><div className="k">Not imported</div><div className={`v ${rc.failed ? 'red' : ''}`}>{rc.failed ?? 0}</div></div>
              </div>
              <div className="row-gap">
                {(rc.failed || rc.skipped) ? <button className="btn ghost" onClick={downloadIssues}>Download skipped & failed rows</button> : null}
                <button className="btn" onClick={reset}>Upload another file</button>
              </div>
            </>
          )}
        </div>
      )}

      <div className="panel" style={{ marginTop: 26 }}>
        <div className="panel-head"><h2>Upload history</h2><span className="muted small">{isAdmin ? 'All uploads' : 'Your uploads'}</span></div>
        <div className="table-wrap">
          <table>
            <thead><tr><th>File</th><th>When</th><th>Source / campaign</th><th>Product</th><th>Rows</th><th>Added</th><th>Merged</th><th>Skipped</th><th>Failed</th><th /></tr></thead>
            <tbody>
              {batches.map((b) => (
                <tr key={b.id}>
                  <td><b>{b.file_name}</b></td>
                  <td className="small">{fmtDateTime(b.created_at)}</td>
                  <td><span className="src">{b.source}</span>{b.campaign && <div className="lead-sub">{b.campaign}</div>}</td>
                  <td>{b.product ?? 'From file'}</td>
                  <td>{b.total_rows}</td><td>{b.inserted}</td><td>{b.merged}</td><td>{b.skipped}</td><td>{b.failed}</td>
                  <td>
                    {b.undone_count ? <div className="muted small">{b.undone_count} removed</div> : null}
                    {isAdmin && b.inserted > (b.undone_count ?? 0) && <button className="btn ghost sm" onClick={() => setUndo(b)}>Remove leads</button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {batches.length === 0 && <Empty>No uploads yet.</Empty>}
        </div>
      </div>

      {undo && <RemoveUploadLeads batch={undo} onClose={() => setUndo(null)} onDone={() => { setUndo(null); loadBatches(); }} />}
    </div>
  );
}

function download(name: string, text: string) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob(['﻿' + text], { type: 'text/csv;charset=utf-8' }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

function downloadTemplate() {
  download('flameback-leads-template.csv', Papa.unparse([
    ['Full name', 'Phone', 'Email', 'Product', 'Campaign', 'City', 'Age', 'Notes'],
    ['Priya Shah', '98200 12345', 'priya@example.com', 'RIA', 'Nov RIA push', 'Mumbai', '38', 'Asked about retirement planning'],
  ]));
}

/* ───────── remove the leads an upload created ───────── */
function RemoveUploadLeads({ batch, onClose, onDone }: { batch: ImportBatch; onClose: () => void; onDone: () => void }) {
  const { isAdmin } = useApp();
  const toast = useToast();
  const [counts, setCounts] = useState<{ untouched: number; worked: number } | null>(null);
  const [mode, setMode] = useState<'untouched' | 'all'>('all');
  const [confirmText, setConfirmText] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    supabase.from('leads').select('id, bucket, strikes, lead_entries(count)').eq('import_batch_id', batch.id).limit(10000)
      .then(({ data }) => {
        let untouched = 0, worked = 0;
        for (const l of (data ?? []) as { bucket: string; strikes: number; lead_entries: { count: number }[] }[]) {
          if (l.bucket === 'active_contact' && l.strikes === 0 && !(l.lead_entries?.[0]?.count)) untouched++; else worked++;
        }
        setCounts({ untouched, worked });
      });
  }, [batch.id]);

  const total = counts ? counts.untouched + counts.worked : 0;
  const n = mode === 'all' ? total : counts?.untouched ?? 0;
  const ok = n > 0 && (mode === 'untouched' || confirmText.trim() === String(total));

  async function go() {
    setBusy(true);
    try {
      const removed = await rpc<number>('remove_import_leads', { p_batch: batch.id, p_include_worked: mode === 'all' });
      toast(`${removed} lead${removed === 1 ? '' : 's'} removed`);
      onDone();
    } catch (e) { toast((e as Error).message, 'err'); } finally { setBusy(false); }
  }

  return (
    <Modal title={`Remove leads · ${batch.file_name}`} onClose={onClose}
      footer={<><button className="btn ghost" onClick={onClose}>Cancel</button>
        <button className="btn danger" disabled={busy || !ok} onClick={go}>{busy ? 'Removing…' : `Remove ${n} lead${n === 1 ? '' : 's'}`}</button></>}>
      {!counts ? <p className="muted">Counting leads from this upload…</p> : total === 0 ? <p>All leads from this upload have already been removed.</p> : (
        <>
          <p style={{ marginBottom: 12 }}>This upload still has <b>{total}</b> lead{total === 1 ? '' : 's'} in Argus: <b>{counts.untouched}</b> nobody has worked yet and <b>{counts.worked}</b> with activity logged or moved on.</p>
          <div className="result-list">
            <button className={mode === 'all' ? 'on' : ''} disabled={!isAdmin} onClick={() => setMode('all')}
              title={isAdmin ? undefined : 'Only an admin can remove leads that have been worked'}>
              <b>All leads from this upload ({total})</b><span>Gone from everywhere, and the upload leaves the history</span>
            </button>
            <button className={mode === 'untouched' ? 'on' : ''} onClick={() => setMode('untouched')}>
              <b>Only untouched leads ({counts.untouched})</b><span>Leads someone has worked stay</span>
            </button>
          </div>
          {mode === 'all' && (
            <Field label={`Type ${total} to confirm`} hint="Everything about them goes too: activity, notes, emails, summary, onboarding checklist, meetings, tasks and notifications. Reports and the funnel stop counting them. This can't be undone.">
              <input value={confirmText} onChange={(e) => setConfirmText(e.target.value)} inputMode="numeric" />
            </Field>
          )}
          <p className="hint" style={{ marginTop: 10 }}>Details merged into existing leads during this upload are not affected.</p>
        </>
      )}
    </Modal>
  );
}
