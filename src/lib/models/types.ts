export type MediaKind = "text" | "image" | "video";
export type DType = MediaKind;

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

export interface ModelSpec {
  id: string;
  kind: MediaKind;
  name: string;
  vendor: string;
  blurb: string;
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
  // video
  resolutions?: string[];
  aspectRatios?: string[];
  durations?: number[];
  frameImages?: string[];
  audio?: boolean;
  seed?: boolean;
  // image
  supported?: Record<string, CapabilityDescriptor>;
  // text
  inputModalities?: string[];
  pricing: PricingSpec;
}
