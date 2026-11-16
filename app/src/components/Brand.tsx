import { APP_NAME, MAKER, TAGLINE } from '../lib/brand';

const base = import.meta.env.BASE_URL;

/** The Argus lock-up for the sign-in and waiting pages (on a light card). */
export function ArgusLockup() {
  return (
    <div className="argus-lockup">
      <div className="argus-word">{APP_NAME.toUpperCase()}<span className="argus-dot" /></div>
      <div className="argus-tagline">{TAGLINE}</div>
      <div className="argus-by">
        <span>by</span>
        <img src={`${base}logo-full.png`} alt={MAKER} />
      </div>
    </div>
  );
}

/** Sidebar brand (on navy). */
export function ArgusSidebar() {
  return (
    <>
      <img className="logo-mark" src={`${base}logo-mark.png`} alt="" />
      <span className="wordmark argus">
        <b>{APP_NAME.toUpperCase()}</b>
        <span>by Flameback</span>
      </span>
    </>
  );
}
