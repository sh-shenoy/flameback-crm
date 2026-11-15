// Mirrors public.normalize_phone / normalize_email in the database so the
// upload preview shows exactly what will be stored.

export function normalizePhone(p: unknown): string | null | 'invalid' {
  if (p === null || p === undefined) return null;
  const raw = String(p).trim();
  if (!raw) return null;
  const plus = raw.startsWith('+');
  const d = raw.replace(/\D/g, '');
  if (!d) return null;
  if (d.length === 12 && d.startsWith('91')) return d.slice(2);
  if (d.length === 11 && d.startsWith('0')) return d.slice(1);
  if (d.length === 10 && !plus) return d;
  if (d.length >= 8 && d.length <= 15) return '+' + d;
  return 'invalid';
}

export function normalizeEmail(e: unknown): string | null | 'invalid' {
  if (e === null || e === undefined) return null;
  const v = String(e).trim().toLowerCase();
  if (!v) return null;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) ? v : 'invalid';
}
