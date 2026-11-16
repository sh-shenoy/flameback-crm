# Argus database (Drizzle ORM)

Drizzle does two jobs here:

1. **Runs migrations.** The SQL files in `../supabase/migrations` are applied in order and recorded in
   `drizzle.__drizzle_migrations`, so each one runs once. A merge to `master` applies new migrations to
   Supabase automatically (GitHub Action `Database`), so nothing has to be pasted into the SQL Editor.
2. **Typed schema for server code.** `src/schema.ts` and `src/relations.ts` are generated from the
   database; `src/client.ts` gives a typed `db`, and `asUser()` runs queries with an RM's own permissions.

The web app does **not** use Drizzle: it runs in the browser, where a database password can't go, so it
keeps using supabase-js with row-level security.

Migrations stay hand-written SQL because most of Argus's rules live in the database (functions such as
`log_activity`, RLS policies, triggers, cron jobs), which Drizzle's schema files can't express.
Don't use `drizzle-kit generate` or `drizzle-kit push`.

## One-time setup (automatic migrations)

1. Supabase → **Connect** → **Session pooler** → copy the URI and put the database password in it.
2. GitHub → repository **Settings → Secrets and variables → Actions → New repository secret**:
   name `DATABASE_URL`, value the URI.
3. GitHub → **Actions → Database → Run workflow** once. On the first run it sees which migrations are
   already in the database (set up by hand) and records them, then applies only the missing ones.

From then on every merge that adds a migration applies it, and reloads the API schema.

## Commands (in this folder)

```bash
npm install
export DATABASE_URL='postgresql://…'   # only in your own terminal; never commit it
npm run db:migrate                      # apply pending migrations
npm run db:new -- add_something         # new empty migration file, registered in the journal
npm run db:pull                         # regenerate src/schema.ts + src/relations.ts after a migration
npm run typecheck
```

## Adding a migration

1. `npm run db:new -- short_name` and write the SQL in the new file.
2. Open a pull request: the Action applies every migration to a throwaway Postgres and runs the SQL tests.
3. Merge: the Action applies it to Supabase.
4. `npm run db:pull` and commit the regenerated schema.

## Using the typed client (server code)

```ts
import { db, asUser, schema } from './src/client';
import { eq } from 'drizzle-orm';

const mine = await asUser(rmId, (tx) => tx.select().from(schema.leads));   // RLS: only that RM's leads
const lead = await db.query.leads.findFirst({ where: eq(schema.leads.id, id), with: { leadEntries: true } });
```
`db` on its own bypasses row-level security; keep it for admin jobs.
