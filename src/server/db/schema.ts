import { sql } from "drizzle-orm";
import {
  index, integer, jsonb, numeric, pgEnum, pgTable, text, timestamp, uuid,
} from "drizzle-orm/pg-core";
import type { GraphDoc } from "@/lib/graph/types";
import type { JobInput } from "@/lib/jobs";

export const jobStatus = pgEnum("job_status", [
  "queued", "running", "succeeded", "failed", "skipped", "canceled",
]);

export const mediaKind = pgEnum("media_kind", ["text", "image", "video"]);

/** A canvas document. Owned by a user once accounts land. */
export const graphs = pgTable("graphs", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  doc: jsonb("doc").$type<GraphDoc>().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/** One press of "run": a set of jobs planned together. */
export const runs = pgTable("runs", {
  id: uuid("id").primaryKey().defaultRandom(),
  graphId: text("graph_id").notNull().references(() => graphs.id, { onDelete: "cascade" }),
  estimateUsd: numeric("estimate_usd", { precision: 12, scale: 6 }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Execution of a single model node. */
export const jobs = pgTable("jobs", {
  id: uuid("id").primaryKey().defaultRandom(),
  runId: uuid("run_id").notNull().references(() => runs.id, { onDelete: "cascade" }),
  graphId: text("graph_id").notNull().references(() => graphs.id, { onDelete: "cascade" }),
  nodeId: text("node_id").notNull(),
  kind: mediaKind("kind").notNull(),
  modelId: text("model_id").notNull(),
  input: jsonb("input").$type<JobInput>().notNull(),
  dependsOn: uuid("depends_on").array().notNull().default(sql`'{}'::uuid[]`),
  status: jobStatus("status").notNull().default("queued"),
  /** provider-side job id for async generations; lets a restarted worker resume polling instead of paying twice */
  externalId: text("external_id"),
  error: text("error"),
  estimateUsd: numeric("estimate_usd", { precision: 12, scale: 6 }),
  costUsd: numeric("cost_usd", { precision: 12, scale: 6 }),
  attempts: integer("attempts").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  startedAt: timestamp("started_at", { withTimezone: true }),
  heartbeatAt: timestamp("heartbeat_at", { withTimezone: true }),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
}, (t) => [
  index("jobs_status_created_idx").on(t.status, t.createdAt),
  index("jobs_graph_node_idx").on(t.graphId, t.nodeId, t.createdAt),
]);

/** Results. Every successful job adds one; nodes show the latest, older ones stay as history. */
export const outputs = pgTable("outputs", {
  id: uuid("id").primaryKey().defaultRandom(),
  graphId: text("graph_id").notNull().references(() => graphs.id, { onDelete: "cascade" }),
  nodeId: text("node_id").notNull(),
  jobId: uuid("job_id").notNull().references(() => jobs.id, { onDelete: "cascade" }),
  kind: mediaKind("kind").notNull(),
  fileKey: text("file_key"),
  mime: text("mime"),
  text: text("text"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("outputs_graph_node_idx").on(t.graphId, t.nodeId, t.createdAt),
]);

export type JobRow = typeof jobs.$inferSelect;
export type OutputRow = typeof outputs.$inferSelect;
