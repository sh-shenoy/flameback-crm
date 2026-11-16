import { useState } from 'react';
import { GMAIL_FLAG, GMAIL_RESULT, useApp } from '../auth';
import { supabase } from '../lib/supabase';
import { calcom, describeSync, type ConnectResult, type SyncResult } from '../lib/calcom';
import { fmtDateTime } from '../lib/format';
import { Field, useToast } from '../components/ui';

export default function Connections() {
  return (
    <div className="main-inner">
      <div className="page-head"><div><h1>Connections</h1><p>Connect your Cal.com and Gmail so meetings and emails flow into the CRM by themselves.</p></div></div>
      <CalcomPanel />
      <GmailPanel />
    </div>
  );
}

function CalcomPanel() {
  const { me, reloadRef } = useApp();
  const toast = useToast();
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [manual, setManual] = useState<ConnectResult | null>(null);
  const [sync, setSync] = useState<SyncResult | null>(null);
  const connected = !!me?.cal_connected_at;

  async function connect(apiKey: string) {
    setBusy(true); setErr(null); setManual(null);
    try {
      const r = await calcom<ConnectResult>({ action: 'connect', api_key: apiKey });
      if (!r.webhook_ok) setManual(r);
      if (r.event_types) setSync(r.event_types);
      toast((r.webhook_ok ? 'Cal.com connected' : 'Cal.com connected, one manual step left') + (r.event_types?.created.length ? ` · ${describeSync(r.event_types)}` : ''));
      setKey('');
      await reloadRef();
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  }
  async function syncTypes() {
    setBusy(true); setErr(null);
    try { const r = await calcom<SyncResult>({ action: 'sync_event_types' }); setSync(r); toast(describeSync(r)); }
    catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  }
  async function disconnect() {
    if (!confirm('Stop receiving Cal.com bookings in the CRM?')) return;
    setBusy(true); setErr(null);
    try { await calcom({ action: 'disconnect' }); toast('Cal.com disconnected'); await reloadRef(); }
    catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  }

  return (
    <div className="panel">
      <div className="panel-head"><h2>Cal.com</h2>{connected ? <span className="tstatus ts-done">Connected</span> : <span className="tstatus ts-open">Not connected</span>}</div>
      <div className="pad">
        {manual && (
          <div className="banner warn" style={{ display: 'block' }}>
            <b>One more step:</b> Cal.com didn't let the CRM add the booking webhook itself ({manual.webhook_error}). Add it by hand:
            <ol className="steps-list" style={{ marginTop: 8 }}>
              <li>Cal.com → <b>Settings → Developer → Webhooks → New</b>.</li>
              <li>Subscriber URL: <code className="sel">{manual.webhook_url}</code></li>
              <li>Secret: <code className="sel">{manual.webhook_secret}</code></li>
              <li>Events: <b>Booking created</b>, <b>Booking rescheduled</b>, <b>Booking cancelled</b>. Save.</li>
            </ol>
          </div>
        )}
        {connected ? (
          <>
            <p style={{ marginBottom: 10 }}>Bookings on your Cal.com come into the CRM by themselves: an existing lead moves to <b>Awaiting meeting</b> with the time and meeting link, and someone new becomes your lead. Reschedules and cancellations update the lead too.</p>
            <div className="kv">
              <div><span>Your booking page</span>{me!.cal_url ? <a href={me!.cal_url} target="_blank" rel="noreferrer">{me!.cal_url}</a> : '—'}</div>
              <div><span>Connected</span>{fmtDateTime(me!.cal_connected_at)}</div>
            </div>
            <p className="hint" style={{ marginBottom: 14 }}>On a lead's page: <b>Schedule meeting</b> books them straight into your calendar, and <b>Send booking link</b> gives them your link with their details filled in.</p>
            <div className="row-gap">
              <button className="btn ghost" disabled={busy} onClick={syncTypes}>Add Flameback meeting types</button>
              <button className="btn ghost" disabled={busy} onClick={() => { const k = prompt('Paste a new Cal.com API key'); if (k) connect(k); }}>Reconnect</button>
              <button className="btn ghost danger-text" disabled={busy} onClick={disconnect}>Disconnect</button>
            </div>
          </>
        ) : (
          <>
            <p style={{ marginBottom: 12 }}>Connect your own Cal.com (signed up with your @flamebackcapital.com Google account, with Google Calendar connected) so meetings book and update by themselves.</p>
            <ol className="steps-list">
              <li>In Cal.com, connect <b>Google Calendar</b> and <b>Google Meet</b> (Apps). The CRM adds the standard Flameback meeting types for you when you connect.</li>
              <li>Go to <b>Settings → Developer → API keys</b>, click <b>Add</b>, name it "Flameback CRM", choose <b>Never expires</b>, and copy the key.</li>
              <li>Paste it below and click <b>Connect</b>. It's stored securely and only used to talk to Cal.com.</li>
            </ol>
            <Field label="Cal.com API key">
              <input type="password" autoComplete="off" value={key} onChange={(e) => setKey(e.target.value)} placeholder="cal_live_…" />
            </Field>
            <button className="btn" disabled={busy || key.trim().length < 10} onClick={() => connect(key.trim())}>{busy ? 'Connecting…' : 'Connect'}</button>
          </>
        )}
        {sync && (
          <div className="sync-box">
            <b>{describeSync(sync)}</b>
            {sync.created.length > 0 && <div className="small">Added: {sync.created.join(', ')}</div>}
            {sync.existing.length > 0 && <div className="small muted">Already there: {sync.existing.join(', ')}</div>}
            {sync.failed.map((f) => <div key={f.title} className="small red">{f.title}: {f.error}</div>)}
            {sync.meet_fallback && <div className="small amber">Some were created with Cal.com's own video link because Google Meet isn't available yet. Connect Google Calendar / Meet in Cal.com and switch their location to Google Meet.</div>}
          </div>
        )}
        {err && <div className="form-err">{err}</div>}
      </div>
    </div>
  );
}

function GmailPanel() {
  const { me, reloadRef } = useApp();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; msg?: string } | null>(() => {
    try {
      const v = sessionStorage.getItem(GMAIL_RESULT);
      if (v) { sessionStorage.removeItem(GMAIL_RESULT); return JSON.parse(v); }
    } catch { /* ignore */ }
    return null;
  });
  const connected = !!me?.gmail_connected_at;

  async function connect() {
    try { localStorage.setItem(GMAIL_FLAG, '1'); } catch { /* ignore */ }
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: window.location.origin + window.location.pathname,
        scopes: 'https://www.googleapis.com/auth/gmail.send https://www.googleapis.com/auth/gmail.readonly',
        queryParams: { access_type: 'offline', prompt: 'consent', login_hint: me!.email, hd: 'flamebackcapital.com' },
      },
    });
    if (error) toast(error.message, 'err');
  }
  async function act(action: string, done: string) {
    setBusy(true);
    try {
      const { data, error } = await supabase.functions.invoke('gmail', { body: { action } });
      let msg = (data as { error?: string } | null)?.error;
      if (!msg && error) { try { msg = (await (error as { context?: Response }).context?.clone().json())?.error; } catch { /* ignore */ } msg = msg || error.message; }
      if (msg) { setResult({ ok: false, msg }); return; }
      const added = (data as { added?: number } | null)?.added;
      toast(action === 'sync' ? `${added ?? 0} new email${added === 1 ? '' : 's'} added to leads` : done);
      await reloadRef();
    } finally { setBusy(false); }
  }

  return (
    <div className="panel" style={{ marginTop: 22 }}>
      <div className="panel-head"><h2>Gmail</h2>{connected ? <span className="tstatus ts-done">Connected</span> : <span className="tstatus ts-open">Not connected</span>}</div>
      <div className="pad">
        {result && (result.ok
          ? <div className="banner ok" style={{ margin: '0 0 14px' }}>Gmail connected.</div>
          : <div className="form-err" style={{ margin: '0 0 14px' }}>{result.msg}</div>)}
        {connected ? (
          <>
            <p style={{ marginBottom: 10 }}>Emails you send from a lead's page go from <b>{me!.gmail_address}</b>. Emails between you and your leads, sent from the CRM or from Gmail itself, appear on the lead's timeline, and a lead's reply counts as a response (it clears strikes).</p>
            <p className="hint" style={{ marginBottom: 14 }}>New emails are picked up every 5 minutes while the CRM is open, and whenever you open a lead.</p>
            <div className="row-gap">
              <button className="btn ghost" disabled={busy} onClick={() => act('sync', '')}>Sync now</button>
              <button className="btn ghost danger-text" disabled={busy} onClick={() => { if (confirm('Disconnect Gmail? Emails already on timelines stay.')) act('disconnect', 'Gmail disconnected'); }}>Disconnect</button>
            </div>
          </>
        ) : (
          <>
            <p style={{ marginBottom: 12 }}>Send emails to leads from your own Gmail, and see their replies on the lead's timeline.</p>
            <p className="hint" style={{ marginBottom: 14 }}>Google will ask you to allow the CRM to send email and read messages. It only looks at emails with your own leads' addresses.</p>
            <button className="btn" onClick={connect}>Connect Gmail</button>
          </>
        )}
      </div>
    </div>
  );
}
