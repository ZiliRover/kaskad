export type MediaKind = "text" | "image" | "video";
/** What flows along a wire. Audio can be an input (uploads, Seedance refs) but no model outputs it yet. */
export type DType = MediaKind | "audio";

export type ParamValue = string | number | boolean;

export type ParamSpec =
  | { key: string; label: string; type: "enum"; options: { value: string; label: string }[]; default: string }
  | { key: string; label: string; type: "boolean"; default: boolean }
  | { key: string; label: string; type: "seed" }
  | { key: string; label: string; type: "text"; placeholder?: string; default: string };

export interface PortSpec {
  key: string;
  dtype: DType;
  label: string;
  /** max number of edges into this port (1 = single input) */
  max: number;
  /** min number of edges required to run (0 = optional) */
  min: number;
  /** short hint shown next to the port */
  hint?: string;
}

export interface PricingLine {
  billable: string;
  unit: string;
  cost_usd: number;
  variant?: string;
}

/** Raw pricing as OpenRouter publishes it; interpreted by pricing.ts */
export type PricingSpec =
  | { type: "video"; skus: Record<string, string> }
  | { type: "image"; lines: PricingLine[] }
  | { type: "text"; prompt: number; completion: number; image?: number };

/** Function groups for the model palette. */
export type ModelGroup = "video" | "video-edit" | "image" | "image-style" | "image-vector" | "text";

/** Capability flags shown as icons in the palette and used for filtering. */
export interface ModelCaps {
  frames: boolean;       // first/last frame control
  refs: boolean;         // reference images
  mediaRefs: boolean;    // video/audio references
  audio: boolean;        // generates sound
  variants: number;      // max images per run (1 = no batch)
  vector: boolean;       // SVG output
  sourceVideo: boolean;  // edits/upscales an existing video
}

export interface ModelSpec {
  id: string;
  kind: MediaKind;
  group: ModelGroup;
  name: string;
  vendor: string;
  blurb: string;
  featured: boolean;
  promptOptional: boolean;
  caps: ModelCaps;
  inputs: PortSpec[];
  params: ParamSpec[];
  pricing: PricingSpec;
}

export interface CapabilityDescriptor {
  type: string;
  values?: string[];
  min?: number;
  max?: number;
}

/** Shape written by scripts/sync-models.ts */
export interface CatalogEntry {
  id: string;
  kind: MediaKind;
  /** catalog display name, e.g. "ByteDance: Seedance 2.0" */
  name: string;
  // video
  resolutions?: string[];
  aspectRatios?: string[];
  durations?: number[];
  frameImages?: string[];
  audio?: boolean;
  seed?: boolean;
  upscaleFactor?: { min: number; max: number } | null;
  creativity?: number[] | null;
  // image
  supported?: Record<string, CapabilityDescriptor>;
  // text / image
  inputModalities?: string[];
  pricing: PricingSpec;
}
