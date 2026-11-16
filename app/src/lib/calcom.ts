import { supabase } from './supabase';

/** Call the calcom edge function; throws an Error with a readable message on failure. */
export async function calcom<T = Record<string, unknown>>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke('calcom', { body });
  const fnError = (data as { error?: string } | null)?.error;
  if (fnError) throw new Error(fnError);
  if (error) {
    // our function returns { error }, Supabase's gateway returns { code, message } or { msg }
    const ctx = (error as { context?: Response }).context;
    let b: { error?: string; message?: string; msg?: string; code?: string } | null = null;
    try { b = ctx ? await ctx.clone().json() : null; } catch { /* not JSON */ }
    if (b?.error) throw new Error(b.error);
    if (ctx?.status === 404 || b?.code === 'NOT_FOUND') throw new Error('The calcom function was not found in Supabase. Check it is deployed with exactly that name.');
    if (b?.message || b?.msg) throw new Error(`Supabase: ${b.message ?? b.msg}${ctx ? ` (${ctx.status})` : ''}`);
    if (error.name === 'FunctionsFetchError') throw new Error('Couldn’t reach the calcom function. Check it is deployed in Supabase (Edge Functions) and try again.');
    throw new Error(`${error.name}: ${error.message}${ctx ? ` (${ctx.status})` : ''}`);
  }
  return data as T;
}

export interface CalEventType { id: number; title: string; slug: string; length: number | null }

export interface MeetingRow {
  booking_uid: string; provider: 'calendly' | 'calcom'; rm_id: string; lead_id: string | null;
  name: string | null; email: string | null; event_name: string | null;
  start_time: string; end_time: string | null; join_url: string | null; status: 'active' | 'canceled';
}

export interface SyncResult { created: string[]; existing: string[]; failed: { title: string; error: string }[]; meet_fallback?: boolean }

export function describeSync(r: SyncResult | undefined): string {
  if (!r) return '';
  const parts: string[] = [];
  if (r.created.length) parts.push(`${r.created.length} meeting type${r.created.length === 1 ? '' : 's'} added`);
  if (!r.created.length && !r.failed.length) parts.push('All Flameback meeting types are already in your Cal.com');
  if (r.failed.length) parts.push(`${r.failed.length} couldn't be added`);
  return parts.join(' · ');
}

export interface ConnectResult {
  ok: boolean; booking_url: string | null; webhook_ok: boolean; event_types?: SyncResult;
  webhook_error?: string; webhook_url?: string; webhook_secret?: string;
}
