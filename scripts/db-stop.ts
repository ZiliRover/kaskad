/** Stops the local dev Postgres (e.g. one left running after a crashed session). */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { killOrphanPostgres } from "./pg-orphans";

const dataDir = path.resolve(".pgdata");
const win = process.platform === "win32";
const bin = path.resolve(
  "node_modules/@embedded-postgres", `${win ? "windows" : process.platform}-${process.arch}`, "native/bin",
  win ? "pg_ctl.exe" : "pg_ctl",
);

if (existsSync(path.join(dataDir, "postmaster.pid"))) {
  const graceful = spawnSync(bin, ["stop", "-D", dataDir, "-m", "fast", "-t", "10"], { stdio: "ignore" });
  if (graceful.status === 0) {
    console.log("[db] stopped");
    process.exit(0);
  }
}
// pg_ctl can't signal the server on some Windows setups (non-ASCII paths), and killed
// sessions can leave orphans. Safe for a dev database: Postgres replays its WAL on start.
killOrphanPostgres();
console.log("[db] stopped");
