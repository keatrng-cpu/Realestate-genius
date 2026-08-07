// Applies every file in supabase/migrations/ in filename order, inside a
// single transaction per file. Idempotent migrations mean re-running is safe.
//
//   node scripts/migrate.mjs            # apply all
//   node scripts/migrate.mjs --dry      # list what would run
//
// Requires DATABASE_URL (direct Postgres, not PostgREST — PostgREST cannot
// run DDL). Reads .env.local if present.
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import pg from "pg";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");

// Minimal .env.local loader — avoids adding dotenv as a dependency.
const envPath = path.join(repoRoot, ".env.local");
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
}

const dryRun = process.argv.includes("--dry");
const dir = path.join(repoRoot, "supabase", "migrations");
const files = readdirSync(dir)
  .filter((f) => f.endsWith(".sql"))
  .sort();

if (!files.length) {
  console.error("No migrations found in", dir);
  process.exit(1);
}

console.log(`${files.length} migration(s):`);
for (const f of files) {
  const bytes = readFileSync(path.join(dir, f), "utf8").length;
  console.log(`  ${f}  (${bytes.toLocaleString()} bytes)`);
}
if (dryRun) process.exit(0);

const connectionString = process.env.DATABASE_URL;
if (!connectionString || connectionString.includes("REPLACE_ME")) {
  console.error(
    "\nDATABASE_URL is unset or still contains the REPLACE_ME placeholder.\n" +
      "Set the database password in the Supabase dashboard\n" +
      "(Project Settings -> Database -> Reset database password), then put the\n" +
      "connection string in .env.local before running this.",
  );
  process.exit(1);
}

const client = new pg.Client({
  connectionString,
  ssl: { rejectUnauthorized: false },
  // The base schema is large; give it room.
  statement_timeout: 300_000,
  connectionTimeoutMillis: 15_000,
});

await client.connect();
console.log("\nConnected.\n");

// Applied-migration ledger. Necessary because the base schema is NOT
// idempotent — `create type` has no IF NOT EXISTS, so re-running a file that
// already succeeded fails on the first enum. Tracking beats trying to make
// 2,700 lines of DDL re-runnable.
await client.query(`
  create schema if not exists app;
  create table if not exists app.schema_migrations (
    filename   text primary key,
    applied_at timestamptz not null default now()
  );
`);

const { rows } = await client.query("select filename from app.schema_migrations");
const applied = new Set(rows.map((r) => r.filename));

// --baseline records the named files as applied WITHOUT executing them. Use it
// once, for migrations that were applied before this ledger existed.
const baselineIdx = process.argv.indexOf("--baseline");
if (baselineIdx !== -1) {
  const names = process.argv.slice(baselineIdx + 1).filter((a) => a.endsWith(".sql"));
  for (const n of names) {
    await client.query(
      "insert into app.schema_migrations (filename) values ($1) on conflict do nothing",
      [n],
    );
    console.log(`baselined ${n} (recorded, not executed)`);
    applied.add(n);
  }
  console.log("");
}

let failed = false;
for (const f of files) {
  if (applied.has(f)) {
    console.log(`Skipping ${f} (already applied)`);
    continue;
  }
  const sql = readFileSync(path.join(dir, f), "utf8");
  process.stdout.write(`Applying ${f} ... `);
  try {
    await client.query("begin");
    await client.query(sql);
    await client.query(
      "insert into app.schema_migrations (filename) values ($1)",
      [f],
    );
    await client.query("commit");
    console.log("ok");
  } catch (err) {
    await client.query("rollback").catch(() => {});
    console.log("FAILED");
    console.error(`  ${err.message}`);
    if (err.position) console.error(`  at character ${err.position}`);
    failed = true;
    break; // later migrations depend on earlier ones
  }
}

await client.end();
process.exit(failed ? 1 : 0);
