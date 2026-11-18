import { useState } from 'react';
import { useApp } from '../auth';
import { initials } from '../lib/format';

/**
 * Admin pages: whose leads to show. "team" = RMs I manage, "all" = every RM, or one RM's id.
 * ids === null means no filter (everyone).
 */
export function useRmScope() {
  const { me, team, isAdmin } = useApp();
  const rms = team.filter((t) => t.role !== 'admin' && (t.is_active || t.manager_id === me?.id));
  const mine = rms.filter((t) => t.manager_id === me?.id);
  const [scope, setScope] = useState<string>(isAdmin && mine.length ? 'team' : 'all');
  const ids: string[] | null = !isAdmin ? [me!.id] : scope === 'all' ? null : scope === 'team' ? mine.map((t) => t.id) : [scope];
  return { scope, setScope, ids, rms, mine, isAdmin };
}

export function RmScopeSelect({ s }: { s: ReturnType<typeof useRmScope> }) {
  if (!s.isAdmin) return null;
  return (
    <select className="filter" value={s.scope} onChange={(e) => s.setScope(e.target.value)} aria-label="Whose leads">
      {s.mine.length > 0 && <option value="team">My team ({s.mine.length})</option>}
      <option value="all">All RMs</option>
      <optgroup label="One RM">{s.rms.map((t) => <option key={t.id} value={t.id}>{t.full_name}</option>)}</optgroup>
    </select>
  );
}

/** Supabase query helper: limit to the scope's RMs. */
export function scoped<Q extends { in: (c: string, v: string[]) => Q }>(q: Q, ids: string[] | null, column = 'rm_id'): Q {
  return ids === null ? q : q.in(column, ids.length ? ids : ['00000000-0000-0000-0000-000000000000']);
}

export const RmChip = ({ name }: { name: string | null | undefined }) => <span className="rm-chip" title={name ?? ''}>{initials(name)}</span>;
