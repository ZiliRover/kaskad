/** Stops the local dev Postgres (e.g. one left running after a crashed session). */
import { stopServer } from "./pg-local";
import { killOrphanPostgres } from "./pg-orphans";

// pg_ctl first; killed sessions can also leave orphans. Safe for a dev database:
// Postgres replays its WAL on the next start.
if (!stopServer()) killOrphanPostgres();
killOrphanPostgres();
console.log("[db] stopped");
