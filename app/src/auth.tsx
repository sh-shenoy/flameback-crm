import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from './lib/supabase';
import type { LeadSource, Profile } from './lib/types';

interface AppCtx {
  session: Session | null;
  me: Profile | null;
  isAdmin: boolean;
  team: Profile[];
  sources: LeadSource[];
  teamName: (id: string | null | undefined) => string;
  reloadRef: () => Promise<void>;
  signOut: () => Promise<void>;
}

const Ctx = createContext<AppCtx | null>(null);
export const GMAIL_FLAG = 'crm.gmail.connecting';
export const GMAIL_RESULT = 'crm.gmail.result';

export function useApp(): AppCtx {
  const v = useContext(Ctx);
  if (!v) throw new Error('useApp outside provider');
  return v;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [ready, setReady] = useState(false);
  const [team, setTeam] = useState<Profile[]>([]);
  const [sources, setSources] = useState<LeadSource[]>([]);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setReady(true);
      captureGmail(data.session);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => { setSession(s); captureGmail(s); });
    return () => sub.subscription.unsubscribe();
  }, []);

  // After "Connect Gmail", Google returns a long-lived token once, on this sign-in only: hand it to the server.
  function captureGmail(s: Session | null) {
    let pending = false;
    try { pending = localStorage.getItem(GMAIL_FLAG) === '1'; } catch { /* ignore */ }
    if (!pending || !s) return;
    try { localStorage.removeItem(GMAIL_FLAG); } catch { /* ignore */ }
    const token = s.provider_refresh_token;
    supabase.functions.invoke('gmail', { body: { action: 'save', refresh_token: token ?? '' } }).then(async ({ data, error }) => {
      let msg = (data as { error?: string } | null)?.error ?? null;
      if (!msg && error) {
        try { msg = (await (error as { context?: Response }).context?.clone().json())?.error ?? error.message; } catch { msg = error.message; }
      }
      try { sessionStorage.setItem(GMAIL_RESULT, JSON.stringify(msg ? { ok: false, msg } : { ok: true })); } catch { /* ignore */ }
      await reloadRef();
      window.location.hash = '#/connections';
    });
  }

  async function reloadRef() {
    const [p, s] = await Promise.all([
      supabase.from('profiles').select('*').order('full_name'),
      supabase.from('lead_sources').select('*').order('sort_order'),
    ]);
    if (p.error) setLoadErr(p.error.message);
    else setLoadErr(null);
    setTeam((p.data as Profile[]) ?? []);
    setSources((s.data as LeadSource[]) ?? []);
    setLoaded(true);
  }

  useEffect(() => {
    if (session) reloadRef();
    else {
      setTeam([]);
      setSources([]);
      setLoaded(false);
    }
  }, [session?.user.id]);

  // Opportunistic run of the timed rules (pg_cron also runs them every 15 min).
  useEffect(() => {
    if (session) supabase.rpc('run_sweeps').then(() => undefined);
  }, [session?.user.id]);

  if (!ready) return <div className="boot">Loading…</div>;

  const me = session ? team.find((t) => t.id === session.user.id) ?? null : null;

  if (session && me && !me.is_active) {
    const title = me.rejected_at ? 'Access not approved' : me.approved_at ? 'Access removed' : 'Waiting for approval';
    const text = me.rejected_at || me.approved_at
      ? 'An admin has turned off your access to Flameback CRM. Speak to them if you think this is a mistake.'
      : 'Thanks for signing in. An admin has been asked to approve your access; this page will open the CRM once they do.';
    return (
      <div className="login">
        <div className="login-card">
          <img className="login-logo" src={`${import.meta.env.BASE_URL}logo-full.png`} alt="Flameback Capital" />
          <h2 style={{ fontSize: 18 }}>{title}</h2>
          <p className="muted">{text}</p>
          <p className="muted small">Signed in as {session.user.email}</p>
          <div className="row-gap">
            {!me.rejected_at && !me.approved_at && <button className="btn" onClick={() => reloadRef()}>Check again</button>}
            <button className="btn ghost" onClick={() => supabase.auth.signOut()}>Sign out</button>
          </div>
        </div>
      </div>
    );
  }

  if (session && loaded && !me) {
    return (
      <div className="boot">
        <div className="panel pad" style={{ maxWidth: 420 }}>
          <h2>Account not set up</h2>
          <p className="muted">Signed in as {session.user.email}, but no CRM profile exists for it. Ask an admin to check your access.</p>
          <button className="btn ghost" onClick={() => supabase.auth.signOut()}>Sign out</button>
        </div>
      </div>
    );
  }
  if (session && !me && loadErr) {
    return <div className="boot">Couldn't load your profile: {loadErr}</div>;
  }
  if (session && !me) return <div className="boot">Loading…</div>;

  const value: AppCtx = {
    session,
    me,
    isAdmin: me?.role === 'admin',
    team,
    sources,
    teamName: (id) => team.find((t) => t.id === id)?.full_name ?? '—',
    reloadRef,
    signOut: async () => {
      await supabase.auth.signOut();
    },
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
