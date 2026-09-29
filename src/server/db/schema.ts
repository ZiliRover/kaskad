import { sql } from "drizzle-orm";
import {
  bigint, boolean, doublePrecision, index, integer, jsonb, numeric, pgEnum, pgTable, primaryKey, text, timestamp, uniqueIndex, uuid,
} from "drizzle-orm/pg-core";
import type { GraphDoc } from "@/lib/graph/types";
import type { AppField } from "@/lib/apps";
import type { JobInput } from "@/lib/jobs";

export const jobStatus = pgEnum("job_status", [
  "queued", "running", "succeeded", "failed", "skipped", "canceled",
]);

export const mediaKind = pgEnum("media_kind", ["text", "image", "video", "audio"]);

/** A canvas document. */
export const graphs = pgTable("graphs", {
  id: text("id").primaryKey(),
  /** set once accounts land; null = the pre-accounts shared graph */
  ownerId: text("owner_id"),
  /** a runner's private copy of a published app; hidden from the project list */
  appId: uuid("app_id"),
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
export type GraphRow = typeof graphs.$inferSelect;
export type OutputRow = typeof outputs.$inferSelect;

// ---------------------------------------------------------------- accounts and money

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull().unique(),
  /** where the account was created from: limits welcome bonuses per address */
  signupIp: text("signup_ip"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("users_signup_ip_idx").on(t.signupIp, t.createdAt)]);

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
  ip: text("ip"),
}, (t) => [index("login_codes_email_idx").on(t.email, t.createdAt), index("login_codes_ip_idx").on(t.ip, t.createdAt)]);

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

/**
 * A graph published as an app: a frozen copy of the graph, the inputs people fill in
 * and the nodes whose results they get. Runners pay for their own runs.
 */
export const apps = pgTable("apps", {
  id: uuid("id").primaryKey().defaultRandom(),
  ownerId: uuid("owner_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  sourceGraphId: text("source_graph_id"),
  name: text("name").notNull(),
  description: text("description").notNull().default(""),
  doc: jsonb("doc").$type<GraphDoc>().notNull(),
  fields: jsonb("fields").$type<AppField[]>().notNull(),
  outputs: jsonb("outputs").$type<string[]>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("apps_owner_idx").on(t.ownerId, t.createdAt)]);

export type AppRow = typeof apps.$inferSelect;

/**
 * The showcase: results people chose to show everyone. The file is copied under
 * uploads/feed-<id>/ so the post outlives the project; the prompt only if the author shares it.
 */
export const posts = pgTable("posts", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  /** the result it came from; one post per result */
  outputId: uuid("output_id").notNull().unique(),
  kind: text("kind").notNull(),
  fileKey: text("file_key").notNull(),
  width: integer("width").notNull(),
  height: integer("height").notNull(),
  prompt: text("prompt"),
  model: text("model").notNull(),
  /** taken off the wall by reports or by an operator; the author still sees it */
  hidden: boolean("hidden").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("posts_created_idx").on(t.createdAt)]);

/** One like per person per post. */
export const postLikes = pgTable("post_likes", {
  postId: uuid("post_id").notNull().references(() => posts.id, { onDelete: "cascade" }),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [primaryKey({ columns: [t.postId, t.userId] }), index("post_likes_post_idx").on(t.postId)]);

/** Complaints about showcase posts, one per person. */
export const postReports = pgTable("post_reports", {
  postId: uuid("post_id").notNull().references(() => posts.id, { onDelete: "cascade" }),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  reason: text("reason").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [primaryKey({ columns: [t.postId, t.userId] })]);

/** The user's library: characters, products, brands and styles to reuse across projects. */
export const libraryItems = pgTable("library_items", {
  id: uuid("id").primaryKey().defaultRandom(),
  ownerId: uuid("owner_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  kind: text("kind").notNull(),
  name: text("name").notNull(),
  description: text("description").notNull().default(""),
  files: jsonb("files").$type<string[]>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("library_owner_idx").on(t.ownerId, t.updatedAt)]);

export type LibraryRow = typeof libraryItems.$inferSelect;

/** Files people uploaded, for the media library (the files themselves live in storage). */
export const uploads = pgTable("uploads", {
  id: uuid("id").primaryKey().defaultRandom(),
  ownerId: uuid("owner_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  fileKey: text("file_key").notNull().unique(),
  name: text("name").notNull().default(""),
  kind: text("kind").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("uploads_owner_idx").on(t.ownerId, t.createdAt)]);
/** People a project is shared with. The owner is graphs.owner_id, not listed here. */
export const graphMembers = pgTable("graph_members", {
  graphId: text("graph_id").notNull().references(() => graphs.id, { onDelete: "cascade" }),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  /** editor: changes and runs (paying for own runs); viewer: looks */
  role: text("role").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [primaryKey({ columns: [t.graphId, t.userId] }), index("graph_members_user_idx").on(t.userId)]);

/** Invitations for emails without an account yet; they turn into members on sign-in. */
export const graphInvites = pgTable("graph_invites", {
  graphId: text("graph_id").notNull().references(() => graphs.id, { onDelete: "cascade" }),
  email: text("email").notNull(),
  role: text("role").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [primaryKey({ columns: [t.graphId, t.email] }), index("graph_invites_email_idx").on(t.email)]);

/** Comments pinned to a spot on the canvas; replies point to their thread. */
export const graphComments = pgTable("graph_comments", {
  id: uuid("id").primaryKey().defaultRandom(),
  graphId: text("graph_id").notNull().references(() => graphs.id, { onDelete: "cascade" }),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  parentId: uuid("parent_id"),
  x: doublePrecision("x").notNull().default(0),
  y: doublePrecision("y").notNull().default(0),
  text: text("text").notNull(),
  resolved: boolean("resolved").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("graph_comments_graph_idx").on(t.graphId, t.createdAt)]);

export type UserRow = typeof users.$inferSelect;
export type LedgerRow = typeof ledger.$inferSelect;
