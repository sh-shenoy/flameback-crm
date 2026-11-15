import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import type { Bucket } from '../lib/types';
import { bucketLabel } from '../lib/types';
import { relativeDay, fmtDate } from '../lib/format';

/* ── toasts ── */
type Toast = { id: number; text: string; tone: 'ok' | 'err' };
const ToastCtx = createContext<(text: string, tone?: 'ok' | 'err') => void>(() => undefined);
export const useToast = () => useContext(ToastCtx);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<Toast[]>([]);
  const push = useCallback((text: string, tone: 'ok' | 'err' = 'ok') => {
    const id = Date.now() + Math.random();
    setItems((x) => [...x, { id, text, tone }]);
    setTimeout(() => setItems((x) => x.filter((t) => t.id !== id)), tone === 'err' ? 6000 : 3500);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="toasts">
        {items.map((t) => (
          <div key={t.id} className={`toast ${t.tone}`}>{t.text}</div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

/* ── bits ── */
export function BucketPill({ bucket }: { bucket: Bucket }) {
  return <span className={`bucket b-${bucket}`}>{bucketLabel(bucket)}</span>;
}

export function ProductTag({ product }: { product: string }) {
  return <span className={`prod p-${product}`}>{product}</span>;
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
