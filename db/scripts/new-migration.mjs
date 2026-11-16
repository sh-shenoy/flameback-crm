// npm run db:new -- <name>   → creates supabase/migrations/NNNN_<name>.sql and registers it in the journal.
import fs from 'node:fs';
import path from 'node:path';

const dir = path.resolve(import.meta.dirname, '../../supabase/migrations');
const name = (process.argv[2] ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
if (!name) { console.error('Usage: npm run db:new -- <name>'); process.exit(1); }
const jp = path.join(dir, 'meta/_journal.json');
const journal = JSON.parse(fs.readFileSync(jp, 'utf8'));
const idx = journal.entries.length;
const tag = `${String(idx + 1).padStart(4, '0')}_${name}`;
const when = Math.max(Date.now(), (journal.entries.at(-1)?.when ?? 0) + 1);
fs.writeFileSync(path.join(dir, `${tag}.sql`), `-- Argus · ${tag.slice(0, 4)}: ${name.replace(/_/g, ' ')}\n\n`);
journal.entries.push({ idx, version: '7', when, tag, breakpoints: false });
fs.writeFileSync(jp, JSON.stringify(journal, null, 2) + '\n');
console.log(`Created supabase/migrations/${tag}.sql`);
