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

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setReady(true);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  async function reloadRef() {
    const [p, s] = await Promise.all([
      supabase.from('profiles').select('*').order('full_name'),
      supabase.from('lead_sources').select('*').order('sort_order'),
    ]);
    if (p.error) setLoadErr(p.error.message);
    else setLoadErr(null);
    setTeam((p.data as Profile[]) ?? []);
    setSources((s.data as LeadSource[]) ?? []);
  }

  useEffect(() => {
    if (session) reloadRef();
    else {
      setTeam([]);
      setSources([]);
    }
  }, [session?.user.id]);

  // Opportunistic run of the timed rules (pg_cron also runs them every 15 min).
  useEffect(() => {
    if (session) supabase.rpc('run_sweeps').then(() => undefined);
  }, [session?.user.id]);

  if (!ready) return <div className="boot">Loading…</div>;

  const me = session ? team.find((t) => t.id === session.user.id) ?? null : null;

  if (session && team.length && !me) {
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
