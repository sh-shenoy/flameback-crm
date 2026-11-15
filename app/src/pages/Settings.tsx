import { useState } from 'react';
import { useApp } from '../auth';
import { supabase } from '../lib/supabase';
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
      const { data, error } = await supabase.functions.invoke('calendly-connect', { body });
      // the function returns { error } with a helpful message on failure
      let message = (data as { error?: string } | null)?.error;
      if (!message && error) {
        // Read the real reason: our function returns { error }, Supabase's gateway returns { code, message } or { msg }.
        const ctx = (error as { context?: Response }).context;
        let body: { error?: string; message?: string; msg?: string; code?: string } | null = null;
        try { body = ctx ? await ctx.clone().json() : null; } catch { /* not JSON */ }
        if (body?.error) message = body.error;
        else if (ctx?.status === 404 || body?.code === 'NOT_FOUND') message = 'The calendly-connect function was not found in Supabase. Check it is deployed with exactly that name.';
        else if (body?.message || body?.msg) message = `Supabase: ${body.message ?? body.msg}${ctx ? ` (${ctx.status})` : ''}`;
        else if (error.name === 'FunctionsFetchError') message = 'Couldn’t reach the calendly-connect function (network or CORS). Check it is deployed and try again.';
        else message = `${error.name}: ${error.message}${ctx ? ` (${ctx.status})` : ''}`;
      }
      if (message) { setErr(message); return false; }
      await reloadRef();
      return true;
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
    </div>
  );
}
