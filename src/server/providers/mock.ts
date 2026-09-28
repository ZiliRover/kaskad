/**
 * Free stand-in for OpenRouter (PROVIDER_MODE=mock). Behaves like the real thing
 * (latency, async video jobs, failures on request) so the whole pipeline can be
 * exercised without spending money. The UI labels this mode clearly.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { placeholderPng, tone } from "../tools";
import { ProviderError, type Provider } from "./types";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const VIDEO_MS = 12_000;
const SAMPLE_VIDEO = process.env.MOCK_VIDEO_PATH
  ?? path.join(/* turbopackIgnore: true */ process.cwd(), "prototype/web/outputs/seedance-1790096361.mp4");

function hue(s: string): number {
  let h = 0;
  for (const ch of s) h = (h * 31 + ch.charCodeAt(0)) % 360;
  return h;
}

function maybeFail(prompt: string) {
  // lets us exercise error paths from the UI: put "[fail]" in a prompt
  if (prompt.includes("[fail]")) throw new ProviderError("Тестовая ошибка: модель отклонила запрос");
}

export const mockProvider: Provider = {
  mode: "mock",

  async image(req) {
    await sleep(1800);
    maybeFail(req.prompt);
    const n = Math.max(1, Number.parseInt(String(req.params.n ?? 1), 10) || 1);
    // real PNGs, so the editing tools downstream work in test mode too
    const images = await Promise.all(Array.from({ length: n }, async (_, i) => {
      const text = `${req.prompt}${n > 1 ? ` (вариант ${i + 1})` : ""}`;
      return { bytes: await placeholderPng(text, String(req.params.aspect_ratio ?? "16:9"), hue(text)), mime: "image/png" };
    }));
    return { images, costUsd: 0 };
  },

  async submitVideo(req) {
    await sleep(600);
    maybeFail(req.prompt);
    return { externalId: `mock-${Date.now()}` };
  },

  async pollVideo(externalId) {
    const started = Number(externalId.replace("mock-", ""));
    return Date.now() - started < VIDEO_MS ? { state: "pending" } : { state: "done", costUsd: 0 };
  },

  async downloadVideo() {
    try {
      return { bytes: await readFile(SAMPLE_VIDEO), mime: "video/mp4" };
    } catch {
      throw new ProviderError("Тестовый режим: нет образца видео (MOCK_VIDEO_PATH)");
    }
  },

  async text(req) {
    await sleep(900);
    maybeFail(req.prompt);
    const imgs = req.images.length ? ` (картинок на входе: ${req.images.length})` : "";
    return { text: `Тестовый ответ${imgs}. Улучшенный промт: ${req.prompt}`, costUsd: 0 };
  },

  async speech(req) {
    await sleep(700);
    maybeFail(req.text);
    // a soft tone about as long as the text would take to say
    const seconds = Math.min(30, Math.max(1.5, req.text.length / 14));
    return { audio: { bytes: await tone(seconds), mime: "audio/mpeg" }, costUsd: 0 };
  },
};
