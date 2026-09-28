import { sql } from "drizzle-orm";
import {
  bigint, index, integer, jsonb, numeric, pgEnum, pgTable, text, timestamp, uniqueIndex, uuid,
} from "drizzle-orm/pg-core";
import type { GraphDoc } from "@/lib/graph/types";
import type { JobInput } from "@/lib/jobs";

export const jobStatus = pgEnum("job_status", [
  "queued", "running", "succeeded", "failed", "skipped", "canceled",
]);

export const mediaKind = pgEnum("media_kind", ["text", "image", "video"]);

/** A canvas document. */
export const graphs = pgTable("graphs", {
  id: text("id").primaryKey(),
  /** set once accounts land; null = the pre-accounts shared graph */
  ownerId: text("owner_id"),
  name: text("name").notNull(),
  doc: jsonb("doc").$type<GraphDoc>().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("graphs_owner_idx").on(t.ownerId, t.updatedAt),
]);

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
  /** position in a batch run (list item); null for a single run */
  item: integer("item"),
  /** who pays; null only for jobs created before accounts existed */
  userId: uuid("user_id"),
  /** kopecks reserved from the balance when the job was queued */
  holdKop: bigint("hold_kop", { mode: "number" }).notNull().default(0),
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

// ---------------------------------------------------------------- accounts and money

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull().unique(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Opaque session tokens; only their SHA-256 is stored. */
export const sessions = pgTable("sessions", {
  id: text("id").primaryKey(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
}, (t) => [index("sessions_user_idx").on(t.userId)]);

/** One-time email login codes (hashed), with attempt counting. */
export const loginCodes = pgTable("login_codes", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull(),
  codeHash: text("code_hash").notNull(),
  attempts: integer("attempts").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  usedAt: timestamp("used_at", { withTimezone: true }),
}, (t) => [index("login_codes_email_idx").on(t.email, t.createdAt)]);

export const ledgerKind = pgEnum("ledger_kind", ["topup", "bonus", "hold", "release", "charge", "adjust"]);

/**
 * Every money movement, in kopecks. The balance is the sum; nothing stores it separately,
 * so it can always be audited and re-derived.
 */
export const ledger = pgTable("ledger", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  amountKop: bigint("amount_kop", { mode: "number" }).notNull(),
  kind: ledgerKind("kind").notNull(),
  jobId: uuid("job_id"),
  paymentId: uuid("payment_id"),
  note: text("note"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("ledger_user_idx").on(t.userId, t.createdAt),
  // settlement is exactly-once per job and kind, and a payment tops up once
  uniqueIndex("ledger_job_kind_uq").on(t.jobId, t.kind),
  uniqueIndex("ledger_payment_uq").on(t.paymentId),
]);

export const paymentStatus = pgEnum("payment_status", ["pending", "succeeded", "canceled"]);

export const payments = pgTable("payments", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  provider: text("provider").notNull(),
  amountKop: bigint("amount_kop", { mode: "number" }).notNull(),
  status: paymentStatus("status").notNull().default("pending"),
  externalId: text("external_id"),
  confirmationUrl: text("confirmation_url"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  paidAt: timestamp("paid_at", { withTimezone: true }),
}, (t) => [index("payments_user_idx").on(t.userId, t.createdAt)]);

export type UserRow = typeof users.$inferSelect;
export type LedgerRow = typeof ledger.$inferSelect;
