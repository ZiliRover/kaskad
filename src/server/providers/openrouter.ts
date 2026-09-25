import {
  ProviderError, type ImageRequest, type Media, type Provider, type TextRequest, type VideoPoll, type VideoRequest,
} from "./types";

const BASE = "https://openrouter.ai/api/v1";
const TIMEOUT_MS = 5 * 60_000; // image models can take a couple of minutes

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = Record<string, any>;

function key(): string {
  const k = process.env.OPENROUTER_API_KEY;
  if (!k) throw new ProviderError("Сервер не настроен: нет ключа OpenRouter");
  return k;
}

function headers(): HeadersInit {
  return {
    Authorization: `Bearer ${key()}`,
    "Content-Type": "application/json",
    "X-Title": "Kaskad",
  };
}

function providerMessage(data: Json | null): string | null {
  const err = data?.error;
  if (typeof err === "string") return err;
  if (err && typeof err.message === "string") return err.message;
  return typeof data?.message === "string" ? data.message : null;
}

/** Map HTTP failures to messages a user can act on. */
function failure(status: number, data: Json | null): ProviderError {
  const detail = providerMessage(data);
  switch (status) {
    case 400: return new ProviderError(`Модель отклонила запрос${detail ? `: ${detail}` : ""}`);
    case 401: case 403: return new ProviderError("Доступ к модели отклонён. Проверьте ключ сервиса.");
    case 402: return new ProviderError("У сервиса закончился баланс у провайдера. Мы уже разбираемся.");
    case 408: case 504: return new ProviderError("Провайдер не ответил вовремя. Попробуйте ещё раз.", true);
    case 429: return new ProviderError("Провайдер перегружен. Попробуйте через минуту.", true);
    default:
      if (status >= 500) return new ProviderError(`Сбой на стороне провайдера${detail ? `: ${detail}` : ""}`, true);
      return new ProviderError(detail ?? `Ошибка провайдера (HTTP ${status})`);
  }
}

async function call(path: string, init: RequestInit & { timeoutMs?: number } = {}): Promise<Json> {
  let r: Response;
  try {
    r = await fetch(path.startsWith("http") ? path : BASE + path, {
      ...init,
      headers: { ...headers(), ...(init.headers ?? {}) },
      signal: AbortSignal.timeout(init.timeoutMs ?? TIMEOUT_MS),
    });
  } catch (e) {
    const timeout = e instanceof Error && e.name === "TimeoutError";
    throw new ProviderError(timeout ? "Провайдер не ответил вовремя. Попробуйте ещё раз." : "Нет связи с провайдером", true);
  }
  const text = await r.text();
  let data: Json | null = null;
  try { data = text ? JSON.parse(text) : null; } catch { /* non-JSON error page */ }
  if (!r.ok) throw failure(r.status, data);
  return data ?? {};
}

const cost = (d: Json): number | null => {
  const c = d?.usage?.cost;
  return typeof c === "number" ? c : c ? Number(c) : null;
};

const imageRef = (url: string) => ({ type: "image_url", image_url: { url } });
const videoRef = (url: string) => ({ type: "video_url", video_url: { url } });
const audioRef = (url: string) => ({ type: "audio_url", audio_url: { url } });

function pickParams(params: Record<string, unknown>, keys: string[]): Json {
  const out: Json = {};
  for (const k of keys) {
    const v = params[k];
    if (v === undefined || v === "" || v === null) continue;
    out[k] = v;
  }
  return out;
}

function seed(params: Record<string, unknown>): Json {
  const n = Number.parseInt(String(params.seed ?? ""), 10);
  return Number.isFinite(n) ? { seed: n } : {};
}

