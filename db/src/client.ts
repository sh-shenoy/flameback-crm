// Typed database access for SERVER code only (scripts, jobs, a future backend). Never ship this to the
// browser: DATABASE_URL carries the database password. The web app keeps using supabase-js.
//
//   import { db, asUser, schema } from './client';
//   const rows = await asUser(rmId, (tx) => tx.select().from(schema.leads));   // RLS applies: only that RM's leads
//   const all  = await db.select().from(schema.leads);                           // full access: admin jobs only
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { sql } from 'drizzle-orm';
import * as tables from './schema';
import * as relations from './relations';

export const schema = { ...tables, ...relations };

const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL is not set');

// prepare: false keeps it working through Supabase's transaction pooler too.
export const client = postgres(url, { prepare: false });

/** Full access (the connection's own role bypasses row-level security). Use for admin jobs only. */
export const db = drizzle(client, { schema });

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Run queries as a signed-in user: same row-level security as the app, so an RM sees only their
 * own leads and the database functions (log_activity, …) check their permissions as usual.
 */
export function asUser<T>(userId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
  const claims = JSON.stringify({ sub: userId, role: 'authenticated' });
  return db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('request.jwt.claims', ${claims}, true), set_config('request.jwt.claim.sub', ${userId}, true)`);
    await tx.execute(sql`set local role authenticated`);
    return fn(tx);
  });
}
