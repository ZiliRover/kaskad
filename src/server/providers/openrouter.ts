import {
  ProviderError, type ImageRequest, type Media, type Provider, type SpeechRequest, type TextRequest, type TranscribeResult, type VideoPoll, type VideoRequest,
} from "./types";

const BASE = "https://openrouter.ai/api/v1";
const TIMEOUT_MS = 5 * 60_000; // image models can take a couple of minutes

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = Record<string, any>;

/**
 * Our own variable name first: a machine-wide OPENROUTER_API_KEY set by another tool
 * silently wins over .env (process env takes precedence), which cost us a debugging session.
 * trim: a .env saved with Windows line endings leaves a carriage return on the value.
 */
export function apiKeySource(): { key: string; from: string } | null {
  for (const name of ["KASKAD_OPENROUTER_KEY", "OPENROUTER_API_KEY"]) {
    const v = process.env[name]?.trim();
    if (v) return { key: v, from: name };
  }
  return null;
}

function key(): string {
  const k = apiKeySource()?.key;
  if (!k) throw new ProviderError("Сервер не настроен: нет ключа OpenRouter (KASKAD_OPENROUTER_KEY)");
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

/**
 * Provider errors that people actually hit (seen in live runs), rewritten as advice.
 * Checked against the raw provider text, which often embeds another JSON error.
 */
const KNOWN: { test: RegExp; message: string; retry?: boolean }[] = [
  {
    test: /PrivacyInformation|may contain real person/i,
    message: "Модель не принимает кадры, похожие на фото реального человека (фильтр приватности провайдера). Возьми стилизованный кадр или другую модель: Kling, Wan, Hailuo.",
  },
  {
    test: /Blocked by Google|not available in your (country|region)|unsupported.?(country|region|location)/i,
    message: "Производитель модели не обслуживает запросы из региона сервера (сейчас это Google: Nano Banana, Veo, Gemini). Выбери модель другого производителя.",
  },
  {
    test: /No endpoint found/i,
    message: "Сейчас у модели нет доступного провайдера для такого запроса, часто из-за региональных ограничений. Выбери другую модель.",
  },
  {
    test: /Only HTTPS URLs are allowed/i,
    message: "Видео и аудио провайдер принимает только по публичной https-ссылке. Задай PUBLIC_BASE_URL у сервера.",
  },
  {
    // the model's own backend failed mid-job (seen with FLUX: "poll returned 422 … corrupted image input" on a text-only prompt)
    test: /poll returned \d{3}|corrupted image input|upstream (error|failure)/i,
    message: "Модель дала сбой на своей стороне. Запусти ещё раз; если повторится, выбери другую модель.",
    retry: true,
  },
  {
    test: /SensitiveContent|content.?(policy|moderation)|safety (system|filter)|flagged/i,
    message: "Провайдер отклонил запрос по правилам контента. Измени промт или входные картинки.",
  },
];

/** Innermost human text of a provider error ("HTTP 400: {\"error\":{\"message\":…}}" → message). */
function innerMessage(detail: string): string {
  const m = /\{[\s\S]*\}$/.exec(detail);
  if (!m) return detail;
  try {
    const j = JSON.parse(m[0]);
    return j?.error?.message ?? j?.message ?? detail;
  } catch {
    return detail;
  }
}

export function humanize(detail: string | null | undefined): string | null {
  if (!detail) return null;
  return KNOWN.find((k) => k.test.test(detail))?.message ?? null;
}

/** Map HTTP failures to messages a user can act on. */
function failure(status: number, data: Json | null): ProviderError {
  const raw = providerMessage(data);
  const rule = raw ? KNOWN.find((k) => k.test.test(raw)) : undefined;
  if (rule) return new ProviderError(rule.message, !!rule.retry);
  const detail = raw ? innerMessage(raw) : null;
  switch (status) {
    case 400: return new ProviderError(`Модель отклонила запрос${detail ? `: ${detail}` : ""}`);
    case 401: return new ProviderError("Ключ OpenRouter не принят. Проверьте KASKAD_OPENROUTER_KEY в .env.");
    case 403: return new ProviderError(`Провайдер отказал в доступе к модели${detail ? `: ${detail}` : ""}`);
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
      const raw = providerMessage(d);
      return { state: "failed", error: humanize(raw) ?? `Генерация не удалась${raw ? `: ${innerMessage(raw)}` : ""}` };
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

  speech: speechCall,
  transcribe: transcribeCall,
  music: musicCall,
};

/** Text to speech (POST /audio/speech): raw audio bytes on success, JSON on error. */
async function speechCall(req: SpeechRequest): Promise<{ audio: Media; costUsd: number | null }> {
  const body: Json = { model: req.model, input: req.text, response_format: "mp3" };
  if (req.voice) body.voice = req.voice;
  if (req.sample) body.input_references = [{ type: "input_audio", input_audio: { data: req.sample } }];
  let r: Response;
  try {
    r = await fetch(`${BASE}/audio/speech`, {
      method: "POST", headers: headers(), body: JSON.stringify(body), signal: AbortSignal.timeout(3 * 60_000),
    });
  } catch (e) {
    const timeout = e instanceof Error && e.name === "TimeoutError";
    throw new ProviderError(timeout ? "Провайдер не ответил вовремя. Попробуйте ещё раз." : "Нет связи с провайдером", true);
  }
  const buf = new Uint8Array(await r.arrayBuffer());
  if (!r.ok) {
    let data: Json | null = null;
    try { data = JSON.parse(new TextDecoder().decode(buf)); } catch { /* not JSON */ }
    throw failure(r.status, data);
  }
  if (buf.length < 1000) throw new ProviderError("Модель вернула пустую запись. Попробуйте другой голос или модель.");
  // the endpoint returns audio only; the price is known up front (per character)
  return { audio: { bytes: buf, mime: "audio/mpeg" }, costUsd: null };
}

/**
 * Music (Lyria): chat completions with audio output. Audio output is only streamed,
 * as base64 chunks in delta.audio.data over SSE.
 */
async function musicCall(req: { model: string; prompt: string }): Promise<{ audio: Media; costUsd: number | null }> {
  let r: Response;
  try {
    r = await fetch(`${BASE}/chat/completions`, {
      method: "POST", headers: headers(), signal: AbortSignal.timeout(5 * 60_000),
      body: JSON.stringify({
        model: req.model, messages: [{ role: "user", content: req.prompt }],
        modalities: ["text", "audio"], audio: { format: "wav" }, stream: true, usage: { include: true },
      }),
    });
  } catch {
    throw new ProviderError("Нет связи с провайдером", true);
  }
  if (!r.ok || !r.body) {
    let data: Json | null = null;
    try { data = JSON.parse(await r.text()); } catch { /* not JSON */ }
    throw failure(r.status, data);
  }
  const chunks: string[] = [];
  let costUsd: number | null = null;
  const reader = r.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.startsWith("data: ")) continue;
      const data = line.slice(6).trim();
      if (data === "[DONE]") continue;
      try {
        const chunk = JSON.parse(data);
        if (chunk.error) throw failure(502, chunk);
        const audio = chunk.choices?.[0]?.delta?.audio;
        if (audio?.data) chunks.push(audio.data);
        if (chunk.usage?.cost !== undefined) costUsd = Number(chunk.usage.cost);
      } catch (e) {
        if (e instanceof ProviderError) throw e; // a partial line: ignore, the next read completes it
      }
    }
  }
  const bytes = new Uint8Array(Buffer.from(chunks.join(""), "base64"));
  if (bytes.length < 1000) throw new ProviderError("Модель не вернула музыку. Попробуйте изменить описание.");
  return { audio: { bytes, mime: "audio/wav" }, costUsd };
}

