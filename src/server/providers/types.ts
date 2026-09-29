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
  /** input_references: guidance assets (images for most models; video/audio for Seedance 2+) */
  refImages: string[];
  refVideos: string[];
  refAudio: string[];
  /** edit/upscale models: the video being changed */
  sourceVideo: string | null;
  params: Record<string, ParamValue>;
}

export interface TextRequest {
  model: string;
  prompt: string;
  system: string;
  images: string[];                // data URLs
}

export interface SpeechRequest {
  model: string;
  text: string;
  voice: string | null;
  /** voice cloning: a sample of the voice as a data URL */
  sample: string | null;
}

export interface TranscribeResult {
  words: { word: string; start: number; end: number }[];
  costUsd: number | null;
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
  /** returns one image per requested variant (params.n), possibly fewer */
  image(req: ImageRequest): Promise<{ images: Media[]; costUsd: number | null }>;
  submitVideo(req: VideoRequest): Promise<{ externalId: string }>;
  pollVideo(externalId: string): Promise<VideoPoll>;
  downloadVideo(externalId: string): Promise<Media>;
  text(req: TextRequest): Promise<{ text: string; costUsd: number | null }>;
  speech(req: SpeechRequest): Promise<{ audio: Media; costUsd: number | null }>;
  /** music from a description (streamed audio output) */
  music(req: { model: string; prompt: string }): Promise<{ audio: Media; costUsd: number | null }>;
  /** speech recognition with word timings (subtitles) */
  transcribe(audio: Uint8Array): Promise<TranscribeResult>;
}

/** Error whose message is safe and meaningful to show the user as-is. */
export class ProviderError extends Error {
  constructor(message: string, public retryable = false) { super(message); }
}
