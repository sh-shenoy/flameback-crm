import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import type { Bucket, Lead } from '../lib/types';
import { bucketLabel, isNewLead } from '../lib/types';
import { relativeDay, fmtDate } from '../lib/format';

/* ── toasts ── */
type Toast = { id: number; text: string; tone: 'ok' | 'err' | 'note'; sub?: string; onClick?: () => void };
type Push = (text: string, tone?: 'ok' | 'err' | 'note', extra?: { sub?: string; onClick?: () => void }) => void;
const ToastCtx = createContext<Push>(() => undefined);
export const useToast = () => useContext(ToastCtx);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<Toast[]>([]);
  const push = useCallback<Push>((text, tone = 'ok', extra) => {
    const id = Date.now() + Math.random();
    setItems((x) => [...x, { id, text, tone, ...extra }]);
    // notifications stay until dismissed; confirmations and errors fade by themselves
    if (tone !== 'note') setTimeout(() => setItems((x) => x.filter((t) => t.id !== id)), tone === 'err' ? 6000 : 3500);
  }, []);
  const dismiss = (id: number) => setItems((x) => x.filter((t) => t.id !== id));
  const notes = items.filter((t) => t.tone === 'note');
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="toasts" role="region" aria-label="Notifications" aria-live="polite">
        {notes.length > 1 && (
          <button className="toast-clear" onClick={() => setItems((x) => x.filter((t) => t.tone !== 'note'))}>Dismiss all ({notes.length})</button>
        )}
        {items.filter((t) => t.tone !== 'note' || notes.indexOf(t) >= notes.length - 5).map((t) => (
          <div key={t.id} className={`toast ${t.tone} ${t.onClick ? 'clickable' : ''}`}
            onClick={() => { if (t.onClick) { t.onClick(); dismiss(t.id); } }}>
            <div className="toast-text"><div>{t.text}</div>{t.sub && <div className="toast-sub">{t.sub}</div>}</div>
            {t.tone === 'note' && (
              <button className="toast-x" aria-label="Dismiss" onClick={(e) => { e.stopPropagation(); dismiss(t.id); }}>×</button>
            )}
          </div>
        ))}
        {notes.length > 5 && <div className="toast-more">+{notes.length - 5} more · see the bell</div>}
      </div>
    </ToastCtx.Provider>
  );
}

/* ── bits ── */
export function BucketPill({ bucket }: { bucket: Bucket }) {
  return <span className={`bucket b-${bucket}`}>{bucketLabel(bucket)}</span>;
}

/** Stage of a lead, with "New" for leads nobody has contacted yet. */
export function StagePill({ lead }: { lead: Pick<Lead, 'bucket' | 'next_follow_up'> }) {
  return isNewLead(lead) ? <span className="bucket b-new">New</span> : <BucketPill bucket={lead.bucket} />;
}

export function ProductTag({ product }: { product: string }) {
  return <span className={`prod p-${product.replace(/\s/g, '')}`}>{product}</span>;
}

export function Strikes({ n, show = true }: { n: number; show?: boolean }) {
  if (!show) return <span className="muted small">—</span>;
  return (
    <span className="strikes" title={`${n} of 5 strikes`}>
      {[0, 1, 2, 3, 4].map((i) => (
        <i key={i} className={`strike ${i < n ? (n >= 4 ? 'max' : 'on') : ''}`} />
      ))}
    </span>
  );
}

export function FollowUp({ date }: { date: string | null }) {
  const r = relativeDay(date);
  if (r.tone === 'none') return <span className="muted">—</span>;
  return (
    <span className={r.tone === 'overdue' ? 'red' : r.tone === 'today' ? 'amber' : ''} title={r.text}>
      {fmtDate(date)}
    </span>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="empty">{children}</div>;
}

export function Skeleton({ h = 18, w = '100%' }: { h?: number; w?: number | string }) {
  return <div className="skel" style={{ height: h, width: w }} />;
}

/* ── modal & drawer ── */
export function Modal({ title, onClose, children, footer, wide }: {
  title: ReactNode; onClose: () => void; children: ReactNode; footer?: ReactNode; wide?: boolean;
}) {
  useEsc(onClose);
  return (
    <div className="scrim open" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal ${wide ? 'wide' : ''}`} role="dialog" aria-modal="true">
        <div className="modal-head">
          <h2>{title}</h2>
          <button className="x" onClick={onClose} aria-label="Close">×</button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  );
}

export function Drawer({ title, sub, onClose, children, footer }: {
  title: ReactNode; sub?: ReactNode; onClose: () => void; children: ReactNode; footer?: ReactNode;
}) {
  useEsc(onClose);
  return (
    <>
      <div className="scrim open" onMouseDown={onClose} />
      <aside className="drawer open" role="dialog" aria-modal="true">
        <div className="drawer-head">
          <div>
            <h2>{title}</h2>
            {sub && <div className="muted small">{sub}</div>}
          </div>
          <button className="x" onClick={onClose} aria-label="Close">×</button>
        </div>
        <div className="drawer-body">{children}</div>
        {footer && <div className="drawer-foot">{footer}</div>}
      </aside>
    </>
  );
}

function useEsc(fn: () => void) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => e.key === 'Escape' && fn();
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [fn]);
}

export function Field({ label, children, hint, required }: { label: string; children: ReactNode; hint?: ReactNode; required?: boolean }) {
  return (
    <div className="field">
      <label>{label}{required && <span className="req"> *</span>}</label>
      {children}
      {hint && <div className="hint">{hint}</div>}
    </div>
  );
}

export function ComingSoon({ title, what }: { title: string; what: string }) {
  return (
    <div className="main-inner">
      <div className="page-head"><div><h1>{title}</h1></div></div>
      <div className="panel soon-panel">
        <div className="soon-badge">Coming soon</div>
        <p>{what}</p>
        <p className="muted small">This version covers the RM pre-sales flow: leads, uploads, follow-ups, meetings and the hand-off to onboarding.</p>
      </div>
    </div>
  );
}
