/**
 * Live channel of a project: edits, presence (cursors) and job updates reach everyone
 * who has the project open. Messages travel through Postgres NOTIFY, so they cross
 * processes (web servers and the worker); each web process fans them out to its
 * open Server-Sent Events streams.
 */
import { EventEmitter } from "node:events";
import { sql } from "drizzle-orm";
import { db, sqlClient } from "./db";

const CHANNEL = "kaskad_live";
/** NOTIFY payloads are capped at 8000 bytes; bigger edits tell clients to reload instead */
const MAX_PAYLOAD = 7500;

export type LiveMessage =
  | { t: "ops"; from: string; ops: unknown }
  | { t: "reload"; from: string }
  | { t: "presence"; from: string; user: { id: string; email: string }; cursor: { x: number; y: number } | null; selection: string[] }
  | { t: "leave"; from: string }
  | { t: "state" }
  | { t: "comments" };

const g = globalThis as unknown as { __live?: { bus: EventEmitter; ready: Promise<unknown> } };

/** One LISTEN per process, fanned out by graph id. */
function hub() {
  if (!g.__live) {
    const bus = new EventEmitter();
    bus.setMaxListeners(0);
    const ready = sqlClient.listen(CHANNEL, (payload) => {
      try {
        const { g: graphId, ...msg } = JSON.parse(payload);
        bus.emit(graphId, msg);
      } catch { /* a malformed message is dropped */ }
    });
    g.__live = { bus, ready };
  }
  return g.__live;
}

export async function publish(graphId: string, msg: LiveMessage) {
  let payload = JSON.stringify({ g: graphId, ...msg });
  if (payload.length > MAX_PAYLOAD) {
    if (msg.t !== "ops") return;
    payload = JSON.stringify({ g: graphId, t: "reload", from: msg.from });
  }
  await db.execute(sql`select pg_notify(${CHANNEL}, ${payload})`);
}

export async function subscribe(graphId: string, fn: (msg: LiveMessage) => void): Promise<() => void> {
  const h = hub();
  await h.ready;
  h.bus.on(graphId, fn);
  return () => { h.bus.off(graphId, fn); };
}
