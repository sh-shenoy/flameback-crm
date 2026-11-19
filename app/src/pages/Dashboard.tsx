import { useEffect, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApp } from '../auth';
import { supabase } from '../lib/supabase';
import { addDays, todayIST } from '../lib/format';
import { whereContact, type Bucket } from '../lib/types';
import { Skeleton } from '../components/ui';
import { fmtINR } from '../components/OnboardingCard';

/*
 * Dashboard: a summary in numbers only — counts, AUM, money funded. No client names here;
 * every number is a button that opens the page with the details.
 */

const WORKING: Bucket[] = ['active_contact', 'awaiting_meeting', 'holding', 'deferred'];

interface Day { follow: number; overdue: number; meetings: number; tasks: number; tasksOverdue: number }
interface Pipe { open: number; fresh: number; notPicked: number; followUp: number; awaiting: number; holding: number; deferred: number; prospects: number; clients: number }
interface Money { aum: number; fundedMonth: number; fundedMonthN: number; prospectsMonth: number }

function monthStart(): string { return todayIST().slice(0, 8) + '01'; }
const istStart = (d: string) => new Date(`${d}T00:00:00+05:30`).toISOString();

export default function Dashboard() {
  const { me } = useApp();
  const nav = useNavigate();
  const [when, setWhen] = useState<'today' | 'tomorrow'>('today');
  const [day, setDay] = useState<Day | null>(null);
  const [pipe, setPipe] = useState<Pipe | null>(null);
  const [money, setMoney] = useState<Money | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const mine = (q: any) => q.eq('rm_id', me!.id);
  const leadCount = async (build: (q: any) => any) => {
    const { count, error } = await build(mine(supabase.from('leads').select('id', { count: 'exact', head: true })));
    if (error) throw error;
    return count ?? 0;
  };
  const myTasks = () => supabase.from('tasks').select('id', { count: 'exact', head: true })
    .or(`assignee_id.eq.${me!.id},and(assignee_id.is.null,to_team.eq.${me!.team})`).neq('status', 'done');
  const taskCount = async (build: (q: any) => any) => { const { count, error } = await build(myTasks()); if (error) throw error; return count ?? 0; };

  // the day: today or tomorrow
  useEffect(() => {
    const d = when === 'today' ? todayIST() : addDays(todayIST(), 1);
    setDay(null);
    Promise.all([
      leadCount((q) => q.in('bucket', WORKING).eq('next_follow_up', d)),
      leadCount((q) => q.in('bucket', WORKING).lt('next_follow_up', todayIST())),
      supabase.from('meetings').select('booking_uid', { count: 'exact', head: true }).eq('rm_id', me!.id).eq('status', 'active')
        .gte('start_time', istStart(d)).lt('start_time', istStart(addDays(d, 1))).then(({ count, error }) => { if (error) throw error; return count ?? 0; }),
      taskCount((q) => q.eq('due_date', d)),
      taskCount((q) => q.lt('due_date', todayIST())),
    ]).then(([follow, overdue, meetings, tasks, tasksOverdue]) => setDay({ follow, overdue, meetings, tasks, tasksOverdue }))
      .catch((e) => setErr(e.message));
  }, [me, when]);   // eslint-disable-line react-hooks/exhaustive-deps

  // pipeline and money
  useEffect(() => {
    Promise.all([
      leadCount((q) => q.in('bucket', WORKING)),
      leadCount((q) => whereContact(q, 'new')),
      leadCount((q) => whereContact(q, 'not_picked')),
      leadCount((q) => whereContact(q, 'follow_up')),
      leadCount((q) => q.eq('bucket', 'awaiting_meeting')),
      leadCount((q) => q.eq('bucket', 'holding')),
      leadCount((q) => q.eq('bucket', 'deferred')),
      leadCount((q) => q.eq('bucket', 'converting')),
      leadCount((q) => q.eq('bucket', 'client')),
    ]).then(([open, fresh, notPicked, followUp, awaiting, holding, deferred, prospects, clients]) =>
      setPipe({ open, fresh, notPicked, followUp, awaiting, holding, deferred, prospects, clients }))
      .catch((e) => setErr(e.message));

    Promise.all([
      mine(supabase.from('leads').select('funded_amount, funded_at').eq('bucket', 'client')).limit(10000),
      leadCount((q) => q.in('bucket', ['converting', 'client']).gte('converted_at', istStart(monthStart()))),
    ]).then(([c, prospectsMonth]: any[]) => {
      if (c.error) throw c.error;
      const rows = (c.data ?? []) as { funded_amount: number | null; funded_at: string | null }[];
      const thisMonth = rows.filter((r) => r.funded_at && r.funded_at >= monthStart());
      setMoney({
        aum: rows.reduce((s, r) => s + (Number(r.funded_amount) || 0), 0),
        fundedMonth: thisMonth.reduce((s, r) => s + (Number(r.funded_amount) || 0), 0),
        fundedMonthN: thisMonth.length,
        prospectsMonth,
      });
    }).catch((e) => setErr(e.message));
  }, [me]);   // eslint-disable-line react-hooks/exhaustive-deps

  const hour = Number(new Intl.DateTimeFormat('en-GB', { hour: 'numeric', hour12: false, timeZone: 'Asia/Kolkata' }).format(new Date()));
  const greet = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  const first = me?.full_name?.split(' ')[0] ?? '';
  const todayLong = new Intl.DateTimeFormat('en-GB', { weekday: 'long', day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' }).format(new Date());
  const isToday = when === 'today';
  const dayWord = isToday ? 'today' : 'tomorrow';

  return (
    <div className="main-inner">
      <div className="page-head">
        <div><h1>{greet}, {first}</h1><p>{todayLong}</p></div>
      </div>
      {err && <div className="banner warn">Couldn't load the numbers: {err}</div>}

      <Section title={<>
        <span className="seg sm">
          <button className={isToday ? 'on' : ''} onClick={() => setWhen('today')}>Today</button>
          <button className={!isToday ? 'on' : ''} onClick={() => setWhen('tomorrow')}>Tomorrow</button>
        </span>
      </>}>
        <Tile label={`Follow-ups ${dayWord}`} v={day?.follow} onClick={() => nav(`/leads?due=${when}`)} />
        {isToday && <Tile label="Overdue follow-ups" v={day?.overdue} tone="red" onClick={() => nav('/leads?due=overdue')} />}
        <Tile label={`Meetings ${dayWord}`} v={day?.meetings} onClick={() => nav('/calendar')} />
        <Tile label={`Tasks due ${dayWord}`} v={day?.tasks} onClick={() => nav(`/tasks?due=${isToday ? 'today' : ''}`)} />
        {isToday && <Tile label="Overdue tasks" v={day?.tasksOverdue} tone="red" onClick={() => nav('/tasks?due=overdue')} />}
        <Tile label="Rebalances" soon />
      </Section>

      <Section title="Business">
        <Tile label="Total AUM" text={money ? fmtINR(money.aum) : undefined} sub={pipe ? `${pipe.clients} client${pipe.clients === 1 ? '' : 's'}` : ''} onClick={() => nav('/clients')} />
        <Tile label="Funded this month" text={money ? fmtINR(money.fundedMonth) : undefined} sub={money ? `${money.fundedMonthN} client${money.fundedMonthN === 1 ? '' : 's'}` : ''} onClick={() => nav('/clients')} />
        <Tile label="Payments pending" v={pipe?.prospects} sub="prospects not funded yet" tone="amber" onClick={() => nav('/prospects')} />
        <Tile label="New prospects this month" v={money?.prospectsMonth} onClick={() => nav('/prospects')} />
        <Tile label="Revenue" soon />
      </Section>

      <Section title="Pipeline" cols={4}>
        <Tile label="Open leads" v={pipe?.open} onClick={() => nav('/leads')} />
        <Tile label="New, to contact" v={pipe?.fresh} onClick={() => nav('/leads?bucket=new')} />
        <Tile label="Not picked up" v={pipe?.notPicked} onClick={() => nav('/leads?bucket=not_picked')} />
        <Tile label="Follow-up" v={pipe?.followUp} onClick={() => nav('/leads?bucket=active_contact')} />
        <Tile label="Awaiting meeting" v={pipe?.awaiting} onClick={() => nav('/leads?bucket=awaiting_meeting')} />
        <Tile label="Holding period" v={pipe?.holding} onClick={() => nav('/leads?bucket=holding')} />
        <Tile label="Deferred" v={pipe?.deferred} onClick={() => nav('/leads?bucket=deferred')} />
        <Tile label="Prospects" v={pipe?.prospects} onClick={() => nav('/prospects')} />
      </Section>
    </div>
  );
}

function Section({ title, children, cols }: { title: ReactNode; children: ReactNode; cols?: number }) {
  return (
    <section className="dash-sec">
      <h2 className="dash-sec-title">{title}</h2>
      <div className={`cards dash-tiles ${cols ? `cols-${cols}` : ''}`}>{children}</div>
    </section>
  );
}

/** A number that opens its details. */
function Tile({ label, v, text, sub, onClick, tone, soon }: {
  label: string; v?: number; text?: string; sub?: ReactNode; onClick?: () => void; tone?: 'red' | 'amber'; soon?: boolean;
}) {
  if (soon) return (
    <div className="card soon"><div className="k">{label}</div><div className="v muted">—</div><div className="meta"><span className="soon-chip">Coming soon</span></div></div>
  );
  const loading = v === undefined && text === undefined;
  const shown = text ?? v;
  return (
    <button type="button" className="card clickable dash-tile" onClick={onClick}>
      <div className="k">{label}</div>
      <div className={`v ${v === 0 ? 'zero' : v && tone ? tone : ''}`}>{loading ? <Skeleton h={30} w={50} /> : shown}</div>
      <div className="meta">{sub}<span className="dash-go" aria-hidden>→</span></div>
    </button>
  );
}
