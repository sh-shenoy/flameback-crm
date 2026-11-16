import { APP_NAME, MAKER, TAGLINE } from '../lib/brand';

const base = import.meta.env.BASE_URL;

/** Logo + tagline band at the top of the sign-in and waiting cards. */
export function ArgusLockup() {
  return (
    <div className="argus-hero">
      <img src={`${base}argus-logo.png`} alt={`${APP_NAME} by ${MAKER}`} />
      <div className="argus-tagline">{TAGLINE}</div>
    </div>
  );
}

/** Sidebar brand (on navy). */
export function ArgusSidebar() {
  return <img className="argus-side" src={`${base}argus-logo.png`} alt={`${APP_NAME} by ${MAKER}`} />;
}