export const openRouter: Provider = {
  mode: "live",

  async image(req: ImageRequest) {
    const n = Math.max(1, Number.parseInt(String(req.params.n ?? 1), 10) || 1);
    const d = await call("/images", {
      method: "POST",
      body: JSON.stringify({
        model: req.model,
        prompt: req.prompt,
        n,
        ...pickParams(req.params, ["aspect_ratio", "resolution", "quality", "background"]),
        ...seed(req.params),
        ...(req.references.length ? { input_references: req.references.map(imageRef) } : {}),
      }),
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const images: Media[] = (d.data ?? []).filter((x: any) => x?.b64_json).map((x: any) => ({
      bytes: Buffer.from(x.b64_json, "base64"),
      mime: x.media_type ?? "image/png",
    }));
    if (!images.length) throw new ProviderError("Модель не вернула изображение. Попробуйте переформулировать промт.");
    return { images, costUsd: cost(d) };
  },

  async submitVideo(req: VideoRequest) {
    const frames = [
      req.firstFrame && { ...imageRef(req.firstFrame), frame_type: "first_frame" },
      req.lastFrame && { ...imageRef(req.lastFrame), frame_type: "last_frame" },
    ].filter(Boolean);
    const duration = Number.parseInt(String(req.params.duration ?? ""), 10);
    const upscale = Number.parseFloat(String(req.params.upscale_factor ?? ""));
    const creativity = Number.parseInt(String(req.params.creativity ?? ""), 10);
    const references = [
      ...(req.sourceVideo ? [videoRef(req.sourceVideo)] : []),
      ...req.refImages.map(imageRef),
      ...req.refVideos.map(videoRef),
      ...req.refAudio.map(audioRef),
    ];
    const d = await call("/videos", {
      method: "POST",
      timeoutMs: 120_000,
      body: JSON.stringify({
        model: req.model,
        ...(req.prompt ? { prompt: req.prompt } : {}),
        ...pickParams(req.params, ["resolution", "aspect_ratio"]),
        ...(Number.isFinite(duration) ? { duration } : {}),
        ...(typeof req.params.generate_audio === "boolean" ? { generate_audio: req.params.generate_audio } : {}),
        ...seed(req.params),
        ...(Number.isFinite(upscale) ? { upscale_factor: upscale } : {}),
        ...(Number.isFinite(creativity) ? { creativity } : {}),
        ...(frames.length ? { frame_images: frames } : {}),
        ...(references.length ? { input_references: references } : {}),
      }),
    });
    if (!d.id) throw new ProviderError("Провайдер не принял задачу на генерацию");
    return { externalId: String(d.id) };
  },

  async pollVideo(externalId: string): Promise<VideoPoll> {
    const d = await call(`/videos/${encodeURIComponent(externalId)}`, { timeoutMs: 60_000 });
    const s = d.status;
    if (s === "completed") return { state: "done", costUsd: cost(d) };
    if (s === "failed" || s === "cancelled" || s === "expired") {
      return { state: "failed", error: `Генерация не удалась${providerMessage(d) ? `: ${providerMessage(d)}` : ""}` };
    }
    return { state: "pending" };
  },

  async downloadVideo(externalId: string): Promise<Media> {
    let r: Response;
    try {
      r = await fetch(`${BASE}/videos/${encodeURIComponent(externalId)}/content?index=0`, {
        headers: { Authorization: `Bearer ${key()}` },
        signal: AbortSignal.timeout(10 * 60_000),
      });
    } catch {
      throw new ProviderError("Не удалось скачать готовое видео", true);
    }
    if (!r.ok) throw failure(r.status, null);
    const mime = r.headers.get("content-type")?.split(";")[0] || "video/mp4";
    return { bytes: new Uint8Array(await r.arrayBuffer()), mime: mime.startsWith("video/") ? mime : "video/mp4" };
  },

  async text(req: TextRequest) {
    const messages: Json[] = [];
    if (req.system.trim()) messages.push({ role: "system", content: req.system.trim() });
    messages.push({
      role: "user",
      content: req.images.length
        ? [{ type: "text", text: req.prompt }, ...req.images.map(imageRef)]
        : req.prompt,
    });
    const d = await call("/chat/completions", {
      method: "POST",
      body: JSON.stringify({ model: req.model, messages, usage: { include: true } }),
    });
    const text = d.choices?.[0]?.message?.content;
    if (typeof text !== "string" || !text.trim()) throw new ProviderError("Модель вернула пустой ответ");
    return { text: text.trim(), costUsd: cost(d) };
  },
};
