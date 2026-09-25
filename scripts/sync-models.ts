/**
 * Pulls every video and image model (plus our text models) from OpenRouter and writes
 * src/lib/models/catalog.json. Run to pick up new models and price changes.
 */
import { writeFileSync } from "node:fs";
import { OVERRIDES, TEXT_MODELS } from "../src/lib/models/curation";
import type { CatalogEntry } from "../src/lib/models/types";

const BASE = "https://openrouter.ai/api/v1";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = Record<string, any>;

async function get<T>(path: string): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    const r = await fetch(BASE + path);
    if (r.ok) return r.json() as Promise<T>;
    if (attempt >= 3 || r.status < 500) throw new Error(`${path}: HTTP ${r.status}`);
    await new Promise((res) => setTimeout(res, 1000 * attempt));
  }
}

/** run fn over items with limited concurrency */
async function pool<T, R>(items: T[], n: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: n }, async () => {
    while (i < items.length) { const k = i++; out[k] = await fn(items[k]); }
  }));
  return out;
}

async function main() {
  const [videos, images, models] = await Promise.all([
    get<{ data: Any[] }>("/videos/models"),
    get<{ data: Any[] }>("/images/models"),
    get<{ data: Any[] }>("/models"),
  ]);

  const out: CatalogEntry[] = [];

  for (const m of videos.data) {
    if (OVERRIDES[m.id]?.hidden) continue;
    out.push({
      id: m.id, kind: "video", name: m.name ?? m.id,
      resolutions: m.supported_resolutions ?? [],
      aspectRatios: m.supported_aspect_ratios ?? [],
      durations: m.supported_durations ?? [],
      frameImages: m.supported_frame_images ?? [],
      audio: !!m.generate_audio,
      seed: !!m.seed,
      upscaleFactor: m.upscale_factor ?? null,
      creativity: m.creativity ?? null,
      pricing: { type: "video", skus: m.pricing_skus ?? {} },
    });
  }

  const visibleImages = images.data.filter((m) => !OVERRIDES[m.id]?.hidden);
  const imageEntries = await pool(visibleImages, 6, async (m): Promise<CatalogEntry> => {
    const ep = await get<{ endpoints: Any[] }>(`/images/models/${m.id}/endpoints`);
    const first = ep.endpoints[0] ?? {};
    return {
      id: m.id, kind: "image", name: m.name ?? m.id,
      // the default-routed endpoint's definitive params: never offer a value
      // only some providers accept
      supported: first.supported_parameters ?? m.supported_parameters ?? {},
      inputModalities: m.architecture?.input_modalities ?? ["text"],
      pricing: { type: "image", lines: first.pricing ?? [] },
    };
  });
  out.push(...imageEntries);

  const missing: string[] = [];
  for (const id of TEXT_MODELS) {
    const m = models.data.find((x) => x.id === id);
    if (!m) { missing.push(id); continue; }
    out.push({
      id, kind: "text", name: m.name ?? id,
      inputModalities: m.architecture?.input_modalities ?? ["text"],
      pricing: {
        type: "text",
        prompt: Number(m.pricing?.prompt ?? 0),
        completion: Number(m.pricing?.completion ?? 0),
        image: m.pricing?.image ? Number(m.pricing.image) : undefined,
      },
    });
  }

  // overrides that point at models OpenRouter no longer lists
  const ids = new Set([...videos.data, ...images.data].map((m) => m.id).concat(TEXT_MODELS));
  const stale = Object.keys(OVERRIDES).filter((id) => !ids.has(id));

  const file = new URL("../src/lib/models/catalog.json", import.meta.url);
  writeFileSync(file, JSON.stringify({ syncedAt: new Date().toISOString(), models: out }, null, 2) + "\n");
  const count = (k: string) => out.filter((m) => m.kind === k).length;
  console.log(`catalog: ${count("video")} video, ${count("image")} image, ${count("text")} text models`);
  if (missing.length || stale.length) {
    console.warn(`not on OpenRouter anymore: ${[...missing, ...stale].join(", ")}`);
    process.exitCode = 1;
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
