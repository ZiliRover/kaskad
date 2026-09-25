/**
 * Local Postgres for development: a real server from the embedded-postgres
 * package, data in ./.pgdata. Applies migrations on start. Production uses a
 * managed Postgres and runs the same migrations.
 */
import { existsSync } from "node:fs";
import path from "node:path";
import EmbeddedPostgres from "embedded-postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { killOrphanPostgres } from "./pg-orphans";

const url = new URL(process.env.DATABASE_URL ?? "postgres://postgres:postgres@localhost:54329/kaskad");
const dir = path.resolve(".pgdata");
const dbName = url.pathname.slice(1);

const pg = new EmbeddedPostgres({
  databaseDir: dir,
  user: url.username,
  password: url.password,
  port: Number(url.port),
  persistent: true,
  onLog: (m) => { if (process.env.DB_DEBUG) console.log("[pg]", m); },
  onError: (e) => { if (process.env.DB_DEBUG) console.log("[pg-err]", e); },
});

let owned = false;

async function alreadyRunning(): Promise<boolean> {
  const probe = postgres({ ...pgOpts(), database: "postgres", max: 1, connect_timeout: 2, onnotice: () => {} });
  try { await probe`select 1`; return true; } catch { return false; } finally { await probe.end().catch(() => {}); }
}

function pgOpts() {
  return { host: url.hostname, port: Number(url.port), username: url.username, password: url.password };
}

async function main() {
  // a server left over from a killed session (Windows doesn't always stop child processes): reuse it
  if (await alreadyRunning()) {
    console.log("[db] reusing Postgres already running on this port");
  } else {
    if (!existsSync(path.join(dir, "PG_VERSION"))) {
      console.log("[db] first run: initialising cluster in .pgdata");
      await pg.initialise();
    }
    try {
      await pg.start();
    } catch {
      // usually orphaned processes of a killed session still hold shared memory
      console.log("[db] start failed, cleaning up leftover Postgres processes and retrying");
      killOrphanPostgres();
      await new Promise((r) => setTimeout(r, 1000));
      await pg.start();
    }
    owned = true;
  }
  try { await pg.createDatabase(dbName); } catch { /* already exists */ }

  const client = postgres(url.toString(), { max: 1, onnotice: () => {} });
  await migrate(drizzle(client), { migrationsFolder: "drizzle" });
  await client.end();
  console.log(`[db] ready on ${url.host}/${dbName}`);
}

async function stop() {
  if (owned) await pg.stop().catch(() => {});
  process.exit(0);
}
process.on("SIGINT", stop);
process.on("SIGTERM", stop);

main().catch(async (e) => {
  console.error("[db] failed:", e);
  await pg.stop().catch(() => {});
  process.exit(1);
});

// keep the process alive while the server runs
setInterval(() => {}, 1 << 30);
