import type { ParamValue } from "@/lib/models/types";

export interface ImageRequest {
  model: string;
  prompt: string;
  references: string[];            // data URLs
  params: Record<string, ParamValue>;
}

export interface VideoRequest {
  model: string;
  prompt: string;
  firstFrame: string | null;       // data URL
  lastFrame: string | null;
  params: Record<string, ParamValue>;
}

export interface TextRequest {
  model: string;
  prompt: string;
  system: string;
  images: string[];                // data URLs
}

export interface Media {
  bytes: Uint8Array;
  mime: string;
}

export type VideoPoll =
  | { state: "pending" }
  | { state: "done"; costUsd: number | null }
  | { state: "failed"; error: string };

export interface Provider {
  readonly mode: "live" | "mock";
  image(req: ImageRequest): Promise<Media & { costUsd: number | null }>;
  submitVideo(req: VideoRequest): Promise<{ externalId: string }>;
  pollVideo(externalId: string): Promise<VideoPoll>;
  downloadVideo(externalId: string): Promise<Media>;
  text(req: TextRequest): Promise<{ text: string; costUsd: number | null }>;
}

/** Error whose message is safe and meaningful to show the user as-is. */
export class ProviderError extends Error {
  constructor(message: string, public retryable = false) { super(message); }
}
