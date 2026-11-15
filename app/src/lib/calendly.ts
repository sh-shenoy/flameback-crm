import { supabase } from './supabase';

/** Call the calendly-connect edge function; throws an Error with a readable message on failure. */
export async function calendly<T = Record<string, unknown>>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke('calendly-connect', { body });
  const fnError = (data as { error?: string } | null)?.error;
  if (fnError) throw new Error(fnError);
  if (error) {
    // our function returns { error }, Supabase's gateway returns { code, message } or { msg }
    const ctx = (error as { context?: Response }).context;
    let b: { error?: string; message?: string; msg?: string; code?: string } | null = null;
    try { b = ctx ? await ctx.clone().json() : null; } catch { /* not JSON */ }
    if (b?.error) throw new Error(b.error);
    if (ctx?.status === 404 || b?.code === 'NOT_FOUND') throw new Error('The calendly-connect function was not found in Supabase. Check it is deployed with exactly that name.');
    if (b?.message || b?.msg) throw new Error(`Supabase: ${b.message ?? b.msg}${ctx ? ` (${ctx.status})` : ''}`);
    if (error.name === 'FunctionsFetchError') throw new Error('Couldn’t reach the calendly-connect function (network or CORS). Check it is deployed and try again.');
    throw new Error(`${error.name}: ${error.message}${ctx ? ` (${ctx.status})` : ''}`);
  }
  return data as T;
}

export interface CalendlyEventType { uri: string; name: string; duration: number; kind: string; locations: { kind: string; location: string | null }[] }

export interface CalendlyEventRow {
  invitee_uri: string; event_uri: string; rm_id: string; lead_id: string | null;
  event_name: string | null; start_time: string; end_time: string | null; join_url: string | null; status: 'active' | 'canceled';
}
