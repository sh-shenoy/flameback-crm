// drizzle-kit is used only to pull the typed schema from the database (npm run db:pull).
// Migrations are hand-written SQL in ../supabase/migrations and applied with npm run db:migrate;
// don't use `drizzle-kit generate` or `push` (they can't express our functions, RLS and triggers).
import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  dialect: 'postgresql',
  out: './.pull',
  schemaFilter: ['public'],
  dbCredentials: { url: process.env.DATABASE_URL! },
});
