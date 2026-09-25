/**
 * Generation worker. Runs as its own process (`npm run worker`), so page reloads,
 * closed tabs and web-server deploys never interrupt a paid generation.
 */
import { providerMode } from "../providers";
import { executeJob } from "./execute";
import { claimJob, recoverStale } from "./queue";

const CONCURRENCY = Number(process.env.WORKER_CONCURRENCY ?? 4);
const IDLE_POLL_MS = 1_000;
const RECOVER_EVERY_MS = 30_000;

let active = 0;
let stopping = false;

async function fill() {
  while (!stopping && active < CONCURRENCY) {
    const job = await claimJob();
    if (!job) return;
    active++;
    console.log(`[worker] ▶ ${job.kind} ${job.modelId} (node ${job.nodeId}, job ${job.id.slice(0, 8)})`);
    const started = Date.now();
    executeJob(job).finally(() => {
      active--;
      console.log(`[worker] ■ job ${job.id.slice(0, 8)} in ${((Date.now() - started) / 1000).toFixed(1)}s`);
      void tick();
    });
  }
}

let ticking = false;
async function tick() {
  if (ticking) return;
  ticking = true;
  try {
    await fill();
  } catch (e) {
    // typically the database is still starting in dev; retried on the next tick
    const err = e as Error & { cause?: Error };
    console.error("[worker] queue unavailable:", err.cause?.message ?? err.message.split("\n")[0]);
  } finally {
    ticking = false;
  }
}

async function main() {
  console.log(`[worker] started · provider=${providerMode()} · concurrency=${CONCURRENCY}`);
  const recovered = await recoverStale().catch(() => 0);
  if (recovered) console.log(`[worker] recovered ${recovered} interrupted job(s)`);
  setInterval(tick, IDLE_POLL_MS);
  setInterval(() => { recoverStale().catch((e) => console.error("[worker] recover failed:", e.message)); }, RECOVER_EVERY_MS);
}

for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, () => { stopping = true; process.exit(0); });
}

main();
