/**
 * Pulls capabilities and prices for curated models from OpenRouter and writes
 * src/lib/models/catalog.json. Run after changing curation.ts or to refresh prices.
 */
import { writeFileSync } from "node:fs";
import { CURATED } from "../src/lib/models/curation";
import type { CatalogEntry } from "../src/lib/models/types";

const BASE = "https://openrouter.ai/api/v1";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = Record<string, any>;

async function get<T>(path: string): Promise<T> {
  const r = await fetch(BASE + path);
  if (!r.ok) throw new Error(`${path}: HTTP ${r.status}`);
  return r.json() as Promise<T>;
}

async function main() {
  const [videos, images, models] = await Promise.all([
    get<{ data: Any[] }>("/videos/models"),
    get<{ data: Any[] }>("/images/models"),
    get<{ data: Any[] }>("/models"),
  ]);
  const out: CatalogEntry[] = [];
  const missing: string[] = [];

  for (const c of CURATED) {
    if (c.kind === "video") {
      const m = videos.data.find((x) => x.id === c.id);
      if (!m) { missing.push(c.id); continue; }
      out.push({
        id: c.id, kind: "video",
        resolutions: m.supported_resolutions ?? [],
        aspectRatios: m.supported_aspect_ratios ?? [],
        durations: m.supported_durations ?? [],
        frameImages: m.supported_frame_images ?? [],
        audio: !!m.generate_audio,
        seed: !!m.seed,
        pricing: { type: "video", skus: m.pricing_skus ?? {} },
      });
    } else if (c.kind === "image") {
      const m = images.data.find((x) => x.id === c.id);
      if (!m) { missing.push(c.id); continue; }
      const ep = await get<{ endpoints: Any[] }>(`/images/models/${c.id}/endpoints`);
      const first = ep.endpoints[0] ?? {};
      out.push({
        id: c.id, kind: "image",
        // the default-routed endpoint's definitive params: never offer a value
        // that only some providers accept
        supported: first.supported_parameters ?? m.supported_parameters ?? {},
        pricing: { type: "image", lines: first.pricing ?? [] },
      });
    } else {
      const m = models.data.find((x) => x.id === c.id);
      if (!m) { missing.push(c.id); continue; }
      out.push({
        id: c.id, kind: "text",
        inputModalities: m.architecture?.input_modalities ?? ["text"],
        pricing: {
          type: "text",
          prompt: Number(m.pricing?.prompt ?? 0),
          completion: Number(m.pricing?.completion ?? 0),
          image: m.pricing?.image ? Number(m.pricing.image) : undefined,
        },
      });
    }
  }

  const file = new URL("../src/lib/models/catalog.json", import.meta.url);
  writeFileSync(file, JSON.stringify({ syncedAt: new Date().toISOString(), models: out }, null, 2) + "\n");
  console.log(`catalog: ${out.length} models written`);
  if (missing.length) {
    console.warn(`NOT FOUND on OpenRouter (removed or renamed?): ${missing.join(", ")}`);
    process.exitCode = 1;
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
