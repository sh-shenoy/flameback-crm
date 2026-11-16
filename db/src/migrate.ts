// Applies pending migrations from ../supabase/migrations to the database in DATABASE_URL.
//
//   DATABASE_URL='postgresql://…' npm run db:migrate
//
// Migrations are hand-written SQL (functions, RLS policies, triggers and cron jobs that Drizzle
// can't express), listed in supabase/migrations/meta/_journal.json. Drizzle's migrator runs the
// new ones in one transaction and records them in drizzle.__drizzle_migrations.
//
// First run on a database that was set up by hand (SQL Editor): it checks which migrations are
// already there and records those as applied, so nothing is run twice.
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';

const here = path.dirname(fileURLToPath(import.meta.url));
export const MIGRATIONS = path.resolve(here, '../../supabase/migrations');

// How to tell each migration is already in the database (for the first run only).
const PROBES: Record<string, string> = {
  '0001_rm_presales': `to_regclass('public.leads') is not null`,
  '0002_tasks': `to_regclass('public.tasks') is not null`,
  '0003_calendly': `to_regclass('public.calendly_connections') is not null`,
  '0004_notifications_access_reports': `to_regclass('public.gmail_messages') is not null`,
  '0005_admin_overview': `to_regclass('public.nudges') is not null`,
  '0006_calcom': `to_regclass('public.meetings') is not null`,
  '0007_meeting_templates': `to_regclass('public.meeting_templates') is not null`,
  '0008_log_activity': `to_regprocedure('public.log_activity(uuid,text,text,text,timestamptz,date,text,date,text)') is not null`,
  '0009_log_activity_deferred': `exists (select 1 from pg_proc where proname = 'record_meeting' and prosrc like '%''awaiting_meeting'',''holding'',''deferred''%')`,
  '0010_lead_summaries': `to_regclass('public.lead_summaries') is not null`,
  '0011_bulk_delete': `to_regprocedure('public.delete_leads(uuid[])') is not null`,
  '0012_holding_cadence': `exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'leads' and column_name = 'holding_step')`,
};

type Entry = { tag: string; when: number };

async function baseline(sql: postgres.Sql, log: (s: string) => void) {
  await sql`create schema if not exists drizzle`;
  await sql`create table if not exists drizzle.__drizzle_migrations (id serial primary key, hash text not null, created_at bigint)`;
  const [{ n }] = await sql`select count(*)::int as n from drizzle.__drizzle_migrations`;
  if (n > 0) return;                                                     // already tracked
  const [{ has }] = await sql`select to_regclass('public.leads') is not null as has`;
  if (!has) return;                                                      // empty database: run everything

  const journal: { entries: Entry[] } = JSON.parse(fs.readFileSync(path.join(MIGRATIONS, 'meta/_journal.json'), 'utf8'));
  const applied: Entry[] = [];
  for (const e of journal.entries) {                                     // longest run of migrations already present
    const probe = PROBES[e.tag];
    if (!probe) break;
    const [{ ok }] = await sql.unsafe(`select (${probe}) as ok`);
    if (!ok) break;
    applied.push(e);
  }
  for (const e of applied) {
    const hash = crypto.createHash('sha256').update(fs.readFileSync(path.join(MIGRATIONS, `${e.tag}.sql`))).digest('hex');
    await sql`insert into drizzle.__drizzle_migrations (hash, created_at) values (${hash}, ${e.when})`;
  }
  log(`Existing database: recorded ${applied.length} migration(s) as already applied${applied.length ? ` (up to ${applied.at(-1)!.tag})` : ''}.`);
}

export async function run(url: string, log: (s: string) => void = console.log) {
  const sql = postgres(url, { max: 1, prepare: false, onnotice: () => {} });
  try {
    await baseline(sql, log);
    const [{ before }] = await sql`select count(*)::int as before from drizzle.__drizzle_migrations`;
    await migrate(drizzle(sql), { migrationsFolder: MIGRATIONS });
    const [{ after }] = await sql`select count(*)::int as after from drizzle.__drizzle_migrations`;
    await sql`notify pgrst, 'reload schema'`;                             // the API sees new functions straight away
    log(after > before ? `Applied ${after - before} migration(s).` : 'Database is up to date.');
  } finally {
    await sql.end();
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const url = process.env.DATABASE_URL;
  if (!url) { console.error('Set DATABASE_URL to the Supabase connection string (Connect → Session pooler).'); process.exit(1); }
  run(url).catch((e) => { console.error(`Migration failed, nothing was changed: ${e.message ?? e}`); process.exit(1); });
}
