import { useState } from 'react';
import { GMAIL_FLAG, GMAIL_RESULT, useApp } from '../auth';
import { supabase } from '../lib/supabase';
import { calendly } from '../lib/calendly';
import { fmtDateTime } from '../lib/format';
import { Field, useToast } from '../components/ui';

export default function Settings() {
  const { me, reloadRef } = useApp();
  const toast = useToast();
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const connected = !!me?.calendly_url;

  async function call(body: Record<string, unknown>) {
    setBusy(true); setErr(null);
    try {
      await calendly(body);
      await reloadRef();
      return true;
    } catch (e) {
      setErr((e as Error).message);
      return false;
    } finally { setBusy(false); }
  }

  return (
    <div className="main-inner">
      <div className="page-head"><div><h1>Settings</h1><p>{me?.full_name} · {me?.email}</p></div></div>

      <div className="panel">
        <div className="panel-head"><h2>Calendly</h2>{connected ? <span className="tstatus ts-done">Connected</span> : <span className="tstatus ts-open">Not connected</span>}</div>
        <div className="pad">
          {connected ? (
            <>
              <p style={{ marginBottom: 10 }}>Bookings on your Calendly come into the CRM automatically: an existing lead moves to <b>Awaiting meeting</b> with the time, and someone new becomes your lead. Cancellations update the lead too.</p>
              <div className="kv">
                <div><span>Your booking link</span><a href={me!.calendly_url!} target="_blank" rel="noreferrer">{me!.calendly_url}</a></div>
                <div><span>Connected</span>{fmtDateTime(me!.calendly_connected_at)}</div>
              </div>
              <p className="hint" style={{ marginBottom: 14 }}>To send a lead your link with their details filled in, use <b>Send booking link</b> on the lead's page.</p>
              <div className="row-gap">
                <button className="btn ghost" disabled={busy} onClick={async () => { if (await call({ action: 'connect', token: prompt('Paste a new Calendly personal access token') ?? '' })) toast('Calendly reconnected'); }}>Reconnect</button>
                <button className="btn ghost danger-text" disabled={busy} onClick={async () => { if (confirm('Stop receiving Calendly bookings in the CRM?') && await call({ action: 'disconnect' })) toast('Calendly disconnected'); }}>Disconnect</button>
              </div>
            </>
          ) : (
            <>
              <p style={{ marginBottom: 12 }}>Connect your own Calendly (signed up with your @flamebackcapital.com email) so bookings land in the CRM by themselves.</p>
              <ol className="steps-list">
                <li>Open Calendly and go to <b>Integrations &amp; apps → API and webhooks</b>.</li>
                <li>Under <b>Personal access tokens</b>, click <b>Generate new token</b>, name it "Flameback CRM", and copy it.</li>
                <li>Paste it below and click <b>Connect</b>. The token is stored securely and only used to talk to Calendly.</li>
              </ol>
              <Field label="Calendly personal access token">
                <input type="password" autoComplete="off" value={token} onChange={(e) => setToken(e.target.value)} placeholder="eyJraWQiOi…" />
              </Field>
              <button className="btn" disabled={busy || token.trim().length < 20} onClick={async () => { if (await call({ action: 'connect', token })) { setToken(''); toast('Calendly connected'); } }}>
                {busy ? 'Connecting…' : 'Connect'}
              </button>
            </>
          )}
          {err && <div className="form-err">{err}</div>}
        </div>
      </div>

      <GmailPanel />
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
