import type { ParamValue } from "./models/types";

/** Where a job input value comes from. Node refs are resolved when the job executes. */
export type InputRef =
  | { type: "text"; text: string }
  | { type: "file"; key: string }
  /** item: the result of that node's run for list item N (batches go item by item) */
  | { type: "node"; nodeId: string; outputId?: string; item?: number };

export interface JobInput {
  ports: Record<string, InputRef[]>;
  params: Record<string, ParamValue>;
}

export type JobStatus = "queued" | "running" | "succeeded" | "failed" | "skipped" | "canceled";

export const ACTIVE_STATUSES: JobStatus[] = ["queued", "running"];

/** What the studio polls: latest job and latest result per node. */
export interface NodeState {
  job: {
    id: string;
    status: JobStatus;
    error: string | null;
    costUsd: number | null;
    /** what the user was actually charged, in kopecks (null until settled or for free jobs) */
    chargedKop: number | null;
    /** model and settings of that run, to tell whether the node still matches it */
    modelId: string;
    params: Record<string, unknown>;
    createdAt: string;
    startedAt: string | null;
    /** all jobs of the latest run still queued or running (a batch has several) */
    activeIds: string[];
    /** batch progress; null for a single run */
    items: { total: number; done: number; failed: number } | null;
  } | null;
  output: {
    id: string;
    kind: "text" | "image" | "video" | "audio";
    url: string | null;
    mime: string | null;
    text: string | null;
    createdAt: string;
  } | null;
  outputCount: number;
  /** all results of the latest successful run when it produced several variants */
  batch: { id: string; url: string | null }[];
}

export type GraphState = Record<string, NodeState>;

/** One entry of a node's version history. */
export interface OutputVersion {
  id: string;
  nodeId: string;
  /** storage key, lets a result be reused as an upload (gallery drag) */
  fileKey: string | null;
  kind: "text" | "image" | "video" | "audio";
  url: string | null;
  mime: string | null;
  text: string | null;
  createdAt: string;
  costUsd: number | null;
}
