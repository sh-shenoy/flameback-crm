import { useMemo, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useApp } from '../auth';
import { APP_NAME } from '../lib/brand';

/* Knowledge hub: how Argus works, for someone using it for the first time. Static content. */

type QA = { q: string; a: ReactNode; text?: string };
type Section = { id: string; title: string; intro?: string; admin?: boolean; items: QA[] };

const STAGES: [string, string, string][] = [
  ['Active contact', 'New and being worked. You are trying to reach them.', 'Five unanswered attempts → Out List'],
  ['Awaiting meeting', 'They agreed to meet (time booked or not).', 'Five reminders with no meeting → Out List'],
  ['Holding period', 'You have met or properly discussed; they are still thinking.', 'No strikes. Follow-ups at 7, 14, 28, 56 days (max 90 apart)'],
  ['Deferred', 'They will decide later, on a date they gave.', 'Comes back to Holding on that date'],
  ['Prospect', 'Agreed to join. Onboarding in progress (documents, accounts).', 'Checklist on the lead; becomes a client when funded'],
  ['Client', 'Funded.', 'Shown under Clients'],
  ['Out List', 'Not interested, or five strikes.', 'Can be brought back any time'],
];

const SECTIONS: Section[] = [
  {
    id: 'start', title: 'Getting started',
    intro: `${APP_NAME} is where the RM team runs pre-sales: from the moment a lead comes in until they commit and move to onboarding.`,
    items: [
      { q: 'What do I do on my first day?', a: <ol>
        <li>Sign in with your <b>@flamebackcapital.com</b> Google account. If you see "waiting for approval", an admin has to approve you first.</li>
        <li>Go to <Link to="/connections">Connections</Link> and connect <b>Cal.com</b> (meetings) and <b>Gmail</b> (email from the CRM).</li>
        <li>Open the <Link to="/">Dashboard</Link>. <b>Today's actions</b> is your to-do list: follow-ups due, meetings, overdue tasks.</li>
        <li>Open a lead, read its <b>AI summary</b> and <b>Notes</b>, make the call, then press <b>Log activity</b>.</li>
      </ol> },
      { q: 'Which leads can I see?', a: <p>RMs see only their own leads. Admins see everyone's. If you can't find a lead, it probably belongs to someone else: ask an admin.</p> },
      { q: 'What is the one habit that matters most?', a: <p>Log every conversation with <b>Log activity</b>, straight after it happens. Stages, strikes, follow-up dates, reports and the AI summary all come from what you log.</p> },
      { q: 'Where do onboarding and clients happen?', a: <p>Here. When someone agrees to join they become a <b>prospect</b> with an onboarding checklist (see <Link to="/prospects">Prospects</Link>); when they fund they become a <b>client</b> (see <Link to="/clients">Clients</Link>). Accounts themselves are still opened in the Flameback app (RIA) and Silver Bullet (PMS). Reviews are coming later.</p> },
    ],
  },
  {
    id: 'leads-in', title: 'Adding leads',
    items: [
      { q: 'How do I add one lead?', a: <p>Press <b>Add lead</b> (top right). Name, phone or email, product and source are enough; profile details can wait. If the phone or email already exists you get a warning and can merge instead of creating a duplicate.</p> },
      { q: 'How do I upload a list?', a: <p><Link to="/upload">Upload leads</Link> → choose an Excel or CSV file → match the columns → check the preview → import. You can set one product and source for the whole file or per row. Duplicates are skipped or merged, and you can download the rows that weren't imported.</p> },
      { q: 'Who gets a new lead?', a: <p>Round-robin across Sales RMs who are "in rotation" (Admin → Team &amp; rotation). Admins can also assign a lead to anyone.</p> },
      { q: 'I uploaded the wrong file. Can I remove the leads?', a: <p>Only admins can delete leads: Upload history → <b>Remove leads</b>, or tick leads on the Leads list → Delete. Deleting is permanent and removes the lead from everything: reports, the funnel, the calendar, tasks and notifications. When all leads of an upload are removed, the upload leaves Upload history too. If a lead is real but not interested, use <b>Not interested</b> instead so the history stays.</p> },
      { q: 'Can a lead have more than one language?', a: <p>Yes. In the profile, click as many language chips as apply, or type another and press Enter.</p> },
    ],
  },
  {
    id: 'stages', title: 'Stages',
    intro: 'Every open lead sits in one stage. The stage decides what counts as a strike and when you follow up.',
    items: [
      { q: 'What are the stages?', text: STAGES.flat().join(' '), a: (
        <table className="help-table"><thead><tr><th>Stage</th><th>Means</th><th>Rule</th></tr></thead>
          <tbody>{STAGES.map(([s, m, r]) => <tr key={s}><td><b>{s}</b></td><td>{m}</td><td>{r}</td></tr>)}</tbody></table>
      ) },
      { q: 'How does a lead move between stages?', a: <p>Mostly through <b>Log activity</b>: when you spoke to them, answer "Where did this leave things?" and the lead moves. You can also use <b>Change stage</b> on the lead page to move it by hand (add a reason; it is saved as a note).</p> },
      { q: 'What is the difference between a lead, a prospect and a client?', a: <ul>
        <li><b>Lead</b>: someone we are trying to win (Active contact, Awaiting meeting, Holding, Deferred).</li>
        <li><b>Prospect</b>: agreed to join; now being onboarded (documents, bank and broker accounts).</li>
        <li><b>Client</b>: has funded their account.</li>
      </ul> },
      { q: 'What happens when someone agrees to join?', a: <p>Log activity → <b>Agreed to join</b> and confirm the product. They become a <b>prospect</b> and get an onboarding checklist for their product and Resident / NRI. Not joining after all? The link on the lead moves them back to Holding.</p> },
    ],
  },
  {
    id: 'onboarding', title: 'Prospects and onboarding',
    items: [
      { q: 'Where do I see everyone being onboarded?', a: <p><Link to="/prospects">Prospects</Link> lists them with progress, what each is waiting on (client, Ops), the next due item and how long onboarding has taken.</p> },
      { q: 'How does the onboarding checklist work?', a: <p>Each prospect gets the checklist for their product and Resident / NRI (set Residency in the lead header). Set each item's status: To do, Waiting on client, Submitted, Done or Blocked (with a reason). Add a due date or notes, add your own items, or delete ones that don't apply.</p> },
      { q: 'Their spouse is joining too.', a: <p>Use <b>+ Joint holder</b> on the checklist. Per-person items (KYC and similar) are added for them automatically.</p> },
      { q: 'Something needs Operations.', a: <p>Press <b>Ask Ops</b> on the item. Operations gets a task linked to the lead; when they mark it done, the item ticks itself. You decide what you do and what Ops does.</p> },
      { q: 'Can I meet a prospect or client?', a: <p>Yes. <b>Schedule meeting</b> and <b>Send booking link</b> work at every stage except the Out List. A booking for a prospect or client is saved on their timeline and calendar, and they stay where they are; it does not move them back to Awaiting meeting.</p> },
      { q: 'When do they become a client?', a: <p>When the money arrives: <b>Mark as funded</b> at the bottom of the checklist, with the date and amount. They move to <Link to="/clients">Clients</Link>. Entered by mistake? <b>Undo</b> on the lead.</p> },
      { q: 'The checklist is empty.', a: <p>Set Resident / NRI, then press <b>Load checklist</b>. If it is still empty, no checklist has been set up for that product yet: add items by hand, and ask an admin to set one up in Admin → Onboarding checklists.</p> },
    ],
  },
  {
    id: 'strikes', title: 'Strikes and follow-ups',
    items: [
      { q: 'What is a strike?', a: <ul>
        <li><b>Active contact:</b> a call with No answer, or a message marked Sent that gets no reply within 48 hours.</li>
        <li><b>Awaiting meeting:</b> every reminder you send (call, message or email) while no meeting has happened.</li>
        <li>Five strikes and the lead goes to the <b>Out List</b>. The count resets when the lead changes stage, and in Active contact whenever they pick up or reply.</li>
      </ul> },
      { q: 'Do follow-ups in Holding count as strikes?', a: <p>No. When someone is "still thinking", follow-ups are spaced out automatically: 7 days after the meeting, then 14, 28, 56… days after each follow-up (never more than 90 days apart). Pick a date yourself in Next follow-up if you want a different one.</p> },
      { q: 'I sent a WhatsApp and they replied. How do I stop the strike?', a: <p>On the lead's timeline, press <b>They replied</b> on that message within 48 hours, or log their reply as a new activity. Emails sent through Gmail are matched automatically.</p> },
      { q: 'How do I bring someone back from the Out List?', a: <p>Open the lead (or the <Link to="/out">Out List</Link>) → <b>Bring back</b> → pick a follow-up date. Strikes reset and the lead returns to the stage it left.</p> },
      { q: 'New, Not picked up and Follow-up: what\'s the difference?', a: <p>Open leads in the first stage are sorted by what has actually happened. <b>New</b>: nobody has called, messaged, emailed or met them yet. <b>Not picked up</b>: you tried (a call they didn't answer, a message or email with no reply yet), but you haven't spoken. <b>Follow-up</b>: you've spoken at least once (they picked up, asked you to call back, replied, or met you). Each has its own tab under Leads. When you log a conversation that leaves the lead in Follow-up, you pick the next follow-up <b>date</b> (and a time if you like: it then goes on your Calendar and pops up 5 minutes before). After no answer, a "try again" date is optional. Argus never sets a date by itself. Five unanswered attempts send a lead to the Out List.</p> },
      { q: 'How do I log a Zoom call or a WhatsApp message?', a: <p>In <b>Log activity</b>, pick <b>Video call</b> and then Google Meet or Zoom (it starts on the lead's preferred one), or <b>Message</b> and then WhatsApp, SMS, LinkedIn or Other. This feeds the Analytics page, so admins can see which channels reach clients.</p> },
      { q: 'What is on the Analytics page? (admins)', a: <p><Link to="/analytics">Analytics</Link> shows everything the team did with clients over a period: activities, clients reached, calls and connect rate, meetings held, compared with the period before. Below that: how clients were reached (phone, Google Meet, Zoom, in person, WhatsApp, SMS, LinkedIn, email, Gmail), call outcomes, meetings by platform, messages by app, email replies, stage moves, the busiest hours and days, each RM's numbers (click one for their funnel), and activity by lead source. Use the team picker for My team, All RMs or one RM.</p> },
      { q: "Where is each RM's funnel?", a: <p>Open the RM from <b>Admin</b> or the Analytics table. Their page shows the leads given to them and how far those got: Reached out → Spoke → Wants to meet → Met → Prospect → Client, with the whole team as a marker. Above it you can see where those leads are now: new (not contacted yet), in follow-up, meeting/holding/deferred, prospect, client and Out List. Pick a period to see only leads that came in then.</p> },
      { q: 'Where do I see what I did today?', a: <p><Link to="/log">Daily log</Link> lists every client you dealt with on a day, in time order: calls (and whether they picked up), messages, emails, meetings, your notes, stage moves and the next follow-up you set. The top shows clients reached, calls connected and not answered, meetings held and leads moved forward. Use ‹ › or the date to look at another day, and <b>Download CSV</b> to share it. Managers see the team's log.</p> },
      { q: 'Where do I see what is due?', a: <p>Dashboard → <b>Today's actions</b>, the red number next to Leads in the sidebar, the 9 am digest notification, and the Leads list filters <b>Due today</b> and <b>Overdue</b>.</p> },
    ],
  },
  {
    id: 'logging', title: 'Logging activity',
    items: [
      { q: 'How do I log a call, chat or meeting?', a: <p>Lead page → <b>Log activity</b> → what happened (phone, Google Meet, in-person, message, email or note) → the outcome → notes → next follow-up. Notes are required when you actually spoke.</p> },
      { q: 'Do I need to schedule a meeting before I can record a conversation?', a: <p>No. You can log any conversation: a call, a chance meeting, a WhatsApp chat. If they picked up or replied, Log activity asks where it left things, so the lead moves to the right stage.</p> },
      { q: 'What do the "Where did this leave things?" choices do?', text: 'Just a conversation Wants to meet Met still thinking Agreed to join Will commit later Spoke no meeting fixed', a: <ul>
        <li><b>Just a conversation</b>: stays where it is.</li>
        <li><b>Wants to meet</b>: Awaiting meeting (book the time later).</li>
        <li><b>Met / discussed, still thinking</b>: Holding period.</li>
        <li><b>Agreed to join</b>: becomes a prospect with an onboarding checklist.</li>
        <li><b>Will commit later</b>: Deferred until the date you pick.</li>
        <li><b>Spoke, no meeting fixed</b> (from Awaiting meeting): back to Active contact, no strike.</li>
      </ul> },
      { q: 'They said they are not interested.', a: <p>Pick the outcome <b>Not interested</b> in Log activity, or press <b>Not interested</b> on the lead. It moves to the Out List with your note.</p> },
    ],
  },
  {
    id: 'meetings', title: 'Meetings (Cal.com)',
    items: [
      { q: 'How do I connect Cal.com?', a: <p><Link to="/connections">Connections</Link> → Cal.com → paste your Cal.com API key (Cal.com → Settings → Developer → API keys). The team's standard meeting types (Intro call, Discovery, Follow-up, Onboarding kickoff, Catch-up) are added to your account automatically.</p> },
      { q: 'How do I book a meeting with a lead?', a: <p>Lead page → <b>Schedule meeting</b> → meeting type → pick a free slot → add other invitees if needed. They get a calendar invite with a Google Meet link, and the lead moves to Awaiting meeting.</p> },
      { q: 'Can I book on Zoom instead of Google Meet?', a: <p>Yes. When you schedule a meeting, pick <b>Google Meet</b> or <b>Zoom</b> under "Meet on". It starts on whatever you used last time for that lead. Clients booking through your link choose for themselves.</p> },
      { q: 'Can the client book a time themselves?', a: <p>Yes: <b>Send booking link</b> gives you a link with their details filled in. When they book, the meeting appears on the lead automatically. Someone new who books through your Cal.com page becomes your lead with source "Cal.com".</p> },
      { q: 'How do I reschedule or cancel?', a: <p>On the lead page use <b>Reschedule</b> or <b>Cancel meeting</b>. Changes made in Cal.com itself also flow back to the lead.</p> },
      { q: 'Where are all my meetings?', a: <p><Link to="/calendar">Calendar</Link> shows meetings and tasks due by day, week or month (in IST).</p> },
    ],
  },
  {
    id: 'email', title: 'Email (Gmail)',
    items: [
      { q: 'How do I email a lead from the CRM?', a: <p>Connect Gmail once under <Link to="/connections">Connections</Link>, then use <b>Email</b> on the lead page. It is sent from your own Gmail and can reply in the last thread.</p> },
      { q: 'Do emails I send from Gmail directly show up?', a: <p>Yes. Emails between you and a lead's address appear on the lead's timeline (checked every few minutes while Argus is open). Their reply counts as a response and clears strikes.</p> },
    ],
  },
  {
    id: 'notes-ai', title: 'Notes and AI summary',
    items: [
      { q: 'What is the Notes box for?', a: <p>Anything worth keeping that isn't a single conversation: family, existing investments, preferences, best time to call. Press <b>Save notes</b>.</p> },
      { q: 'What does Fix grammar do?', a: <p>Corrects spelling, grammar and punctuation in your notes without changing facts. Check the result, then Save (or Undo fix).</p> },
      { q: 'Where does the AI summary come from?', a: <p>From everything on the lead: activity notes, your Notes box, meetings, tasks and stage changes. It refreshes after new activity. Press <b>Refresh</b> to rebuild it or <b>Edit</b> to correct it; your edit is kept until someone refreshes.</p> },
      { q: 'Is client data sent to the AI?', a: <p>Phone numbers, emails, PAN and Aadhaar numbers are removed before anything is sent, and the AI runs on Flameback's own hosted models.</p> },
    ],
  },
  {
    id: 'tasks', title: 'Tasks',
    items: [
      { q: 'How do I ask another team for something?', a: <p><b>Raise task</b> on a lead (or <Link to="/tasks">Tasks</Link> → New task) → pick the team (Operations, Compliance, Investment, Sales) and optionally a person, priority and due date. Templates cover common requests such as account opening or address change.</p> },
      { q: 'How do tasks move?', a: <p>Open → In progress → Done. <b>Blocked</b> needs a reason. Everyone involved is notified of changes, comments and new files.</p> },
      { q: 'Can I attach files?', a: <p>Yes, up to 20 MB each. Only people who can see the task can open them.</p> },
    ],
  },
  {
    id: 'notifications', title: 'Notifications and reports',
    items: [
      { q: 'What will I be notified about?', a: <p>New leads, bookings and cancellations, a meeting in 30 minutes, the 9 am digest, email replies, task changes and nudges from your manager. Pop-ups stay until you dismiss them.</p> },
      { q: 'Will I be reminded before a meeting?', a: <p>Yes. 5 minutes before each meeting a pop-up appears (bottom right, with a sound) showing the time and who it is with: <b>Join</b> opens the Google Meet, <b>Snooze 5m</b> brings it back in 5 minutes, × closes it. It needs Argus open in a tab. You also get a notification about 30 minutes before.</p> },
      { q: 'How do I turn the sound off?', a: <p>Open the bell (top right) → <b>Sound on/off</b>.</p> },
      { q: 'Which sources and campaigns convert?', a: <p><Link to="/reports">Reports</Link> shows the funnel (leads, contacted, wants to meet, met, prospect, client) and Out List by source, campaign, referrer or product (admins also by RM), with CSV download.</p> },
    ],
  },
  {
    id: 'admin', title: 'For admins', admin: true,
    items: [
      { q: 'Approving new people', a: <p>Admin → <b>Access requests</b>: approve as RM or Admin, or reject. New people start out of the round-robin.</p> },
      { q: 'Round-robin, routing and teams', a: <p>Admin → <b>Team &amp; rotation</b>: set each person's team, manager and whether they receive new leads. Click an RM's <b>Routing</b> to set the products they handle, languages they speak, whether they take NRI leads and a maximum of open leads; switch on <b>On leave</b> to pause new leads. A new lead goes to the next RM in rotation who fits; if nobody fits a rule, it is relaxed.</p> },
      { q: 'Can an admin step down?', a: <p>Yes, but Argus always keeps at least one admin. If you are the only admin, make someone else an admin first (Team &amp; rotation → Role), then change yourself to RM or remove your access.</p> },
      { q: 'Can admins work leads?', a: <p>No. Admins manage: they can view every lead, reassign it and raise tasks, but calls, notes, meetings and stage changes are made by the lead's RM. Admins never get leads; if an admin still holds some, use <b>Hand over</b> on Team &amp; rotation.</p> },
      { q: 'Someone is leaving', a: <p>Team &amp; rotation → <b>Remove access</b> → share their leads across the RMs in rotation or give them all to one person. Every lead moves with its history; reassign their open tasks from Tasks.</p> },
      { q: 'Keeping an eye on the team', a: <p>Your <b>Dashboard</b> is the team view: open leads, overdue follow-ups, meetings, new prospects and clients; <b>Needs attention</b> (new leads not contacted in 24h, meetings with no outcome, overdue follow-ups, stuck prospects); <b>Quality checks</b> (conversations logged with almost no notes, leads untouched for 7 days, activity dropping); each RM's first-response time; and the funnel per RM against the team. Switch between <b>My team</b> (RMs you manage) and <b>All RMs</b>. You also get a team digest at 9 am. Click an RM to see their pipeline, nudge them or reassign leads.</p> },
      { q: 'Meeting types', a: <p>Admin → <b>Meeting types</b> sets the standard Cal.com types pushed to every RM's account.</p> },
      { q: 'Team views', a: <p>Prospects, Clients, Calendar and the Out List have a picker at the top: <b>My team</b>, <b>All RMs</b> or one RM. The calendar labels each meeting with the RM. On the <b>Out List</b>, tick leads and <b>Give for a second try</b> to hand them to another RM; they bring them back from their own Out List. When uploading, <b>Who gets these leads</b> sends them through routing or all to one RM.</p> },
      { q: 'Duplicates from uploads', a: <p>If someone uploads a person who is already another RM's lead (same phone, secondary number or email), that row is skipped and sent to the uploader's manager. Admin → <b>Duplicates</b> shows who holds the lead, how far they've got with it, and who uploaded it: choose <b>Keep with</b> the current RM or <b>Give to</b> the uploader. Both RMs are told.</p> },
      { q: 'Onboarding checklists', a: <p>Admin → <b>Onboarding checklists</b>: the items each new prospect gets, per product and Resident / NRI. Mark items done by Operations, and ones to repeat for each joint holder.</p> },
    ],
  },
  {
    id: 'trouble', title: 'Troubleshooting',
    items: [
      { q: 'An error says "Could not find the function … in the schema cache"', a: <p>The database is missing a recent update. Tell an admin. Updates are normally applied automatically when a change is released.</p> },
      { q: '"Connect Cal.com first" or the Cal.com connector isn\'t set up', a: <p>Connect your Cal.com under Connections. If it says the connector isn't deployed, an admin needs to deploy it in Supabase.</p> },
      { q: 'The AI summary says "not switched on yet"', a: <p>An admin needs to add the AI settings in Supabase (OPENAI_BASE_URL, OPENAI_API_KEY, OPENAI_MODEL) and deploy the summarize function.</p> },
      { q: 'Something looks out of date', a: <p>Hard-refresh the page (Cmd+Shift+R on Mac, Ctrl+Shift+R on Windows). New versions go live automatically.</p> },
      { q: 'Something is wrong or missing', a: <p>Tell your admin with a screenshot and the lead's name. Error messages are written to be shown as they are.</p> },
    ],
  },
];

// plain text of a ReactNode, for search
function plain(n: ReactNode): string {
  if (n == null || typeof n === 'boolean') return '';
  if (typeof n === 'string' || typeof n === 'number') return String(n);
  if (Array.isArray(n)) return n.map(plain).join(' ');
  const el = n as { props?: { children?: ReactNode } };
  return el.props ? plain(el.props.children) : '';
}

export default function Help() {
  const { isAdmin } = useApp();
  const [q, setQ] = useState('');
  const sections = useMemo(() => {
    const words = q.toLowerCase().split(/\s+/).filter(Boolean);
    return SECTIONS.filter((s) => !s.admin || isAdmin).map((s) => ({
      ...s,
      items: words.length ? s.items.filter((i) => {
        const hay = `${s.title} ${i.q} ${i.text ?? ''} ${plain(i.a)}`.toLowerCase();
        return words.every((w) => hay.includes(w));
      }) : s.items,
    })).filter((s) => s.items.length);
  }, [q, isAdmin]);
  const searching = q.trim().length > 0;
  const hits = sections.reduce((n, s) => n + s.items.length, 0);

  return (
    <div className="main-inner">
      <div className="page-head"><div><h1>Help</h1><p>How {APP_NAME} works, and answers to common questions.</p></div></div>
      <div className="help-wrap">
        <nav className="help-toc">
          {SECTIONS.filter((s) => !s.admin || isAdmin).map((s) => <a key={s.id} href={`#help-${s.id}`} onClick={(e) => { e.preventDefault(); setQ(''); setTimeout(() => document.getElementById(`help-${s.id}`)?.scrollIntoView({ behavior: 'smooth' }), 0); }}>{s.title}</a>)}
        </nav>
        <div className="help-main">
          <input className="help-search" placeholder="Search help, e.g. strike, Cal.com, upload" value={q} onChange={(e) => setQ(e.target.value)} />
          {searching && <p className="muted small" style={{ margin: '8px 0 0' }}>{hits ? `${hits} answer${hits === 1 ? '' : 's'}` : 'No answers match. Try another word, or ask your admin.'}</p>}
          {sections.map((s) => (
            <section key={s.id} id={`help-${s.id}`} className="panel help-section">
              <div className="panel-head"><h2>{s.title}</h2></div>
              <div className="pad">
                {s.intro && !searching && <p className="help-intro">{s.intro}</p>}
                {s.items.map((i) => (
                  <details key={i.q} className="help-qa" open={searching || s.id === 'start' || s.id === 'stages'}>
                    <summary>{i.q}</summary>
                    <div className="help-a">{i.a}</div>
                  </details>
                ))}
              </div>
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}
