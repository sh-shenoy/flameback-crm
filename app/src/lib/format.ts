// All dates show as DD MMM YYYY and all times in IST (per the RM spec).
const TZ = 'Asia/Kolkata';

const dateFmt = new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: TZ });
const timeFmt = new Intl.DateTimeFormat('en-IN', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: TZ });
const isoFmt = new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit', timeZone: TZ });

/** Today's date in IST as YYYY-MM-DD. */
export function todayIST(): string {
  return isoFmt.format(new Date());
}

export function addDays(iso: string, n: number): string {
  const d = new Date(iso + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** YYYY-MM-DD (a calendar date) → "13 Nov 2026". */
export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) return dateFmt.format(new Date(iso + 'T12:00:00+05:30'));
  return dateFmt.format(new Date(iso));
}

/** timestamp → "13 Nov 2026, 3:00 pm". */
export function fmtDateTime(ts: string | null | undefined): string {
  if (!ts) return '—';
  const d = new Date(ts);
  return `${dateFmt.format(d)}, ${timeFmt.format(d).toLowerCase()}`;
}

export function fmtTime(ts: string): string {
  return timeFmt.format(new Date(ts)).toLowerCase();
}

/** IST date (YYYY-MM-DD) of a timestamp. */
export function istDateOf(ts: string): string {
  return isoFmt.format(new Date(ts));
}

/** "Overdue by 2 days" / "Today" / "Tomorrow" / "In 5 days". */
export function relativeDay(iso: string | null): { text: string; tone: 'overdue' | 'today' | 'future' | 'none' } {
  if (!iso) return { text: '—', tone: 'none' };
  const today = todayIST();
  const diff = Math.round((Date.parse(iso) - Date.parse(today)) / 86400000);
  if (diff < 0) return { text: `Overdue by ${-diff} day${diff === -1 ? '' : 's'}`, tone: 'overdue' };
  if (diff === 0) return { text: 'Today', tone: 'today' };
  if (diff === 1) return { text: 'Tomorrow', tone: 'future' };
  return { text: `In ${diff} days`, tone: 'future' };
}

/** Local datetime-input value (IST) ↔ ISO timestamp. */
export function toISTInput(ts: string | null): string {
  if (!ts) return '';
  const d = new Date(new Date(ts).getTime() + 330 * 60000);
  return d.toISOString().slice(0, 16);
}
export function fromISTInput(v: string): string | null {
  if (!v) return null;
  return new Date(v + ':00+05:30').toISOString();
}

export function fmtPhone(p: string | null): string {
  if (!p) return '';
  if (/^\d{10}$/.test(p)) return `${p.slice(0, 5)} ${p.slice(5)}`;
  return p;
}

export function initials(name: string | null | undefined): string {
  return (name || '?')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join('');
}

/** "just now", "5 min ago", "3 h ago", "yesterday", else the date. */
export function timeAgo(ts: string): string {
  const s = Math.max(0, (Date.now() - new Date(ts).getTime()) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  if (s < 172800) return 'yesterday';
  return fmtDate(ts);
}

/** Bytes → "1.2 MB". */
export function fmtSize(n: number | null | undefined): string {
  if (!n && n !== 0) return '';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

/** "2026-11-19" + "15:30" (IST) → ISO timestamp. */
export const istAt = (date: string, time: string) => new Date(`${date}T${time}:00+05:30`).toISOString();

/** ISO timestamp → "15:30" in IST, for <input type="time">. */
export function istHHMM(ts: string): string {
  return new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Kolkata' }).format(new Date(ts));
}
