/**
 * Local Postgres for development: data in ./.pgdata, UTF-8, migrations applied on start.
 * Production uses a managed Postgres and runs the same migrations.
 */
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { clusterExists, initCluster, startServer, stopServer } from "./pg-local";
import { killOrphanPostgres } from "./pg-orphans";

const url = new URL(process.env.DATABASE_URL ?? "postgres://postgres:postgres@localhost:54329/kaskad");
const dbName = url.pathname.slice(1);
const port = Number(url.port);
const debug = !!process.env.DB_DEBUG;

let owned = false;

const admin = () => postgres({
  host: url.hostname, port, username: url.username, password: url.password,
  database: "postgres", max: 1, connect_timeout: 2, onnotice: () => {},
});

async function reachable(): Promise<boolean> {
  const c = admin();
  try { await c`select 1`; return true; } catch { return false; } finally { await c.end().catch(() => {}); }
}

async function waitReady(ms = 30_000) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    if (await reachable()) return;
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error("Postgres did not start in time (run with DB_DEBUG=1 to see its log)");
}

async function start() {
  const p = startServer(port, debug ? (l) => process.stdout.write(`[pg] ${l}`) : undefined);
  p.on("exit", (code) => { if (owned) { console.error(`[db] postgres exited (${code})`); process.exit(1); } });
  owned = true;
  await waitReady();
}

async function main() {
  // a server left over from a killed session (Windows doesn't always stop children): reuse it
  if (await reachable()) {
    console.log("[db] reusing Postgres already running on this port");
  } else {
    if (!clusterExists()) {
      console.log("[db] first run: creating a UTF-8 cluster in .pgdata");
      initCluster(url.username, url.password);
    }
    try {
      await start();
    } catch {
      // usually orphaned processes of a killed session still hold shared memory
      console.log("[db] start failed, cleaning up leftover Postgres processes and retrying");
      owned = false;
      killOrphanPostgres();
      await new Promise((r) => setTimeout(r, 1000));
      await start();
    }
  }

  const a = admin();
  const exists = await a`select 1 from pg_database where datname = ${dbName}`;
  if (!exists.length) await a.unsafe(`create database "${dbName}"`);
  await a.end();

  const client = postgres(url.toString(), { max: 1, onnotice: () => {} });
  const [{ enc }] = await client`select pg_encoding_to_char(encoding) as enc from pg_database where datname = current_database()`;
  if (enc !== "UTF8") {
    console.error(`[db] the dev database uses ${enc}, not UTF8: prompts with emoji or symbols would fail to save.`);
    console.error("[db] recreate it (dev data will be lost): npm run db:reset, then start again");
    await client.end();
    await stop(1);
  }
  await migrate(drizzle(client), { migrationsFolder: "drizzle" });
  await client.end();
  console.log(`[db] ready on ${url.host}/${dbName}`);
}

async function stop(code = 0) {
  if (owned) {
    owned = false;
    if (!stopServer()) killOrphanPostgres();
  }
  process.exit(code);
}
process.on("SIGINT", () => stop());
process.on("SIGTERM", () => stop());

main().catch(async (e) => {
  console.error("[db] failed:", e instanceof Error ? e.message : e);
  await stop(1);
});

// keep the process alive while the server runs
setInterval(() => {}, 1 << 30);
