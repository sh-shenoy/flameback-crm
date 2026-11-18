// Mirrors public.normalize_phone / normalize_email in the database so the
// upload preview shows exactly what will be stored.
// Indian numbers become 10 digits (from +91, 91, 0091, 0, or +91 (0) …); others keep +country code.

export function normalizePhone(p: unknown): string | null | 'invalid' {
  if (p === null || p === undefined) return null;
  const raw = String(p).trim();
  if (!raw) return null;
  let plus = raw.startsWith('+');
  let d = raw.replace(/\D/g, '');
  if (!d) return null;
  if (d.startsWith('00')) { d = d.slice(2); plus = true; }               // 00 = international prefix
  if (d.length === 12 && d.startsWith('91')) return d.slice(2);           // 91 + number
  if (d.length === 13 && d.startsWith('910')) return d.slice(3);          // 91 (0) number
  if (!plus) {
    if (d.length === 11 && d.startsWith('0')) return d.slice(1);          // 0 + number
    if (d.length === 10) return d;
    if (d.length < 10) return 'invalid';                                  // too short
  }
  if (d.length >= 8 && d.length <= 15) return '+' + d;
  return 'invalid';
}

export function normalizeEmail(e: unknown): string | null | 'invalid' {
  if (e === null || e === undefined) return null;
  const v = String(e).trim().toLowerCase();
  if (!v) return null;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) ? v : 'invalid';
}
