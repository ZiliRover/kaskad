import type { ModelSpec, ParamValue } from "./types";

/**
 * Draft mode: the same graph at the cheapest settings each model offers (lowest
 * resolution, low quality, no generated sound), for checking an idea before paying
 * for the final. Everything else, prompts and timing included, stays as set.
 */
export function draftParams(spec: ModelSpec, params: Record<string, ParamValue>): Record<string, ParamValue> {
  const out = { ...params };
  for (const p of spec.params) {
    if (p.type === "enum" && ["resolution", "size", "image_size"].includes(p.key) && p.options.length) {
      out[p.key] = p.options[0].value; // catalogs list sizes from small to large
    } else if (p.type === "enum" && p.key === "quality") {
      out[p.key] = p.options.find((o) => o.value === "low")?.value ?? p.options[0]?.value ?? out[p.key];
    } else if (p.type === "boolean" && p.key === "generate_audio") {
      out[p.key] = false;
    }
  }
  return out;
}
