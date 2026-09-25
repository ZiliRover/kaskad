/**
 * Pre-run cost estimates from OpenRouter's published pricing.
 * Providers bill in different units (seconds, video tokens, megapixels, image tokens),
 * so some estimates are approximate. The actual charge always comes from the
 * provider's `usage.cost` after the run.
 */
import type { ModelSpec, ParamValue, PricingLine } from "./types";

export interface Estimate {
  usd: number | null;   // null = cannot estimate, show "price after run"
  approx: boolean;
}

export interface EstimateContext {
  params: Record<string, ParamValue>;
  /** number of images connected per input port */
  inputCounts: Record<string, number>;
  /** prompt length in characters, for text models */
  promptChars?: number;
}

const SHORT_SIDE: Record<string, number> = {
  "480p": 480, "720p": 720, "768p": 768, "1080p": 1080, "1024p": 1024, "1k": 1080, "2k": 1440, "4k": 2160,
};

function ratio(ar: string | undefined): number {
  const m = /^(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)$/.exec(ar ?? "");
  if (!m) return 16 / 9;
  const a = Number(m[1]), b = Number(m[2]);
  return Math.max(a, b) / Math.min(a, b);
}

function videoEstimate(skus: Record<string, string>, ctx: EstimateContext): Estimate {
  const res = String(ctx.params.resolution ?? "720p").toLowerCase();
  const dur = Number(ctx.params.duration ?? 5);
  const audio = ctx.params.generate_audio !== false;
  const frames = (ctx.inputCounts.first_frame ?? 0) + (ctx.inputCounts.last_frame ?? 0);
  const n = (k: string) => (skus[k] !== undefined ? Number(skus[k]) : undefined);

  // ByteDance bills video tokens = width * height * fps * seconds / 1024 (24 fps)
  if (n("video_tokens") !== undefined) {
    const short = SHORT_SIDE[res] ?? 720;
    const pixels = short * Math.round(short * ratio(String(ctx.params.aspect_ratio)));
    const tokens = (pixels * 24 * dur) / 1024;
    const rate = n(`video_tokens_${res}`) ?? (audio ? n("video_tokens") : n("video_tokens_without_audio") ?? n("video_tokens"))!;
    return { usd: tokens * rate, approx: true };
  }

  const mode = frames > 0 ? "image_to_video" : "text_to_video";
  const audioTag = audio ? "with_audio" : "without_audio";
  // most specific SKU wins; audio surcharge SKUs outrank mode/resolution ones
  const perSecond =
    n(`duration_seconds_${audioTag}_${res}`)
    ?? n(`duration_seconds_${audioTag}`)
    ?? n(`${mode}_duration_seconds_${res}`)
    ?? n(`duration_seconds_${res}`)
    ?? n("duration_seconds")
    ?? div100(n(`cents_per_second_output_${res}`) ?? n("cents_per_second_output") ?? n(`cents_per_video_output_second_${res}`));
  if (perSecond === undefined) return { usd: null, approx: true };

  let usd = perSecond * dur;
  usd += frames * (n("reference_images") ?? div100(n("cents_per_image_input")) ?? 0);
  const min = div100(n("minimum_cents_per_generation"));
  if (min !== undefined) usd = Math.max(usd, min);
  return { usd, approx: false };
}

const div100 = (v: number | undefined) => (v === undefined ? undefined : v / 100);

// Output tokens per image for token-billed image models (approximate, per provider docs)
function imageTokens(modelId: string, params: Record<string, ParamValue>): number {
  if (modelId.startsWith("google/")) return String(params.resolution).toUpperCase() === "4K" ? 2000 : 1120;
  const q = String(params.quality ?? "medium");
  return q === "low" ? 300 : q === "medium" ? 1100 : 4400; // "high"/"auto": assume the upper bound
}

function megapixels(params: Record<string, ParamValue>): number {
  const tier = String(params.resolution ?? "1K").toUpperCase();
  return tier === "4K" ? 16 : tier === "2K" ? 4 : 1;
}

function imageEstimate(spec: ModelSpec, lines: PricingLine[], ctx: EstimateContext): Estimate {
  const outLines = lines.filter((l) => l.billable === "output_image");
  if (!outLines.length) return { usd: null, approx: true };
  const res = String(ctx.params.resolution ?? "").toLowerCase();
  const line =
    outLines.find((l) => l.variant === res)
    ?? (res === "2k" || res === "4k" ? outLines.find((l) => l.variant === "high_resolution") : undefined)
    ?? outLines.find((l) => !l.variant)
    ?? outLines[0];

  let usd: number, approx = false;
  if (line.unit === "image") usd = line.cost_usd;
  else if (line.unit === "megapixel") { usd = line.cost_usd * megapixels(ctx.params); approx = true; }
  else { usd = line.cost_usd * imageTokens(spec.id, ctx.params); approx = true; }

  const refs = ctx.inputCounts.references ?? 0;
  const inLine = lines.find((l) => l.billable === "input_image" && l.unit === "image");
  if (refs && inLine) usd += refs * inLine.cost_usd;
  // some models also bill the prompt itself (~4 characters per token)
  const textLine = lines.find((l) => l.billable === "input_text" && l.unit === "token");
  if (textLine) { usd += ((ctx.promptChars ?? 400) / 4) * textLine.cost_usd; approx = true; }
  return { usd, approx };
}

export function estimate(spec: ModelSpec, ctx: EstimateContext): Estimate {
  const p = spec.pricing;
  if (p.type === "video") return videoEstimate(p.skus, ctx);
  if (p.type === "image") return imageEstimate(spec, p.lines, ctx);
  // text: assume ~4 chars per token in, ~600 tokens out
  const inTok = Math.max(200, (ctx.promptChars ?? 400) / 4);
  return { usd: inTok * p.prompt + 600 * p.completion, approx: true };
}