const STT_MODEL = "openai/whisper-large-v3";

async function transcribeCall(audio: Uint8Array): Promise<TranscribeResult> {
  const d = await call("/audio/transcriptions", {
    method: "POST",
    body: JSON.stringify({
      model: STT_MODEL,
      input_audio: { data: Buffer.from(audio).toString("base64"), format: "mp3" },
      response_format: "verbose_json",
      timestamp_granularities: ["word"],
    }),
    timeoutMs: 3 * 60_000,
  });
  const words = (Array.isArray(d.words) ? d.words : [])
    .map((w: Json) => ({ word: String(w.word ?? "").trim(), start: Number(w.start), end: Number(w.end) }))
    .filter((w: { word: string; start: number; end: number }) => w.word && Number.isFinite(w.start) && Number.isFinite(w.end));
  return { words, costUsd: cost(d) };
}

const g = globalThis as unknown as { __orBalance?: { usd: number; at: number } };

/** What is left on the OpenRouter account (credits bought minus used), cached for a minute. */
export async function accountBalanceUsd(): Promise<number | null> {
  const k = apiKeySource()?.key;
  if (!k) return null;
  if (g.__orBalance && Date.now() - g.__orBalance.at < 60_000) return g.__orBalance.usd;
  try {
    const r = await fetch(`${BASE}/credits`, { headers: { Authorization: `Bearer ${k}` }, signal: AbortSignal.timeout(5000), cache: "no-store" });
    if (!r.ok) return null;
    const d = (await r.json())?.data;
    const usd = Number(d?.total_credits) - Number(d?.total_usage);
    if (!Number.isFinite(usd)) return null;
    g.__orBalance = { usd, at: Date.now() };
    return usd;
  } catch {
    return g.__orBalance?.usd ?? null;
  }
}
