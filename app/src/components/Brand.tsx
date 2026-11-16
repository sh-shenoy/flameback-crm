import type { ReactNode } from 'react';
import { APP_NAME, MAKER, TAGLINE } from '../lib/brand';

const base = import.meta.env.BASE_URL;

const FEATURES: { title: string; text: string }[] = [
  { title: 'One pipeline for every lead', text: 'From first contact to commitment, with follow-ups that never slip and a five-strike rule that keeps the book clean.' },
  { title: 'Meetings that book themselves', text: 'Cal.com scheduling, reminders and a shared calendar. Bookings and cancellations update the lead on their own.' },
  { title: 'Every conversation in one place', text: 'Calls, notes, meetings and Gmail threads on one timeline, so anyone can pick up where the last conversation left off.' },
  { title: 'Teams working as one', text: 'Requests between Sales, Operations, Compliance and Investment, with owners, due dates and files.' },
  { title: 'Clear sight of what works', text: 'Conversion by source and campaign, a live team overview and timely nudges for the RMs.' },
];

/** Full-screen split layout for sign-in and access pages: story on the left, `children` on the right. */
export function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="auth">
      <section className="auth-story">
        <div className="auth-story-inner">
          <img className="auth-logo" src={`${base}argus-logo.png`} alt={`${APP_NAME} by ${MAKER}`} />
          <h1 className="auth-tagline">{TAGLINE}</h1>
          <p className="auth-lede">
            {APP_NAME} is Flameback's client relationship platform: one place to win, onboard and look after every client relationship.
          </p>
          <ul className="auth-features">
            {FEATURES.map((f) => (
              <li key={f.title}><b>{f.title}</b><span>{f.text}</span></li>
            ))}
          </ul>
        </div>
        <footer className="auth-foot">© {new Date().getFullYear()} {MAKER}. For authorised Flameback team members only.</footer>
      </section>
      <section className="auth-panel">
        <img className="auth-logo-mobile" src={`${base}argus-logo.png`} alt="" aria-hidden="true" />
        <div className="auth-card">{children}</div>
      </section>
    </div>
  );
}

/** Sidebar brand (on navy). */
export function ArgusSidebar() {
  return <img className="argus-side" src={`${base}argus-logo.png`} alt={`${APP_NAME} by ${MAKER}`} />;
}
